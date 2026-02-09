# Weather Arbitrage Strategy

## Concept (from @0xMovez)

Weather trading bots are making $1000s/month on Polymarket by:
1. Scanning weather markets every 2 minutes
2. Comparing prices to NOAA/Open-Meteo forecasts
3. Buying undervalued temperature buckets

## Configuration

- **Entry threshold**: < 15¢ (0.15)
- **Exit threshold**: > 45¢ (0.45)
- **Forecast confidence min**: 70%

## How It Works

1. Polymarket has daily temperature markets for cities:
   - NYC, London, Seoul, Atlanta, Chicago, Dallas, Miami, Seattle, Buenos Aires, Ankara, Wellington

2. Each market has multiple buckets (e.g., "30-31°F", "32-33°F", "34°F or higher")

3. Weather forecasts (Open-Meteo) are highly accurate 0-2 days out

4. If forecast says 32°F and the "32-33°F" bucket is trading at 10¢:
   - **That's undervalued** → BUY
   - Wait for market correction or resolution

## Files Created

- `src/lib/noaa.js` - Weather API client (Open-Meteo for global coverage)
- `src/strategies/weather_arbitrage.js` - Strategy logic
- `src/weather-scanner.js` - Standalone scanner

## API Access Issue

Weather markets on Polymarket appear to use a different API path than standard markets.
The gamma-api.polymarket.com doesn't return weather events with standard filters.

### Options to investigate:

1. **Simmer SDK** - Mentioned in the tweet as a wrapper for weather trading
2. **Strapi API** - Polymarket may use a different endpoint for weather
3. **Web scraping** - Parse from polymarket.com/predictions/weather directly
4. **GraphQL** - Check if Polymarket has a GraphQL endpoint

## Next Steps

1. Research Simmer SDK for proper API access
2. Add weather markets manually if discovered
3. Set up periodic web scraping of weather page
4. Integrate with existing arena once API access is solved

## Reference

- Tweet: https://x.com/0xmovez/status/2020803703465238964
- Simmer: Research needed
- Weather page: https://polymarket.com/predictions/weather
- Open-Meteo API: https://api.open-meteo.com/v1/forecast

## Profit Potential

According to @0xMovez:
- $65k+ profit demonstrated
- Scale at $20-50/day consistent revenue
- Automated operation possible
