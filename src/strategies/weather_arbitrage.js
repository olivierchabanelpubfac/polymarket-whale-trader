/**
 * Weather Arbitrage Strategy
 * 
 * Concept from @0xMovez: Compare Polymarket weather market prices
 * with actual weather forecasts (NOAA/Open-Meteo)
 * 
 * Buy undervalued temperature buckets when forecast predicts that range
 * Entry: price < 15¢ when forecast matches
 * Exit: price > 45¢ or market resolution
 * 
 * Edge: Weather forecasts are highly accurate for short-term predictions
 */

const { NOAAClient, CITY_COORDS } = require('../lib/noaa');

const strategy = {
  name: 'weather_arbitrage',
  version: '1.0.0',
  description: 'Arbitrage between weather forecasts and Polymarket prices',
  type: 'creative',
  
  // Configuration
  config: {
    entryThreshold: 0.15,    // Buy when price < 15¢
    exitThreshold: 0.45,     // Sell when price > 45¢
    minConfidence: 0.7,      // Minimum forecast confidence
    maxPositionSize: 50,     // Max $50 per trade
    forecastMatchRange: 2,   // ±2 degrees tolerance
  },

  noaaClient: new NOAAClient(),

  /**
   * Parse weather market title to extract city and date
   * Examples:
   * - "Highest temperature in NYC on February 9?"
   * - "Highest temperature in London on February 10?"
   */
  parseMarketTitle(title) {
    const match = title.match(/Highest temperature in ([A-Za-z\s]+) on ([A-Za-z]+ \d+)/i);
    if (!match) return null;

    const city = match[1].trim();
    const dateStr = match[2];
    
    // Parse date (e.g., "February 9" -> 2026-02-09)
    const year = new Date().getFullYear();
    const date = new Date(`${dateStr}, ${year}`);
    
    return { city, date: date.toISOString().split('T')[0] };
  },

  /**
   * Parse temperature bucket from outcome name
   * Examples:
   * - "30-31°F" -> { min: 30, max: 31, unit: 'F' }
   * - "9°C" -> { min: 9, max: 9, unit: 'C' }
   * - "42°F or higher" -> { min: 42, max: 150, unit: 'F' }
   */
  parseTemperatureBucket(outcome) {
    // Range: "30-31°F"
    let match = outcome.match(/(\d+)-(\d+)°([FC])/);
    if (match) {
      return { min: parseInt(match[1]), max: parseInt(match[2]), unit: match[3] };
    }

    // "X or higher"
    match = outcome.match(/(\d+)°([FC]) or higher/i);
    if (match) {
      return { min: parseInt(match[1]), max: 200, unit: match[2] };
    }

    // "X or below"
    match = outcome.match(/(\d+)°([FC]) or below/i);
    if (match) {
      return { min: -50, max: parseInt(match[1]), unit: match[2] };
    }

    // Single value: "9°C"
    match = outcome.match(/(\d+)°([FC])/);
    if (match) {
      return { min: parseInt(match[1]), max: parseInt(match[1]), unit: match[2] };
    }

    return null;
  },

  /**
   * Check if forecast temperature falls within bucket range
   */
  forecastMatchesBucket(forecast, bucket) {
    const tolerance = this.config.forecastMatchRange;
    
    // Convert forecast to same unit as bucket
    const forecastTemp = bucket.unit === 'F' ? forecast.highF : forecast.highC;
    
    // Check if forecast is within bucket range (with tolerance)
    const inRange = forecastTemp >= (bucket.min - tolerance) && 
                    forecastTemp <= (bucket.max + tolerance);
    
    // Calculate how well it matches (center of range = best)
    const bucketCenter = (bucket.min + bucket.max) / 2;
    const deviation = Math.abs(forecastTemp - bucketCenter);
    const matchQuality = Math.max(0, 1 - (deviation / 10));
    
    return { matches: inRange, quality: matchQuality, forecastTemp };
  },

  /**
   * Main analysis function
   */
  async analyze(market, context = {}) {
    // Only analyze weather markets
    const title = market.question || market.title || '';
    if (!title.toLowerCase().includes('temperature')) {
      return { action: 'HOLD', reason: 'Not a weather market' };
    }

    // Parse market details
    const parsed = this.parseMarketTitle(title);
    if (!parsed) {
      return { action: 'HOLD', reason: 'Could not parse market title' };
    }

    // Check if we have coordinates for this city
    const cityKey = Object.keys(CITY_COORDS).find(
      k => k.toLowerCase() === parsed.city.toLowerCase() ||
           CITY_COORDS[k].name.toLowerCase() === parsed.city.toLowerCase()
    );
    
    if (!cityKey) {
      return { action: 'HOLD', reason: `Unknown city: ${parsed.city}` };
    }

    // Fetch weather forecast
    let forecast;
    try {
      forecast = await this.noaaClient.getForecast(cityKey, parsed.date);
    } catch (error) {
      return { action: 'HOLD', reason: `Forecast error: ${error.message}` };
    }

    // Check forecast confidence
    if (forecast.confidence < this.config.minConfidence) {
      return { 
        action: 'HOLD', 
        reason: `Low forecast confidence: ${(forecast.confidence * 100).toFixed(0)}%` 
      };
    }

    // Analyze each outcome/bucket
    const outcomes = market.outcomes || [];
    let bestSignal = null;
    let bestScore = 0;

    for (const outcome of outcomes) {
      const bucket = this.parseTemperatureBucket(outcome.name || outcome);
      if (!bucket) continue;

      const price = outcome.price || market.outcomePrices?.[outcomes.indexOf(outcome)];
      if (typeof price !== 'number') continue;

      const matchResult = this.forecastMatchesBucket(forecast, bucket);
      
      if (matchResult.matches) {
        // Forecast matches this bucket
        if (price < this.config.entryThreshold) {
          // UNDERVALUED - Buy opportunity!
          const edge = (forecast.confidence - price) * matchResult.quality;
          const score = edge * 100;
          
          if (score > bestScore) {
            bestScore = score;
            bestSignal = {
              action: 'BUY_YES',
              outcome: outcome.name || outcome,
              price,
              forecast: matchResult.forecastTemp,
              confidence: forecast.confidence,
              edge: edge * 100,
              reason: `Forecast ${matchResult.forecastTemp}° matches bucket, price ${(price*100).toFixed(1)}¢ < ${this.config.entryThreshold*100}¢`
            };
          }
        } else if (price > this.config.exitThreshold) {
          // Check if we should take profit
          bestSignal = {
            action: 'TAKE_PROFIT',
            outcome: outcome.name || outcome,
            price,
            reason: `Price ${(price*100).toFixed(1)}¢ > exit threshold ${this.config.exitThreshold*100}¢`
          };
        }
      } else if (price > 0.5 && !matchResult.matches) {
        // Market thinks this bucket is likely, but forecast disagrees
        // Could be a SHORT opportunity (sell/fade)
        const edge = (price - forecast.confidence) * (1 - matchResult.quality);
        if (edge > 0.2) {
          bestSignal = {
            action: 'BUY_NO',
            outcome: outcome.name || outcome,
            price,
            forecast: matchResult.forecastTemp,
            edge: edge * 100,
            reason: `Forecast ${matchResult.forecastTemp}° doesn't match bucket at ${(price*100).toFixed(1)}¢`
          };
        }
      }
    }

    if (bestSignal) {
      return {
        action: bestSignal.action,
        score: bestScore,
        signal: bestSignal,
        metadata: {
          city: parsed.city,
          date: parsed.date,
          forecast,
          strategy: this.name
        }
      };
    }

    return { 
      action: 'HOLD', 
      reason: 'No arbitrage opportunity',
      metadata: { city: parsed.city, forecast }
    };
  }
};

module.exports = strategy;
