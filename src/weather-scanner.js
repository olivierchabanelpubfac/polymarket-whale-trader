#!/usr/bin/env node
/**
 * Weather Market Scanner
 * 
 * Finds arbitrage opportunities between Polymarket weather markets
 * and actual weather forecasts from Open-Meteo
 * 
 * Based on @0xMovez strategy:
 * - Entry: price < 15¢ when forecast matches bucket
 * - Exit: price > 45¢
 * 
 * Usage: node weather-scanner.js [--trade]
 */

require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
  entryThreshold: 0.15,    // Buy when price < 15¢
  exitThreshold: 0.45,     // Sell when price > 45¢
  minConfidence: 0.7,      // Minimum forecast confidence
  maxPositionSize: 50,     // Max $50 per trade
  toleranceDegrees: 2,     // ±2° tolerance for matching
};

// City coordinates for Open-Meteo
const CITIES = {
  'NYC': { lat: 40.7128, lon: -74.0060, tzOffset: -5 },
  'New York': { lat: 40.7128, lon: -74.0060, tzOffset: -5 },
  'London': { lat: 51.5074, lon: -0.1278, tzOffset: 0 },
  'Seoul': { lat: 37.5665, lon: 126.9780, tzOffset: 9 },
  'Atlanta': { lat: 33.7490, lon: -84.3880, tzOffset: -5 },
  'Chicago': { lat: 41.8781, lon: -87.6298, tzOffset: -6 },
  'Dallas': { lat: 32.7767, lon: -96.7970, tzOffset: -6 },
  'Miami': { lat: 25.7617, lon: -80.1918, tzOffset: -5 },
  'Seattle': { lat: 47.6062, lon: -122.3321, tzOffset: -8 },
  'Buenos Aires': { lat: -34.6037, lon: -58.3816, tzOffset: -3 },
  'Ankara': { lat: 39.9334, lon: 32.8597, tzOffset: 3 },
  'Wellington': { lat: -41.2865, lon: 174.7762, tzOffset: 12 },
};

/**
 * Fetch weather markets from Polymarket
 */
async function fetchWeatherMarkets() {
  const markets = [];
  
  try {
    // Try the gamma API first
    const response = await axios.get('https://gamma-api.polymarket.com/events', {
      params: { 
        closed: false, 
        limit: 200,
      },
      timeout: 15000
    });

    for (const event of response.data) {
      const title = event.title || '';
      
      // Check if it's a temperature market
      if (title.toLowerCase().includes('highest temperature in')) {
        const parsed = parseWeatherEventTitle(title);
        if (parsed && event.markets) {
          markets.push({
            ...parsed,
            eventId: event.id,
            slug: event.slug,
            markets: event.markets,
            endDate: event.endDate,
          });
        }
      }
    }
  } catch (error) {
    console.error('Error fetching events:', error.message);
  }

  return markets;
}

/**
 * Parse weather event title
 * Example: "Highest temperature in NYC on February 9?"
 */
function parseWeatherEventTitle(title) {
  const match = title.match(/Highest temperature in ([A-Za-z\s]+) on ([A-Za-z]+ \d+)/i);
  if (!match) return null;

  const cityName = match[1].trim();
  const dateStr = match[2];
  
  // Parse date
  const year = new Date().getFullYear();
  const date = new Date(`${dateStr}, ${year}`);
  
  // Find city coordinates
  const cityKey = Object.keys(CITIES).find(
    k => k.toLowerCase() === cityName.toLowerCase()
  );
  
  if (!cityKey) return null;

  return {
    city: cityKey,
    coords: CITIES[cityKey],
    date: date.toISOString().split('T')[0],
    title,
  };
}

/**
 * Fetch forecast from Open-Meteo
 */
async function fetchForecast(coords, targetDate) {
  const url = 'https://api.open-meteo.com/v1/forecast';
  
  const response = await axios.get(url, {
    params: {
      latitude: coords.lat,
      longitude: coords.lon,
      daily: 'temperature_2m_max,temperature_2m_min',
      timezone: 'auto',
      forecast_days: 7,
    },
    timeout: 10000,
  });

  const data = response.data;
  const dayIndex = data.daily.time.findIndex(d => d === targetDate);
  
  if (dayIndex === -1) {
    return {
      highC: data.daily.temperature_2m_max[0],
      highF: celsiusToFahrenheit(data.daily.temperature_2m_max[0]),
      confidence: 0.8,
    };
  }

  // Confidence decreases with forecast distance
  const confidence = Math.max(0.5, 1 - (dayIndex * 0.1));

  return {
    highC: data.daily.temperature_2m_max[dayIndex],
    highF: celsiusToFahrenheit(data.daily.temperature_2m_max[dayIndex]),
    date: data.daily.time[dayIndex],
    confidence,
  };
}

function celsiusToFahrenheit(c) {
  return Math.round((c * 9/5) + 32);
}

/**
 * Parse temperature bucket from market question
 * Examples: "30-31°F", "9°C", "42°F or higher"
 */
function parseTemperatureBucket(question) {
  // Range: "30-31°F"
  let match = question.match(/(\d+)-(\d+)°([FC])/);
  if (match) {
    return { min: parseInt(match[1]), max: parseInt(match[2]), unit: match[3] };
  }

  // "X or higher"
  match = question.match(/(\d+)°([FC])\s*or higher/i);
  if (match) {
    return { min: parseInt(match[1]), max: 999, unit: match[2] };
  }

  // "X or below" / "X or lower"
  match = question.match(/(\d+)°([FC])\s*or (?:below|lower)/i);
  if (match) {
    return { min: -999, max: parseInt(match[1]), unit: match[2] };
  }

  // Single value: "9°C"
  match = question.match(/(\d+)°([FC])$/);
  if (match) {
    return { min: parseInt(match[1]), max: parseInt(match[1]), unit: match[2] };
  }

  return null;
}

/**
 * Check if forecast matches bucket
 */
function forecastMatchesBucket(forecast, bucket, tolerance = CONFIG.toleranceDegrees) {
  const forecastTemp = bucket.unit === 'F' ? forecast.highF : forecast.highC;
  
  // Check if forecast is within bucket range (with tolerance)
  const inRange = forecastTemp >= (bucket.min - tolerance) && 
                  forecastTemp <= (bucket.max + tolerance);
  
  return { matches: inRange, forecastTemp };
}

/**
 * Analyze a weather event for arbitrage opportunities
 */
async function analyzeWeatherEvent(event) {
  const opportunities = [];
  
  try {
    // Fetch forecast
    const forecast = await fetchForecast(event.coords, event.date);
    
    if (forecast.confidence < CONFIG.minConfidence) {
      return { event, forecast, opportunities: [], reason: 'Low confidence' };
    }

    // Analyze each market (temperature bucket)
    for (const market of (event.markets || [])) {
      const question = market.question || market.groupItemTitle || '';
      const bucket = parseTemperatureBucket(question);
      
      if (!bucket) continue;

      // Get price (assuming outcomes are [Yes, No])
      const prices = JSON.parse(market.outcomePrices || '[]');
      const yesPrice = parseFloat(prices[0]) || 0;
      
      const matchResult = forecastMatchesBucket(forecast, bucket);
      
      if (matchResult.matches) {
        // Forecast matches this bucket
        if (yesPrice < CONFIG.entryThreshold) {
          // UNDERVALUED - Buy opportunity!
          const edge = (forecast.confidence - yesPrice) * 100;
          opportunities.push({
            action: 'BUY_YES',
            market: market.slug,
            bucket: question,
            price: yesPrice,
            forecastTemp: matchResult.forecastTemp,
            edge: edge.toFixed(1) + '%',
            reason: `Forecast ${matchResult.forecastTemp}° matches bucket, price ${(yesPrice*100).toFixed(1)}¢ < ${CONFIG.entryThreshold*100}¢`,
          });
        }
      } else if (yesPrice > 0.5) {
        // Market thinks this bucket is likely, but forecast disagrees
        // Potential SHORT (buy NO)
        const edge = (yesPrice - 0.5) * 100;
        if (edge > 15) {
          opportunities.push({
            action: 'BUY_NO',
            market: market.slug,
            bucket: question,
            price: yesPrice,
            forecastTemp: matchResult.forecastTemp,
            edge: edge.toFixed(1) + '%',
            reason: `Forecast ${matchResult.forecastTemp}° doesn't match bucket trading at ${(yesPrice*100).toFixed(1)}¢`,
          });
        }
      }
    }
  } catch (error) {
    return { event, error: error.message, opportunities: [] };
  }

  return { event, forecast, opportunities };
}

/**
 * Main scanner function
 */
async function scan() {
  console.log('🌡️  Weather Arbitrage Scanner');
  console.log('━'.repeat(50));
  console.log(`Config: Entry <${CONFIG.entryThreshold*100}¢ | Exit >${CONFIG.exitThreshold*100}¢`);
  console.log('');

  // Fetch weather markets
  console.log('📡 Fetching weather markets...');
  const weatherEvents = await fetchWeatherMarkets();
  console.log(`   Found ${weatherEvents.length} weather events\n`);

  if (weatherEvents.length === 0) {
    console.log('❌ No weather markets found');
    return [];
  }

  // Analyze each event
  const allOpportunities = [];
  
  for (const event of weatherEvents) {
    process.stdout.write(`   Analyzing ${event.city} ${event.date}...`);
    const result = await analyzeWeatherEvent(event);
    
    if (result.error) {
      console.log(` ❌ ${result.error}`);
      continue;
    }

    if (result.opportunities.length > 0) {
      console.log(` ✅ ${result.opportunities.length} opportunities!`);
      allOpportunities.push(...result.opportunities.map(o => ({
        ...o,
        city: event.city,
        date: event.date,
      })));
    } else {
      console.log(` ➖ No edge`);
    }
    
    // Rate limit
    await new Promise(r => setTimeout(r, 500));
  }

  // Summary
  console.log('\n' + '━'.repeat(50));
  console.log('📊 ARBITRAGE OPPORTUNITIES');
  console.log('━'.repeat(50));

  if (allOpportunities.length === 0) {
    console.log('   No opportunities found at current prices');
  } else {
    for (const opp of allOpportunities) {
      console.log(`\n🎯 ${opp.city} ${opp.date}`);
      console.log(`   ${opp.action}: ${opp.bucket}`);
      console.log(`   Price: ${(opp.price*100).toFixed(1)}¢ | Forecast: ${opp.forecastTemp}°`);
      console.log(`   Edge: ${opp.edge}`);
      console.log(`   ${opp.reason}`);
    }
  }

  return allOpportunities;
}

// Run if called directly
if (require.main === module) {
  scan().then(opportunities => {
    if (opportunities.length > 0) {
      // Save opportunities to file for the arena to pick up
      const outputPath = path.join(__dirname, '../data/weather-opportunities.json');
      fs.writeFileSync(outputPath, JSON.stringify({
        timestamp: new Date().toISOString(),
        opportunities,
      }, null, 2));
      console.log(`\n💾 Saved to ${outputPath}`);
    }
  }).catch(console.error);
}

module.exports = { scan, fetchWeatherMarkets, analyzeWeatherEvent };
