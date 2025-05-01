// Global variables
const loginForm = document.getElementById('login-form');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const loginContainer = document.getElementById('login-container');
const dashboardContainer = document.getElementById('dashboard-container');
const mapContainer = document.getElementById('map');
const refreshButton = document.getElementById('refresh-data');
const lastUpdatedSpan = document.getElementById('last-updated');
const dataErrorDiv = document.getElementById('data-error');
const dataSuccessDiv = document.getElementById('data-success');
const REFRESH_INTERVAL = 0.2 * 60 * 1000;

let token = '';
let map = null;
let isLoading = false;
let lastUpdated = null;
let autoRefreshInterval = null;

// Handle Login
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const username = usernameInput.value;
  const password = passwordInput.value;

  try {
     const response = await fetch('http://localhost:5000/login', {
    //const response = await fetch('https://aqi-tracker-1.onrender.com/login', {
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
      startAutoRefresh();
    } else {
      alert(data.message || 'Login failed');
    }
  } catch (error) {
    console.error('Login error:', error);
    alert('Login failed. Server may be unavailable.');
  }
});

// Add this after successful login in your login form event listener
function startAutoRefresh() {
    // Clear any existing interval first
    if (autoRefreshInterval) {
      clearInterval(autoRefreshInterval);
    }
    
    // Set up the new interval
    autoRefreshInterval = setInterval(() => {
      console.log('Auto-refreshing data...');
      loadMapData(false); // Regular refresh, not force refresh
    }, REFRESH_INTERVAL);
  }

// Refresh button event listener
refreshButton.addEventListener('click', () => {
  loadMapData(true); // Pass true to force refresh
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

// Load AQI Data and Place Pins
async function loadMapData(forceRefresh = false) {
  if (isLoading) return;
  isLoading = true;

  console.log('Loading map data...');
  try {
    showLoadingIndicator();
    
    // Clear existing markers if we're refreshing
    if (map && forceRefresh) {
      map.eachLayer(layer => {
        if (layer instanceof L.CircleMarker) {
          map.removeLayer(layer);
        }
      });
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    // Update the URL to include the forceRefresh query parameter
    const refreshParam = forceRefresh ? '?refresh=true' : '';
    //const response = await fetch(`https://aqi-tracker-1.onrender.com/getAqiData${refreshParam}`, {
    const response = await fetch('http://localhost:5000/getAqiData', { 
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
      showError('No AQI data available.');
      removeLoadingIndicator();
      return;
    }

    // Create a new bounds object
    const bounds = new L.LatLngBounds();
    let hasValidCoordinates = false;

    data.forEach(entry => {
      const { lat, lng, customerName, location, aqi, isDefaultLocation } = entry;

      if (!lat || !lng) {
        console.warn(`Invalid coordinates for ${customerName} at ${location}`);
        return;
      }

      // Make sure we're working with numbers
      const latNum = parseFloat(lat);
      const lngNum = parseFloat(lng);

      if (isNaN(latNum) || isNaN(lngNum)) {
        console.warn(`Invalid coordinate values for ${customerName} at ${location}`);
        return;
      }

      hasValidCoordinates = true;

      let color;
      const aqiNum = parseInt(aqi);
      if (aqiNum <= 50) color = 'green';
      else if (aqiNum <= 100) color = 'yellow';
      else if (aqiNum <= 150) color = 'orange';
      else if (aqiNum <= 200) color = 'red';
      else color = 'purple';

      const marker = L.circleMarker([latNum, lngNum], {
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
      
      // Add coordinates to bounds
      bounds.extend([latNum, lngNum]);
    });

    // Only fit bounds if we have valid coordinates
    if (hasValidCoordinates) {
      // Check if bounds is valid before using it
      if (bounds.isValid && bounds.isValid()) {
        map.fitBounds(bounds, { padding: [50, 50] });
      } else {
        console.warn('Invalid bounds object, using default view');
        map.setView([28.6139, 77.2090], 10); // Default to Delhi center
      }
    }

    // Only add legend if it doesn't exist already
    if (!document.querySelector('.legend')) {
      addLegend();
    }
    
    // Update last updated timestamp
    lastUpdated = new Date();
    updateLastUpdatedDisplay();
    
    // Show success message if this was a manual refresh
    if (forceRefresh) {
      showSuccess('Data refreshed successfully!');
    }
    
    removeLoadingIndicator();
    console.log('All markers added and loading indicator removed.');

  } catch (error) {
    console.error('Error loading map data:', error);
    showError(`Failed to load AQI data: ${error.message}`);
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

// Helper functions for UI messaging
function showError(message) {
  dataErrorDiv.textContent = message;
  dataErrorDiv.style.display = 'block';
  setTimeout(() => {
    dataErrorDiv.style.display = 'none';
  }, 5000); // Hide after 5 seconds
}

function showSuccess(message) {
  dataSuccessDiv.textContent = message;
  dataSuccessDiv.style.display = 'block';
  setTimeout(() => {
    dataSuccessDiv.style.display = 'none';
  }, 5000); // Hide after 5 seconds
}

function updateLastUpdatedDisplay() {
  if (lastUpdated) {
    lastUpdatedSpan.textContent = `Last updated: ${lastUpdated.toLocaleTimeString()}`;
  } else {
    lastUpdatedSpan.textContent = '';
  }
}
