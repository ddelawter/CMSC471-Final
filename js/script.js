const stateToFIPS = {
    "Alabama": "01", "Alaska": "02", "Arizona": "04", "Arkansas": "05", "California": "06",
    "Colorado": "08", "Connecticut": "09", "Delaware": "10", "DC": "11",
    "Florida": "12", "Georgia": "13", "Hawaii": "15", "Idaho": "16", "Illinois": "17", "Indiana": "18",
    "Iowa": "19", "Kansas": "20", "Kentucky": "21", "Louisiana": "22", "Maine": "23", "Maryland": "24",
    "Massachusetts": "25", "Michigan": "26", "Minnesota": "27", "Mississippi": "28", "Missouri": "29",
    "Montana": "30", "Nebraska": "31", "Nevada": "32", "New Hampshire": "33", "New Jersey": "34",
    "New Mexico": "35", "New York": "36", "North Carolina": "37", "North Dakota": "38", "Ohio": "39",
    "Oklahoma": "40", "Oregon": "41", "Pennsylvania": "42", "Rhode Island": "44", "South Carolina": "45",
    "South Dakota": "46", "Tennessee": "47", "Texas": "48", "Utah": "49", "Vermont": "50",
    "Virginia": "51", "Washington": "53", "West Virginia": "54", "Wisconsin": "55", "Wyoming": "56"
};

function createVis(countyGeoJson, outbreakCounts, colorScale, statesTopo) {
    const width = 1115;
    const height = 700;

    const zoom = d3.zoom().scaleExtent([1, 8]).on("zoom", zoomed);

    const svg = d3.select("#vis").append("svg")
        .attr("viewBox", [0, 0, width, height])
        .attr("width", width)
        .attr("height", height)
        .call(zoom); // important for transition later

    const projection = d3.geoAlbersUsa().scale(1300).translate([width / 2, height / 2]);
    const path = d3.geoPath().projection(projection);
    const g = svg.append("g");

    g.append("g")
        .selectAll("path")
        .data(topojson.feature(statesTopo, statesTopo.objects.states).features)
        .enter()
        .append("path")
        .attr("d", path)
        .attr("fill", d => {
            const stateId = d.id;
            const count = outbreakCounts[stateId] || 0;
            return colorScale(count);
        })
        .attr("class", "state")
        .on("mouseover", function (event, d) {
            const stateId = d.id;
            const count = window.stateTotals[stateId] || 0;
            const name = d.properties.name;
            const speciesFreq = window.stateSpeciesFreqMap[stateId];
            let topSpeciesInfo = "None reported";

            if (speciesFreq && Object.keys(speciesFreq).length > 0) {
                const sortedSpecies = Object.entries(speciesFreq).sort((a, b) => b[1] - a[1]);
                const [topSpecies, topCount] = sortedSpecies[0];
                const total = Object.values(speciesFreq).reduce((sum, val) => sum + val, 0);
                const percentage = ((topCount / total) * 100).toFixed(1);
                topSpeciesInfo = `${topSpecies} (${percentage}%)`;
            }

            const tooltipOffsetX = 15; // horizontal shift (right)
            const tooltipOffsetY = 10; // vertical shift (down)

            d3.select("#tooltip")
                .style("display", "block")
                .style("left", `${event.pageX + tooltipOffsetX}px`)
                .style("top", `${event.pageY + tooltipOffsetY}px`)
                .html(`
                <strong>${name}</strong><br/>
                <strong>Detections:</strong> ${count}<br/>
                <strong>Top Species:</strong> ${topSpeciesInfo}
            `);
        })
        .on("mouseout", () => d3.select("#tooltip").style("display", "none"))
        .on("click", function (event, d) {
            zoomToState(d.id, d);
        });

    g.append("path")
        .datum(topojson.mesh(statesTopo, statesTopo.objects.states, (a, b) => a !== b))
        .attr("d", path)
        .attr("class", "state-border");

    g.append("path")
        .datum(topojson.mesh(statesTopo, statesTopo.objects.states, (a, b) => a === b))
        .attr("d", path)
        .attr("class", "national-border");

    svg.call(zoom);

    function reset() {
        svg.transition().duration(750).call(
            zoom.transform,
            d3.zoomIdentity,
            d3.zoomTransform(svg.node()).invert([width / 2, height / 2])
        );
    }

    function zoomed(event) {
        g.attr("transform", event.transform);
        g.attr("stroke-width", 0.5 / event.transform.k);
    }
}

function zoomToState(stateFIPS) {
    const width = 1115;
    const height = 700;
    const filteredCounties = window.countyGeoJson.features.filter(
        d => d.properties.STATEFP === stateFIPS
    );
    const stateCountiesGeoJSON = {
        type: "FeatureCollection",
        features: filteredCounties
    };
    const values = filteredCounties.map(d => {
        const state = d.properties.STATEFP;
        const county = d.properties.NAME.trim().toLowerCase();
        const key = `${state}_${county}`;
        return window.outbreakCounts[key] || 0;
    });
    const sorted = values.sort((a, b) => a - b);
    const p95Index = Math.floor(0.95 * sorted.length);
    const clampedMax = Math.max(sorted[p95Index] || 1, 10);

    const stepSize = clampedMax / 12;
    const colorRange = [
        "#e0f0ff",
        "#c2ddff",
        "#a3cbff",
        "#85b8ff",
        "#66a6ff",
        "#488dff",
        "#2a7bff",
        "#0c68ff",
        "#0055e6",
        "#0042b3",
        "#002d80"
    ];

    // thresholds at 5, 10, 15, ... 50
    const thresholds = d3.range(stepSize, clampedMax + stepSize, stepSize);

    const localColorScale = d3.scaleThreshold()
        .domain(thresholds)  // [5, 10, 15, ..., 50]
        .range(colorRange)

    // Clear previous map
    d3.select("#vis").selectAll("*").remove();
    d3.select("#legend").html("");

    const svg = d3.select("#vis")
        .append("svg")
        .attr("width", width)
        .attr("height", height)
        .style("opacity", 0);

    // Step 1: Use default projection just to get bounds
    const projection = d3.geoAlbersUsa().scale(1300).translate([width / 2, height / 2]);
    const geoPath = d3.geoPath().projection(projection);
    const [[x0, y0], [x1, y1]] = geoPath.bounds(stateCountiesGeoJSON);

    // Step 2: Calculate center and size
    const dx = x1 - x0;
    const dy = y1 - y0;
    const x = (x0 + x1) / 2;
    const y = (y0 + y1) / 2;

    // Step 3: Add padding manually
    const padding = 40;
    const fillRatio = 0.75;
    const scale = Math.max(1, Math.min(8, fillRatio / Math.max(dx / (width - padding * 2), dy / (height - padding * 2))));
    const xOffset = -80;  // tweak as needed
    const yOffset = 40;
    const translate = [
        width / 2 - scale * x + xOffset,
        height / 2 - scale * y - yOffset
    ];

    // Step 4: Apply base projection again with new transform
    const zoomedProjection = d3.geoAlbersUsa().scale(1300).translate([width / 2, height / 2]);
    const zoomedPath = d3.geoPath().projection(zoomedProjection);

    const g = svg.append("g");

    // Draw counties with original projection
    g.selectAll("path")
        .data(filteredCounties)
        .enter()
        .append("path")
        .attr("d", zoomedPath)
        .attr("fill", d => {
            const state = d.properties.STATEFP;
            const county = d.properties.NAME.trim().toLowerCase();
            const key = `${state}_${county}`;
            const count = window.outbreakCounts[key] || 0;
            return count > clampedMax ? "#002d80" : localColorScale(count);
        })
        .attr("class", "county")
        .attr("stroke", "#444")
        .attr("stroke-width", 0.5)
        .on("mouseover", function (event, d) {
            const state = d.properties.STATEFP;
            const county = d.properties.NAME.trim().toLowerCase();
            const key = `${state}_${county}`;
            const count = window.outbreakCounts[key] || 0;

            const speciesSet = window.countySpeciesMap[key];
            const speciesList = speciesSet ? Array.from(speciesSet).sort().join(", ") : "None reported";

            const stateName = Object.keys(stateToFIPS).find(k => stateToFIPS[k] === state) || "Unknown";

            d3.select("#tooltip")
                .style("display", "block")
                .style("left", `${event.pageX + 10}px`)
                .style("top", `${event.pageY - 28}px`)
                .html(`
            <strong>${d.properties.NAME}, ${stateName}</strong><br/>
            <strong>Detections:</strong> ${count}<br/>
            <strong>Species:</strong> ${speciesList}
        `);
        })
        .on("mouseout", () => d3.select("#tooltip").style("display", "none"));

    // Apply transform directly to the group for animated zoom
    g.transition()
        .duration(750)
        .attr("transform", `translate(${translate[0]},${translate[1]}) scale(${scale})`)
        .on("end", () => {
            const initialTransform = d3.zoomIdentity
                .translate(translate[0], translate[1])
                .scale(scale);
            svg.call(zoom.transform, initialTransform); // set zoom's internal state
        });

    // Add drag/zoom behavior
    const zoom = d3.zoom()
        .scaleExtent([1, 8])
        .on("zoom", event => {
            g.attr("transform", event.transform);
            g.selectAll("path").attr("stroke-width", 0.5 / event.transform.k); // scale stroke width
        });

    svg.call(zoom); // Activate zoom
    svg.transition().duration(600).style("opacity", 1);

    // Update the county-level legend
    drawZoomedLegend(localColorScale, clampedMax);

    // Show reset button
    d3.select("#reset-view").style("display", "inline-block");
}

function drawLegend(colorScale, maxValue) {
    const legendWidth = 200;
    const legendHeight = 10;
    const svg = d3.select("#legend")
        .append("svg")
        .attr("width", legendWidth + 60)
        .attr("height", 40);
    const defs = svg.append("defs");
    const linearGradient = defs.append("linearGradient")
        .attr("id", "legend-gradient");

    linearGradient.selectAll("stop")
        .data(d3.ticks(0, 1, 10))
        .enter()
        .append("stop")
        .attr("offset", d => `${d * 100}%`)
        .attr("stop-color", d => colorScale(d * maxValue));

    svg.append("rect")
        .attr("x", 30)
        .attr("y", 10)
        .attr("width", legendWidth)
        .attr("height", legendHeight)
        .style("fill", "url(#legend-gradient)");

    const legendScale = d3.scaleLinear()
        .domain([0, maxValue])
        .range([30, 30 + legendWidth]);

    const tickCount = 5;
    const tickValues = d3.ticks(0, maxValue, 5);
    const lastTick = tickValues[tickValues.length - 1];
    if (lastTick < maxValue) {
        tickValues.push(maxValue);
    }

    const axis = d3.axisBottom(legendScale)
        .tickValues(tickValues)
        .tickFormat((d, i) => {
            const isLast = i === tickValues.length - 1 && d >= maxValue;
            return isLast ? `${Math.round(d)}+` : Math.round(d);
        });

    svg.append("g")
        .attr("transform", `translate(0, ${10 + legendHeight})`)
        .call(axis);

    d3.select("#legend")
        .append("div")
        .text("Detections per State")
        .attr("class", "legend-label");
}

function drawZoomedLegend(colorScale, maxValue) {
    const legendWidth = 200;
    const legendHeight = 10;
    const svg = d3.select("#legend")
        .append("svg")
        .attr("width", legendWidth + 60)
        .attr("height", 50);
    const defs = svg.append("defs");
    const linearGradient = defs.append("linearGradient")
        .attr("id", "zoomed-legend-gradient");

    linearGradient.selectAll("stop")
        .data(d3.ticks(0, 1, 10))
        .enter()
        .append("stop")
        .attr("offset", d => `${d * 100}%`)
        .attr("stop-color", d => colorScale(d * maxValue));

    svg.append("rect")
        .attr("x", 30)
        .attr("y", 10)
        .attr("width", legendWidth)
        .attr("height", legendHeight)
        .style("fill", "url(#zoomed-legend-gradient)");

    const legendScale = d3.scaleLinear()
        .domain([0, maxValue])
        .range([30, 30 + legendWidth]);

    const tickCount = 5;
    const tickValues = d3.ticks(0, maxValue, 5);
    const lastTick = tickValues[tickValues.length - 1];
    if (lastTick < maxValue) {
        tickValues.push(maxValue);
    }

    const axis = d3.axisBottom(legendScale)
        .tickValues(tickValues)
        .tickFormat((d, i) => {
            const isLast = i === tickValues.length - 1 && d >= maxValue;
            return isLast ? `${Math.round(d)}+` : Math.round(d);
        });

    svg.append("g")
        .attr("transform", `translate(0, ${10 + legendHeight})`)
        .call(axis);

    d3.select("#legend")
        .append("div")
        .text("Detections per County (Zoomed View)")
        .attr("class", "legend-label");
}

function resetToNationalView() {
    const width = 1115;
    const height = 700;
    const svg = d3.select("#vis svg");

    svg.transition()
        .duration(500)
        .style("opacity", 0)
        .on("end", () => {
            d3.select("#vis").selectAll("*").remove();
            d3.select("#legend").html("");

            const statesTopo = window.statesTopo;
            const counties = window.countyGeoJson;
            const stateTotals = window.stateTotals;
            const colorScale = window.colorScale;

            createVis(counties, stateTotals, colorScale, statesTopo);
            drawLegend(colorScale, d3.max(Object.values(stateTotals)));

            d3.select("#reset-view").style("display", "none"); // hide again
        });
}

async function init() {
    try {
        const counties = await d3.json("./data/counties.geojson");
        const hpaiData = await d3.csv("./data/HPAI_Waterfowl_Only.csv");
        const statesTopo = await d3.json("https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json");

        const outbreakCounts = {};
        const stateTotals = {};
        const stateSpeciesFreqMap = {};      // e.g., "24" => Set(["Mallard", "Goose"])
        const countySpeciesMap = {};     // e.g., "24_baltimore" => Set(["Mallard"])

        hpaiData.forEach(d => {
            const stateCode = stateToFIPS[d.State];
            if (!stateCode || !d.County) return;

            const countyName = d.County.trim().toLowerCase();
            const species = d["Bird Species"]?.trim();
            const stateKey = stateCode;
            const countyKey = `${stateCode}_${countyName}`;

            // Count detections
            outbreakCounts[countyKey] = (outbreakCounts[countyKey] || 0) + 1;
            stateTotals[stateKey] = (stateTotals[stateKey] || 0) + 1;

            // Track species frequency per state
            if (!stateSpeciesFreqMap[stateKey]) stateSpeciesFreqMap[stateKey] = {};
            if (species) {
                stateSpeciesFreqMap[stateKey][species] = (stateSpeciesFreqMap[stateKey][species] || 0) + 1;
            }

            // Track species per county
            if (!countySpeciesMap[countyKey]) countySpeciesMap[countyKey] = new Set();
            if (species) countySpeciesMap[countyKey].add(species);
        });

        const colorRange = [
            "#e0f0ff",
            "#c2ddff",
            "#a3cbff",
            "#85b8ff",
            "#66a6ff",
            "#488dff",
            "#2a7bff",
            "#0c68ff",
            "#0055e6",
            "#0042b3",
            "#002d80"
        ];

        const maxCount = d3.max(Object.values(stateTotals));
        const colorScale = d3.scaleSequential()
            .domain([0, maxCount])
            .interpolator(d3.interpolateRgbBasis(colorRange));
        window.countyGeoJson = counties;
        window.outbreakCounts = outbreakCounts;
        window.colorScale = colorScale;
        window.stateTotals = stateTotals;
        window.statesTopo = statesTopo;
        window.countySpeciesMap = countySpeciesMap;
        window.stateSpeciesFreqMap = stateSpeciesFreqMap;

        createVis(counties, stateTotals, colorScale, statesTopo);
        drawLegend(colorScale, maxCount);
    } catch (error) {
        console.error("Error loading data or creating visualization:", error);
    }
}

// --------------LiNe Graph Stuff--------------------------------------------------------

const margin = { top: 80, right: 60, bottom: 60, left: 100 };
const width = 800 - margin.left - margin.right;
const height = 700 - margin.top - margin.bottom;


let allData = [];
let selectedBird = 'All'; // Default bird type

let xScale, yScale;


// Create SVG
const lineSvg = d3.select('#line-chart')
    .append('svg')
    .attr('width', width + margin.left + margin.right)
    .attr('height', height + margin.top + margin.bottom)
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);


function normalizeBirdName(name) {
    let cleaned = name
        .toLowerCase()
        .replace(/-/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();


    // Manual corrections for known typos or variants
    const manualFixes = {
        'northen pintail': 'Northern Pintail'
    };


    if (manualFixes[cleaned]) {
        return manualFixes[cleaned];
    }


    // Default title casing
    return cleaned
        .split(' ')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}


function initLineChart() {
    d3.csv("./data/HPAI_Waterfowl_Only.csv", d => {
        const date = new Date(d["Collection Date"]);
        const year = date.getFullYear();
        return {
            bird: normalizeBirdName(d["Bird Species"]),
            year: (year >= 2022 && year <= 2025) ? year : null
        };
    }).then(rawData => {
        // ⬇️ FILTER OUT bad years
        rawData = rawData.filter(d => d.year !== null);


        // ⬇️ GROUP and COUNT
        let nested = d3.rollup(
            rawData,
            v => v.length,
            d => d.bird,
            d => Math.floor(+d.year)  // Just in case
        );


        // ⬇️ FLATTEN data
        allData = [];
        nested.forEach((yearMap, bird) => {
            yearMap.forEach((cases, year) => {
                allData.push({ bird, year: +year, cases });
            });
        });


        setupSelector();
        updateAxes();
        updateVis();
    }).catch(error => console.error('Error loading data:', error));
}


function setupSelector() {
    let birdTypes = Array.from(new Set(allData.map(d => d.bird))).sort();
    birdTypes.unshift("All"); // Add "All" to the top of the list


    let birdDropdown = d3.select("#birdDropdown");


    birdDropdown.selectAll("option")
        .data(birdTypes)
        .enter()
        .append("option")
        .text(d => d)
        .attr("value", d => d);


    birdDropdown.property("value", selectedBird);


    birdDropdown.on("change", function () {
        selectedBird = d3.select(this).property("value");
        updateAxes();   // 👈 re-scale axes for selected bird
        updateVis();
    });
}


function updateAxes() {
    lineSvg.selectAll(".x-axis, .y-axis, .labels").remove();


    xScale = d3.scaleLinear()
        .domain([2022, 2025])
        .range([0, width]);


    // Filter based on bird selection
    const filtered = selectedBird === "All"
        ? allData
        : allData.filter(d => d.bird === selectedBird);


    const maxCases = d3.max(filtered, d => d.cases) || 100;


    // Round padded max to nearest 100 for consistency
    const baseStep = maxCases <= 100 ? 20 : 100;
    const roundedMax = Math.ceil(maxCases / baseStep) * baseStep;


    yScale = d3.scaleLinear()
        .domain([0, roundedMax])
        .range([height, 0]);


    // Tick values only go up to roundedMax
    const yTicks = d3.range(0, roundedMax + 1, baseStep);


    lineSvg.append("g")
        .attr("class", "y-axis")
        .call(d3.axisLeft(yScale).tickValues(yTicks));


    lineSvg.append("g")
        .attr("class", "x-axis")
        .attr("transform", `translate(0,${height})`)
        .call(d3.axisBottom(xScale).tickFormat(d3.format("d")).ticks(4));


    lineSvg.append("text")
        .attr("class", "labels")
        .attr("x", width / 2)
        .attr("y", height + margin.bottom - 20)
        .attr("text-anchor", "middle")
        .text("Year");


    lineSvg.append("text")
        .attr("class", "labels")
        .attr("transform", "rotate(-90)")
        .attr("x", -height / 2)
        .attr("y", -margin.left + 40)
        .attr("text-anchor", "middle")
        .text("Bird Flu Cases");
}


function updateVis() {
    lineSvg.selectAll(".bird-line, .data-point, .legend").remove();


    let birdsToShow = selectedBird === "All"
        ? Array.from(new Set(allData.map(d => d.bird)))
        : [selectedBird];


    const colorScale = d3.scaleOrdinal()
        .domain(birdsToShow)
        .range(d3.schemeTableau10); // Better variety than Category10


    birdsToShow.forEach(bird => {
        let filteredData = allData.filter(d => d.bird === bird);
        filteredData.sort((a, b) => a.year - b.year);


        const line = d3.line()
            .x(d => xScale(d.year))
            .y(d => yScale(d.cases));


        lineSvg.append("path")
            .datum(filteredData)
            .attr("class", "bird-line")
            .attr("fill", "none")
            .attr("stroke", colorScale(bird))
            .attr("stroke-width", 3)
            .attr("d", line)
            .on("mouseover", (event) => {
                d3.select("#tooltip")
                    .style("display", "block")
                    .html(`Bird: <strong>${bird}</strong>`)
                    .style("left", `${event.pageX + 10}px`)
                    .style("top", `${event.pageY - 10}px`);
            })
            .on("mousemove", (event) => {
                d3.select("#tooltip")
                    .style("left", `${event.pageX + 10}px`)
                    .style("top", `${event.pageY - 10}px`);
            })
            .on("mouseout", () => {
                d3.select("#tooltip").style("display", "none");
            });


        lineSvg.selectAll(`.data-point-${bird.replace(/\s+/g, '-')}`)
            .data(filteredData)
            .enter()
            .append("circle")
            .attr("class", "data-point")
            .attr("cx", d => xScale(d.year))
            .attr("cy", d => yScale(d.cases))
            .attr("r", 3)
            .attr("fill", colorScale(bird))
            .on("mouseover", (event, d) => {
                d3.select("#tooltip")
                    .style("display", "block")
                    .html(`Bird: ${d.bird}<br>Year: ${d.year}<br>Cases: ${d.cases}`)
                    .style("left", `${event.pageX + 10}px`)
                    .style("top", `${event.pageY - 10}px`);
            })
            .on("mouseout", () => {
                d3.select("#tooltip").style("display", "none");
            });
    });


    // Add a clean, visible legend
    birdsToShow.forEach((bird, i) => {
        const legendX = width - 200;


        lineSvg.append("circle")
            .attr("class", "legend")
            .attr("cx", legendX)
            .attr("cy", i * 20)
            .attr("r", 5)
            .attr("fill", colorScale(bird));


        lineSvg.append("text")
            .attr("class", "legend")
            .attr("x", legendX + 10)
            .attr("y", i * 20 + 4)
            .text(bird)
            .attr("alignment-baseline", "middle")
            .style("font-size", "12px")
            .style("fill", "#000"); // Ensure text is visible
    });
}

initLineChart();

//---------------------------------------------------------------------------------------


document.getElementById("reset-view").addEventListener("click", resetToNationalView);
window.addEventListener("load", init);