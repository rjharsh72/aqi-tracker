require('dotenv').config();
const jwt = require('jsonwebtoken');
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const csv = require('csv-parser');
const fs = require('fs');
const app = express();
const JWT_SECRET = 'your-secret-key';

app.use(cors(
    //{ origin: 'https://aqi-tracker-2.onrender.com/' // Replace with your frontend URL}
));
app.use(express.json());

const PORT = process.env.PORT || 5000;

// Example login data (can be replaced with a real authentication system)
const users = [{ username: 'admin', password: 'admin' }];

// Cache for CSV data and geocoded locations to improve performance
let csvDataCache = null;
let csvLastFetched = null;
const CSV_CACHE_TTL = 1 * 60 * 1000; // 1 minutes in milliseconds
const geocodeCache = new Map();

// Middleware to authenticate JWT token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token == null) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
}

// Login endpoint (basic, no password hashing for simplicity)
app.post('/login', (req, res) => {
  const { username, password } = req.body;

  const user = users.find(u => u.username === username && u.password === password);

  if (user) {
    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ token });
  } else {
    res.status(401).json({ message: 'Invalid credentials' });
  }
});

// Modify the fetchCSV function to respect the shorter cache time
async function fetchCSV() {
  // Check if we have valid cached data
  if (csvDataCache && csvLastFetched && (Date.now() - csvLastFetched < CSV_CACHE_TTL)) {
    console.log('Using cached CSV data');
    return csvDataCache;
  }

  return new Promise(async (resolve, reject) => {
    try {
      console.log('Fetching fresh CSV data...');
      const fileUrl = 'https://drive.google.com/uc?export=download&id=1JdNpw9g9KOMWYWT82Uwcd2p9Grrw_gsr'; // Your file ID
      const response = await axios.get(fileUrl, { responseType: 'stream' });
      const data = [];
      
      response.data
        .pipe(csv())
        .on('data', (row) => {
          data.push(row);
        })
        .on('end', () => {
          console.log('CSV file processed successfully!');
          console.log(`Loaded ${data.length} rows from CSV`);
          
          // Update cache
          csvDataCache = data;
          csvLastFetched = Date.now();
          
          resolve(data);
        })
        .on('error', (error) => {
          console.error('Error parsing CSV:', error);
          reject(error);
        });
    } catch (error) {
      console.error('Error fetching CSV file:', error);
      reject(error);
    }
  });
}

// Geocode location with caching
async function geocodeLocation(location) {
  // Check cache first
  if (geocodeCache.has(location)) {
    console.log(`Using cached geocode for: ${location}`);
    return geocodeCache.get(location);
  }
  
  // If not in cache, fetch fresh data
  return geocodeLocationFresh(location);
}

// Function to bypass the geocode cache when needed
async function geocodeLocationFresh(location) {
  try {
    // Add shorter delay to avoid rate limiting but improve performance
    await new Promise(resolve => setTimeout(resolve, 300));
    
    const response = await axios.get(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(location)}`,
      {
        headers: {
          'User-Agent': 'AQI-Tracker-App/1.0'
        },
        timeout: 5000 // Add timeout to prevent long-hanging requests
      }
    );
    
    if (response.data && response.data.length > 0) {
      const locationData = response.data[0];
      const result = { 
        lat: parseFloat(locationData.lat), 
        lng: parseFloat(locationData.lon) 
      };
      
      // Update the cache with the fresh result
      geocodeCache.set(location, result);
      return result;
    } else {
      console.warn(`Location not found: ${location}`);
      // Return a default location with a flag indicating it's a default
      const defaultLocation = { lat: 28.6139, lng: 77.2090, isDefault: true };
      geocodeCache.set(location, defaultLocation);
      return defaultLocation;
    }
  } catch (error) {
    console.error(`Geocoding error for "${location}":`, error.message);
    // Return a default location with a flag indicating it's a default
    const defaultLocation = { lat: 28.6139, lng: 77.2090, isDefault: true };
    geocodeCache.set(location, defaultLocation);
    return defaultLocation;
  }
}

// Updated getAqiData endpoint with refresh parameter
app.get('/getAqiData', authenticateToken, async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === 'true';
    
    // Invalidate cache if force refresh requested
    if (forceRefresh) {
      csvDataCache = null;
      csvLastFetched = null;
      console.log('Cache cleared due to force refresh request');
    }
    
    console.log('Fetching CSV data...');
    const csvData = await fetchCSV();
    console.log(`Processing ${csvData.length} CSV entries`);
    
    // Process locations in parallel batches to improve performance
    const BATCH_SIZE = 5; // Process 5 locations at a time
    const results = [];
    
    for (let i = 0; i < csvData.length; i += BATCH_SIZE) {
      const batch = csvData.slice(i, i + BATCH_SIZE);
      
      // Process batch in parallel
      const batchPromises = batch.map(async (entry) => {
        try {
          const locationName = entry['Location Name'];
          console.log(`Geocoding: ${locationName}`);
          
          // If force refresh is true, skip the geocode cache
          let geocode;
          if (forceRefresh) {
            // Skip the cache and force new geocoding
            geocode = await geocodeLocationFresh(locationName);
          } else {
            geocode = await geocodeLocation(locationName);
          }
          
          return {
            customerName: entry['Customer Name'],
            location: locationName,
            aqi: parseInt(entry['AQI']),
            lat: geocode.lat,
            lng: geocode.lng,
            isDefaultLocation: geocode.isDefault || false
          };
        } catch (error) {
          console.error('Error processing entry:', error);
          return null;
        }
      });
      
      // Wait for all geocoding in this batch to complete
      const batchResults = await Promise.all(batchPromises);
      
      // Add valid results to the final results array
      results.push(...batchResults.filter(result => result !== null));
    }
    
    console.log(`Sending ${results.length} processed results`);
    res.json(results);
  } catch (error) {
    console.error('Error in /getAqiData endpoint:', error);
    res.status(500).json({ message: 'Error fetching data', error: error.message });
  }
});

// Add a dedicated endpoint to clear all caches
app.post('/clearCache', authenticateToken, (req, res) => {
  try {
    geocodeCache.clear();
    csvDataCache = null;
    csvLastFetched = null;
    console.log('All caches cleared via API request');
    res.json({ message: 'Cache cleared successfully' });
  } catch (error) {
    console.error('Error clearing cache:', error);
    res.status(500).json({ message: 'Error clearing cache', error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
