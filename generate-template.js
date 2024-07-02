const Config = require("./helper/export-env")(
  "DB_PATH",
  "ACCESS_TOKEN",
  "SOURCE_PATH"
)

const Alerts = require("./alert-types.json")
const Database = require('better-sqlite3');
const fs = require('fs');

// Database configuration
const db = new Database(Config["DB_PATH"]);

// Function to fetch data from the database
function fetchData() {
  const stmt = db.prepare('SELECT * FROM data');
  const data = stmt.all();
  return data;
}

// Fetch data from the database
const alertData = fetchData();

// Put it in GeoJSON format
const alertFeatures = alertData.map(alert => ({
  "type": "Feature",
  "geometry": {
    "type": "Point",
    "coordinates": [alert.longitude, alert.latitude]
  },
  "properties": {
    "type": alert.type,
    "pubMillis": alert.pubMillis,
    "display": Alerts["display"][alert.type],
  }
}))

// Create an array of indices
const indices = alertData.map((_, index) => index);

// Sort the indices based on the EPOCH
const sortedIndicesByEPOCH = indices.sort((a, b) => alertData[a].pubMillis - alertData[b].pubMillis);

// Sort the indices based on the longitude
const sortedIndicesByLongitude = indices.sort((a, b) => alertData[a].longitude - alertData[b].longitude);

// Sort the indices based on the latitude
const sortedIndicesByLatitude = indices.sort((a, b) => alertData[a].latitude - alertData[b].latitude);

// Convert data to GeoJSON format
const geojsonData = {
  "type": "FeatureCollection",
  "features": alertFeatures
}

const sortedData = {
  "epoch": sortedIndicesByEPOCH,
  "longitude": sortedIndicesByLongitude,
  "latitude": sortedIndicesByLatitude
}

// Save GeoJSON data to a file
fs.writeFileSync(`${Config["SOURCE_PATH"]}/geojson.json`, JSON.stringify(geojsonData))
fs.writeFileSync(`${Config["SOURCE_PATH"]}/sorted.json`, JSON.stringify(sortedData))

const alertColours = {};

const ColourMap = [
  'red', // ACCIDENT
  'yellow', // HAZARD
  'purple', // ROAD CLOSED
  'orange', // JAM
  'cyan' // POLICE
]

Object.values(Alerts.types).forEach(index => {
  alertColours[index] = ColourMap[index]
  getChildrenIterable(index).forEach(subIndex => {
    alertColours[subIndex] = ColourMap[index]
  })
})

function getChildrenIterable(index) {
  const start = Alerts.children[index][0]
  const end = Alerts.children[index][1]
  const arr = []

  for (let i = start; i <= end; i++) {
    arr.push(i)
  }

  return arr
}

function displayFiltersHTML() {
  return Object.entries(Alerts.types).map(([type, index]) => `
  <div>
    <span style="user-select: none;">
      <input type="checkbox" id="${Alerts.display[index]}" name="alertType" value="${Alerts.display[index]}" checked onclick="toggleSubtypeVisibility('${Alerts.display[index]}')">
      <label for="${Alerts.display[index]}">${Alerts.display[index]}</label>
    </span>
    <div id="${Alerts.display[index]}-subtypes" style="margin-left: 2em;">
      ${getChildrenIterable(index).map(subIndex => `
        <span style="user-select: none;">
          <input type="checkbox" id="${Alerts.display[subIndex]}" name="alertType" value="${Alerts.display[subIndex]}" checked>
          <label for="${Alerts.display[subIndex]}">${Alerts.display[subIndex]}</label><br>
        </span>
      `).join('')}
    </div>
  </div>
`).join('')
}

// Generate HTML content
const htmlContent = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Waze Alerts Heatmap</title>
<meta name="viewport" content="initial-scale=1,maximum-scale=1,user-scalable=no">
<link href="https://api.mapbox.com/mapbox-gl-js/v3.0.1/mapbox-gl.css" rel="stylesheet">
<script src="https://api.mapbox.com/mapbox-gl-js/v3.0.1/mapbox-gl.js"></script>
<style>
body { margin: 0; padding: 0; }
#map { position: absolute; top: 0; bottom: 0; width: 100%; }
#controls {
  position: absolute;
  top: 1em;
  left: 1em;
  background-color: rgba(255, 255, 255, 0.8);
  padding: 1em;
  border-radius: 0.5em;
}
</style>
</head>
<body>
<div id="map"></div>
<div id="controls">
  <h3>Display Filter</h3>
  ${displayFiltersHTML()}
</div>

<script>
  // TO MAKE THE MAP APPEAR YOU MUST
  // ADD YOUR ACCESS TOKEN FROM
  // https://account.mapbox.com
  mapboxgl.accessToken = '${Config["ACCESS_TOKEN"]}'; // Replace with your Mapbox access token
  const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/dark-v11',
    center: [134.2383, -23.6980], // Center the map on Australia
    zoom: 4
  });

  // Alert colors (generated by the server)
  const alertColours = ${JSON.stringify(alertColours)};

  // Fetch GeoJSON data and store it globally
  let alertData = null; 
  let alertFeatures = null;

  fetch('./geojson.json')
    .then(response => response.json())
    .then(data => {
      alertData = data.features.map(feature => ({
        latitude: feature.geometry.coordinates[1],
        longitude: feature.geometry.coordinates[0],
        type: feature.properties.type,
        pubMillis: feature.properties.pubMillis,
        display: feature.properties.display
      }));
      alertFeatures = data.features;

      // Fetch sorted data
      fetch('./sorted.json')
        .then(response => response.json())
        .then(sortedData => {
          // Store sorted indices globally
          window.sortedData = sortedData;

          // Now that both alertData and sortedData are loaded, add the source and layers
          addMapLayers();

          // Now that the layers are added, update the filter
          updateAlertFilter();
        });
    });

  // Function to add the map source and layers
  function addMapLayers() {
    // Add the GeoJSON source
    map.addSource('alerts', {
      type: 'geojson',
      data: {
        "type": "FeatureCollection",
        "features": [] // Initially empty, will be populated by filterAlertsByBounds
      }
    });

    // Add a heatmap layer
    map.addLayer({
      id: 'alerts-heat',
      type: 'heatmap',
      source: 'alerts',
      maxzoom: 9,
      paint: {
        'heatmap-weight': ['get', 'mag'],
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 1, 9, 3],
        'heatmap-color': [
          'interpolate',
          ['linear'],
          ['heatmap-density'],
          0,
          'rgba(33,102,172,0)',
          0.2,
          'rgb(103,169,207)',
          0.4,
          'rgb(209,229,240)',
          0.6,
          'rgb(253,219,199)',
          0.8,
          'rgb(239,138,98)',
          1,
          'rgb(178,24,43)'
        ],
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 2, 9, 20],
        'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 7, 1, 9, 0]
      }
    }, 'waterway-label');

    // Add a circle layer for individual alerts
    map.addLayer({
      id: 'alerts-point',
      type: 'circle',
      source: 'alerts',
      minzoom: 7,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 1, 16, 5],
        'circle-color': [
          'match',
          ['get', 'type'],
          ...Object.entries(alertColours).flatMap(([type, color]) => [parseInt(type), color]),
          'gray' // Default color
        ],
        'circle-stroke-color': 'white',
        'circle-stroke-width': 1,
        'circle-opacity': ['interpolate', ['linear'], ['zoom'], 7, 0, 8, 1]
      }
    }, 'waterway-label');
  }

  // Event listener for checkbox changes
  const checkboxes = document.querySelectorAll('input[name="alertType"]');
  let isMouseDown = false;
  let isFirstChecked = false;
  let hasChecked = false;

  document.addEventListener('mousedown', () => {
    isMouseDown = true;
  });

  document.addEventListener('mouseup', () => {
    isMouseDown = false;
    hasChecked = false;
  });

  checkboxes.forEach(checkbox => {
    const checkboxContainer = checkbox.parentElement; // Get the parent <span>
    checkboxContainer.addEventListener('mouseover', () => { // Use mouseover
      if (isMouseDown) {
        if (!hasChecked) {
          isFirstChecked = checkbox.checked;
          hasChecked = true;
        }

        if (checkbox.checked === isFirstChecked) {
          checkbox.checked = !isFirstChecked
        }
        
        updateAlertFilter();
      }
    });
  });

  // Function to update the filter based on selected checkboxes
  function updateAlertFilter() {
    const selectedTypes = [];
    checkboxes.forEach(checkbox => {
      if (checkbox.checked) {
        selectedTypes.push(checkbox.value);
      }
    });

    filterAlertsByBounds(selectedTypes);
  }

  // Function to filter alerts by bounds and selected types
  function filterAlertsByBounds(selectedTypes) {
    if (!alertData || !window.sortedData || !map.getSource('alerts')) {
      // Data or source not loaded yet, do nothing
      return; 
    }

    const bounds = map.getBounds();
    const visibleFeatures = [];

    // Binary search for latitude bounds
    const latStart = binarySearchIndex(window.sortedData.latitude, bounds._sw.lat, 'latitude');
    const latEnd = binarySearchIndex(window.sortedData.latitude, bounds._ne.lat, 'latitude', false);

    // Iterate through latitude-filtered indices
    for (let i = latStart; i <= latEnd; i++) {
      const alertIndex = window.sortedData.latitude[i];
      const alert = alertData[alertIndex];

      // Check if longitude is within bounds
      if (alert.longitude >= bounds._sw.lng && alert.longitude <= bounds._ne.lng && selectedTypes.includes(alert.display)) {
        visibleFeatures.push(alertFeatures[alertIndex]);
      }
    }

    // Update the map source with filtered data
    map.getSource('alerts').setData({
      "type": "FeatureCollection",
      "features": visibleFeatures
    });
  }

  // Binary search helper function
  function binarySearchIndex(arr, target, property, findFirst = true) {
    let low = 0;
    let high = arr.length - 1;
    let result = -1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const value = alertData[arr[mid]][property];

      if (value === target) {
        return mid;
      } else if (value < target) {
        low = mid + 1;
        if (!findFirst) {
          result = mid; // Keep track of last index less than target
        }
      } else {
        high = mid - 1;
        if (findFirst) {
          result = mid; // Keep track of first index greater than target
        }
      }
    }

    return result;
  }

  // Function to toggle subtype visibility
  function toggleSubtypeVisibility(parentType) {
    const subtypeContainer = document.getElementById(parentType + "-subtypes");
    const parentCheckbox = document.getElementById(parentType);

    if (subtypeContainer && parentCheckbox) {
      subtypeContainer.style.display = parentCheckbox.checked ? 'block' : 'none';

      // Uncheck all subtypes when parent is unchecked
      if (!parentCheckbox.checked) {
        subtypeContainer.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
          checkbox.checked = false;
        });
      }

      // Update the filter after toggling visibility
      updateAlertFilter();
    }
  }

  // Initial filtering on load (will be called after data is loaded)
  // updateAlertFilter();

  // Update data on map move
  map.on('moveend', () => {
    updateAlertFilter();
  });
</script>

</body>
</html>
`;

// Save HTML content to a file
fs.writeFileSync(`${Config["SOURCE_PATH"]}/index.html`, htmlContent);

// Log success message
console.log('Static HTML file generated successfully!');