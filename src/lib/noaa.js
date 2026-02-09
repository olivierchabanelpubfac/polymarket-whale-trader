/**
 * NOAA Weather API Client
 * Fetches forecasts from National Weather Service
 * Free API, no key required (just User-Agent)
 */

const fetch = require('node-fetch');

// City coordinates for weather markets
const CITY_COORDS = {
  'NYC': { lat: 40.7128, lon: -74.0060, name: 'New York' },
  'London': { lat: 51.5074, lon: -0.1278, name: 'London' }, // Note: NOAA only covers US
  'Seoul': { lat: 37.5665, lon: 126.9780, name: 'Seoul' },
  'Atlanta': { lat: 33.7490, lon: -84.3880, name: 'Atlanta' },
  'Chicago': { lat: 41.8781, lon: -87.6298, name: 'Chicago' },
  'Dallas': { lat: 32.7767, lon: -96.7970, name: 'Dallas' },
  'Miami': { lat: 25.7617, lon: -80.1918, name: 'Miami' },
  'Seattle': { lat: 47.6062, lon: -122.3321, name: 'Seattle' },
  'Buenos Aires': { lat: -34.6037, lon: -58.3816, name: 'Buenos Aires' },
  'Ankara': { lat: 39.9334, lon: 32.8597, name: 'Ankara' },
  'Wellington': { lat: -41.2865, lon: 174.7762, name: 'Wellington' }
};

// Alternative: Open-Meteo for non-US cities (free, no key)
const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';

class NOAAClient {
  constructor() {
    this.userAgent = '(polymarket-weather-bot, contact@example.com)';
    this.cache = new Map();
    this.cacheExpiry = 30 * 60 * 1000; // 30 min cache
  }

  /**
   * Get forecast for a city
   * Uses NOAA for US cities, Open-Meteo for international
   */
  async getForecast(city, date = null) {
    const coords = CITY_COORDS[city];
    if (!coords) {
      throw new Error(`Unknown city: ${city}`);
    }

    const cacheKey = `${city}-${date || 'today'}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      return cached.data;
    }

    // Use Open-Meteo for all cities (works globally, more reliable)
    const forecast = await this.getOpenMeteoForecast(coords, date);
    
    this.cache.set(cacheKey, { data: forecast, timestamp: Date.now() });
    return forecast;
  }

  /**
   * Open-Meteo API - works globally, free, no auth
   */
  async getOpenMeteoForecast(coords, targetDate = null) {
    const url = new URL(OPEN_METEO_URL);
    url.searchParams.set('latitude', coords.lat);
    url.searchParams.set('longitude', coords.lon);
    url.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min');
    url.searchParams.set('timezone', 'auto');
    url.searchParams.set('forecast_days', '7');

    const response = await fetch(url.toString(), {
      headers: { 'User-Agent': this.userAgent }
    });

    if (!response.ok) {
      throw new Error(`Open-Meteo API error: ${response.status}`);
    }

    const data = await response.json();
    
    // Parse target date or use today
    const target = targetDate ? new Date(targetDate) : new Date();
    const targetStr = target.toISOString().split('T')[0];

    // Find matching day in forecast
    const dayIndex = data.daily.time.findIndex(d => d === targetStr);
    
    if (dayIndex === -1) {
      // Use first available day if target not found
      return {
        city: coords.name,
        date: data.daily.time[0],
        highC: data.daily.temperature_2m_max[0],
        highF: this.celsiusToFahrenheit(data.daily.temperature_2m_max[0]),
        lowC: data.daily.temperature_2m_min[0],
        lowF: this.celsiusToFahrenheit(data.daily.temperature_2m_min[0]),
        confidence: 0.9 // High confidence for same-day
      };
    }

    // Confidence decreases with forecast distance
    const daysOut = dayIndex;
    const confidence = Math.max(0.5, 1 - (daysOut * 0.1));

    return {
      city: coords.name,
      date: data.daily.time[dayIndex],
      highC: data.daily.temperature_2m_max[dayIndex],
      highF: this.celsiusToFahrenheit(data.daily.temperature_2m_max[dayIndex]),
      lowC: data.daily.temperature_2m_min[dayIndex],
      lowF: this.celsiusToFahrenheit(data.daily.temperature_2m_min[dayIndex]),
      confidence
    };
  }

  /**
   * NOAA API for US cities (backup/alternative)
   */
  async getNOAAForecast(coords) {
    // Step 1: Get grid point
    const pointsUrl = `https://api.weather.gov/points/${coords.lat},${coords.lon}`;
    const pointsResponse = await fetch(pointsUrl, {
      headers: { 'User-Agent': this.userAgent }
    });

    if (!pointsResponse.ok) {
      throw new Error(`NOAA points API error: ${pointsResponse.status}`);
    }

    const pointsData = await pointsResponse.json();
    const forecastUrl = pointsData.properties.forecast;

    // Step 2: Get forecast
    const forecastResponse = await fetch(forecastUrl, {
      headers: { 'User-Agent': this.userAgent }
    });

    if (!forecastResponse.ok) {
      throw new Error(`NOAA forecast API error: ${forecastResponse.status}`);
    }

    const forecastData = await forecastResponse.json();
    return forecastData.properties.periods;
  }

  celsiusToFahrenheit(c) {
    return Math.round((c * 9/5) + 32);
  }

  fahrenheitToCelsius(f) {
    return Math.round((f - 32) * 5/9);
  }
}

module.exports = { NOAAClient, CITY_COORDS };
