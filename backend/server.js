require('dotenv').config();
const jwt = require('jsonwebtoken');
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const csv = require('csv-parser');
const fs = require('fs');
const app = express();
const JWT_SECRET = 'your-secret-key';

app.use(cors({
    origin: process.env.NODE_ENV === 'production' 
    ? 'https://aqi-tracker-frontend.onrender.com' 
    : '*' // Replace with your frontend URL
  }));
app.use(express.json());

const PORT = process.env.PORT || 5000;

// Example login data (can be replaced with a real authentication system)
const users = [{ username: 'admin', password: 'admin' }];

// Cache for CSV data and geocoded locations to improve performance
let csvDataCache = null;
let csvLastFetched = null;
const CSV_CACHE_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds
const geocodeCache = new Map();

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

// Improved CSV fetching from Google Drive with caching
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

// Optimized geocoding with caching and parallel processing
async function geocodeLocation(location) {
  // Check if location is already cached
  if (geocodeCache.has(location)) {
    return geocodeCache.get(location);
  }

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
      
      // Cache the result
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

// Middleware to verify JWT token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) return res.status(401).json({ message: 'No token provided' });
  
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: 'Invalid or expired token' });
    req.user = user;
    next();
  });
}

// Optimized endpoint to get AQI data with batch processing and parallel geocoding
app.get('/getAqiData', authenticateToken, async (req, res) => {
  try {
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
          
          const geocode = await geocodeLocation(locationName);
          
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

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
