#!/usr/bin/env node
/**
 * Weather Market Scraper for Polymarket
 * 
 * Scrapes weather markets and compares with Open-Meteo forecasts
 * to find arbitrage opportunities
 * 
 * Usage: node weather-scraper.js
 */

require('dotenv').config();
const axios = require('axios');

// Cities with their coordinates
const CITIES = {
  'NYC': { lat: 40.71, lon: -74.01, unit: 'F' },
  'London': { lat: 51.51, lon: -0.13, unit: 'C' },
  'Seoul': { lat: 37.57, lon: 126.98, unit: 'C' },
  'Atlanta': { lat: 33.75, lon: -84.39, unit: 'F' },
  'Chicago': { lat: 41.88, lon: -87.63, unit: 'F' },
  'Dallas': { lat: 32.78, lon: -96.80, unit: 'F' },
  'Miami': { lat: 25.76, lon: -80.19, unit: 'F' },
  'Seattle': { lat: 47.61, lon: -122.33, unit: 'F' },
  'Buenos Aires': { lat: -34.60, lon: -58.38, unit: 'C' },
  'Ankara': { lat: 39.93, lon: 32.86, unit: 'C' },
  'Wellington': { lat: -41.29, lon: 174.78, unit: 'C' },
  'Toronto': { lat: 43.65, lon: -79.38, unit: 'F' },
};

const CONFIG = {
  entryThreshold: 0.15,  // 15¢
  exitThreshold: 0.45,   // 45¢
  minEdge: 0.10,         // 10% minimum edge
};

/**
 * Fetch forecast from Open-Meteo
 */
async function getForecast(city) {
  const coords = CITIES[city];
  if (!coords) return null;

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&daily=temperature_2m_max&timezone=auto&forecast_days=5`;
  
  try {
    const response = await axios.get(url, { timeout: 10000 });
    const data = response.data;
    
    return data.daily.time.map((date, i) => ({
      date,
      highC: data.daily.temperature_2m_max[i],
      highF: Math.round(data.daily.temperature_2m_max[i] * 9/5 + 32),
    }));
  } catch (error) {
    console.error(`Forecast error for ${city}:`, error.message);
    return null;
  }
}

/**
 * Parse bucket string to get range
 */
function parseBucket(bucketStr, unit) {
  // "30-31°F" -> { min: 30, max: 31 }
  let match = bucketStr.match(/(\d+)-(\d+)/);
  if (match) {
    return { min: parseInt(match[1]), max: parseInt(match[2]) };
  }
  
  // "36°F or higher" -> { min: 36, max: 999 }
  match = bucketStr.match(/(\d+).*or higher/i);
  if (match) {
    return { min: parseInt(match[1]), max: 999 };
  }
  
  // "25°F or below" -> { min: -999, max: 25 }
  match = bucketStr.match(/(\d+).*or below/i);
  if (match) {
    return { min: -999, max: parseInt(match[1]) };
  }
  
  return null;
}

/**
 * Check if forecast falls within bucket
 */
function forecastInBucket(forecast, bucket, tolerance = 1) {
  return forecast >= (bucket.min - tolerance) && forecast <= (bucket.max + tolerance);
}

/**
 * Analyze opportunities from scraped data
 */
async function analyzeOpportunities() {
  console.log('🌡️  Weather Arbitrage Scanner');
  console.log('━'.repeat(60));
  console.log(`Config: Entry <${CONFIG.entryThreshold*100}¢ | Exit >${CONFIG.exitThreshold*100}¢\n`);

  // Get forecasts for all cities
  const forecasts = {};
  for (const city of Object.keys(CITIES)) {
    process.stdout.write(`📡 Fetching ${city}... `);
    forecasts[city] = await getForecast(city);
    console.log(forecasts[city] ? '✓' : '✗');
    await new Promise(r => setTimeout(r, 200));
  }

  console.log('\n' + '━'.repeat(60));
  console.log('📊 FORECASTS (Next 3 days)');
  console.log('━'.repeat(60));

  for (const [city, data] of Object.entries(forecasts)) {
    if (!data) continue;
    const unit = CITIES[city].unit;
    const temps = data.slice(0, 3).map(d => 
      unit === 'F' ? `${d.highF}°F` : `${d.highC}°C`
    );
    console.log(`${city.padEnd(15)} ${temps.join('  →  ')}`);
  }

  console.log('\n' + '━'.repeat(60));
  console.log('🎯 POTENTIAL ARBITRAGE OPPORTUNITIES');
  console.log('(Based on scraped page data - run with browser for live prices)');
  console.log('━'.repeat(60));

  // Example analysis based on what we saw in NYC
  const nycForecast = forecasts['NYC'];
  if (nycForecast) {
    for (const day of nycForecast.slice(0, 3)) {
      console.log(`\n📍 NYC ${day.date}: Forecast ${day.highF}°F`);
      
      // Estimate which bucket should win
      const bucket = `${Math.floor(day.highF/2)*2}-${Math.floor(day.highF/2)*2 + 1}°F`;
      console.log(`   Expected bucket: ${bucket}`);
      console.log(`   → If this bucket is trading <15¢, BUY YES`);
      console.log(`   → If adjacent buckets are trading >50¢, BUY NO`);
    }
  }

  console.log('\n' + '━'.repeat(60));
  console.log('💡 TO GET LIVE PRICES:');
  console.log('   Use browser scraping on polymarket.com/predictions/weather');
  console.log('   Or check individual event pages for bucket prices');
  console.log('━'.repeat(60));

  return forecasts;
}

// Run
if (require.main === module) {
  analyzeOpportunities().catch(console.error);
}

module.exports = { analyzeOpportunities, getForecast, CITIES };
