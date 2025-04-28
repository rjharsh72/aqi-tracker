const loginForm = document.getElementById('login-form');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const loginContainer = document.getElementById('login-container');
const dashboardContainer = document.getElementById('dashboard-container');
const mapContainer = document.getElementById('map');
const API_URL = window.location.hostname === 'localhost' 
  ? 'http://localhost:5000' 
  : 'https://aqi-tracker-backend.onrender.com';

let token = '';
let map = null;
let isLoading = false;

// Handle Login
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const username = usernameInput.value;
  const password = passwordInput.value;

  try {
   // const response = await fetch('http://localhost:5000/login', 
   const response = await fetch(`${API_URL}/login`,{
      
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    const data = await response.json();

    if (response.ok) {
      token = data.token;
      loginContainer.style.display = 'none';
      dashboardContainer.style.display = 'block';

      initializeMap();
      loadMapData();
    } else {
      alert(data.message || 'Login failed');
    }
  } catch (error) {
    console.error('Login error:', error);
    alert('Login failed. Server may be unavailable.');
  }
});

// Initialize the Map
function initializeMap() {
  console.log('Initializing map...');

  try {
    map = L.map('map').setView([28.6139, 77.2090], 10); // Delhi center

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    setTimeout(() => {
      map.invalidateSize();
      console.log('Map resized');
    }, 100);
  } catch (error) {
    console.error('Map initialization error:', error);
    alert('Error initializing map. Please refresh the page.');
  }
}

// Show loading indicator
function showLoadingIndicator() {
  removeLoadingIndicator();

  const loadingDiv = document.createElement('div');
  loadingDiv.id = 'loading-indicator';
  loadingDiv.innerHTML = 'Loading AQI data...';
  loadingDiv.style.position = 'absolute';
  loadingDiv.style.top = '50%';
  loadingDiv.style.left = '50%';
  loadingDiv.style.transform = 'translate(-50%, -50%)';
  loadingDiv.style.background = 'rgba(255,255,255,0.8)';
  loadingDiv.style.padding = '10px';
  loadingDiv.style.borderRadius = '5px';
  loadingDiv.style.zIndex = '1000';
  dashboardContainer.appendChild(loadingDiv);
}

// Remove loading indicator
function removeLoadingIndicator() {
  const loadingDiv = document.getElementById('loading-indicator');
  if (loadingDiv) {
    loadingDiv.remove();
  }
}

// Load AQI Data and Place Pins FAST
async function loadMapData() {
  if (isLoading) return;
  isLoading = true;

  console.log('Loading map data...');
  try {
    showLoadingIndicator();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    //const response = await fetch('http://localhost:5000/getAqiData', {
    const response = await fetch(`${API_URL}/getAqiData`, {
      headers: { 'Authorization': `Bearer ${token}` },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Server returned error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log('Fetched AQI data:', data);

    if (!data || data.length === 0) {
      alert('No AQI data available.');
      removeLoadingIndicator();
      return;
    }

    const bounds = L.latLngBounds();

    data.forEach(entry => {
      const { lat, lng, customerName, location, aqi, isDefaultLocation } = entry;

      if (!lat || !lng) {
        console.warn(`Invalid coordinates for ${customerName} at ${location}`);
        return;
      }

      let color;
      const aqiNum = parseInt(aqi);
      if (aqiNum <= 50) color = 'green';
      else if (aqiNum <= 100) color = 'yellow';
      else if (aqiNum <= 150) color = 'orange';
      else if (aqiNum <= 200) color = 'red';
      else color = 'purple';

      const marker = L.circleMarker([lat, lng], {
        color: color,
        fillColor: color,
        fillOpacity: 0.6,
        radius: 8,
        weight: 2
      });

      let popupContent = `<strong>${customerName}</strong><br>${location}<br>AQI: ${aqi}`;
      if (isDefaultLocation) popupContent += '<br><em>(Approximate location)</em>';

      marker.bindPopup(popupContent);
      marker.addTo(map);
      bounds.extend([lat, lng]);
    });

    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, { padding: [50, 50] });
    }

    addLegend();
    removeLoadingIndicator();
    console.log('All markers added and loading indicator removed.');

  } catch (error) {
    console.error('Error loading map data:', error);
    removeLoadingIndicator();
  } finally {
    isLoading = false;
  }
}

// Add a color legend to explain AQI levels
function addLegend() {
  const legend = L.control({ position: 'bottomright' });

  legend.onAdd = function(map) {
    const div = L.DomUtil.create('div', 'info legend');
    div.style.backgroundColor = 'white';
    div.style.padding = '10px';
    div.style.borderRadius = '5px';
    div.style.boxShadow = '0 0 15px rgba(0,0,0,0.2)';

    const grades = [0, 51, 101, 151, 201];
    const labels = ['Good', 'Moderate', 'Unhealthy for Sensitive Groups', 'Unhealthy', 'Very Unhealthy'];
    const colors = ['green', 'yellow', 'orange', 'red', 'purple'];

    div.innerHTML = '<h4>AQI Legend</h4>';

    for (let i = 0; i < grades.length; i++) {
      div.innerHTML +=
        '<div style="display: flex; align-items: center; margin-bottom: 5px;">' +
        `<div style="background: ${colors[i]}; width: 15px; height: 15px; border-radius: 50%; margin-right: 5px;"></div>` +
        `<span>${grades[i]}${grades[i+1] ? '&ndash;' + (grades[i+1]-1) : '+'} - ${labels[i]}</span>` +
        '</div>';
    }
    return div;
  };

  legend.addTo(map);
}
