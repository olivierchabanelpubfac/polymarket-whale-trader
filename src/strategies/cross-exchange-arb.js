/**
 * CROSS-EXCHANGE ARBITRAGE
 * 
 * Compare odds across prediction markets:
 * - Polymarket (primary)
 * - Kalshi (US regulated)
 * - Limitless (crypto)
 * 
 * If spread > 2%, execute delta-neutral arb:
 * - Buy low on exchange A
 * - Sell high on exchange B
 * 
 * Risk management:
 * - Max 1% capital per trade
 * - Daily stop-loss: -3%
 */

const fs = require("fs");
const path = require("path");
const config = require("../config");

const CACHE_FILE = path.join(__dirname, "../../data/arb-state.json");

class CrossExchangeArb {
  constructor() {
    this.state = this.loadState();
    this.minSpread = 0.02; // 2% minimum spread
    this.maxCapitalPct = 0.01; // 1% max per trade
    this.dailyStopLoss = -0.03; // -3% daily stop
  }

  loadState() {
    try {
      if (fs.existsSync(CACHE_FILE)) {
        return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
      }
    } catch (e) {}
    return {
      dailyPnL: 0,
      dailyReset: this.getTodayKey(),
      opportunities: [],
      trades: [],
    };
  }

  saveState() {
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    
    // Reset daily PnL if new day
    const today = this.getTodayKey();
    if (this.state.dailyReset !== today) {
      this.state.dailyPnL = 0;
      this.state.dailyReset = today;
    }
    
    fs.writeFileSync(CACHE_FILE, JSON.stringify(this.state, null, 2));
  }

  getTodayKey() {
    return new Date().toISOString().split("T")[0];
  }

  /**
   * Fetch odds from Polymarket
   */
  async fetchPolymarketOdds(eventKeywords) {
    try {
      const resp = await fetch(
        `https://gamma-api.polymarket.com/events?active=true&closed=false&limit=100`
      );
      const events = await resp.json();
      
      const matches = [];
      for (const event of events) {
        const title = event.title?.toLowerCase() || "";
        if (eventKeywords.some(kw => title.includes(kw.toLowerCase()))) {
          const market = event.markets?.[0];
          if (market) {
            const prices = JSON.parse(market.outcomePrices || "[]");
            matches.push({
              exchange: "polymarket",
              event: event.title,
              slug: event.slug,
              yesPrice: parseFloat(prices[0]) || 0.5,
              noPrice: parseFloat(prices[1]) || 0.5,
              liquidity: event.liquidity || 0,
            });
          }
        }
      }
      return matches;
    } catch (e) {
      console.error(`Polymarket fetch error: ${e.message}`);
      return [];
    }
  }

  /**
   * Fetch odds from Kalshi
   * Note: Requires Kalshi API access
   */
  async fetchKalshiOdds(eventKeywords) {
    try {
      // Kalshi public markets endpoint
      const resp = await fetch(
        "https://trading-api.kalshi.com/trade-api/v2/markets?limit=100&status=open",
        {
          headers: {
            "Accept": "application/json",
          }
        }
      );
      
      if (!resp.ok) {
        // Kalshi requires auth for most endpoints
        console.log(`   Kalshi: API requires auth (${resp.status})`);
        return [];
      }
      
      const data = await resp.json();
      const markets = data.markets || [];
      
      const matches = [];
      for (const market of markets) {
        const title = market.title?.toLowerCase() || "";
        if (eventKeywords.some(kw => title.includes(kw.toLowerCase()))) {
          matches.push({
            exchange: "kalshi",
            event: market.title,
            ticker: market.ticker,
            yesPrice: (market.yes_bid + market.yes_ask) / 2 / 100 || 0.5,
            noPrice: (market.no_bid + market.no_ask) / 2 / 100 || 0.5,
            liquidity: market.volume || 0,
          });
        }
      }
      return matches;
    } catch (e) {
      console.log(`   Kalshi: ${e.message}`);
      return [];
    }
  }

  /**
   * Fetch odds from Limitless
   */
  async fetchLimitlessOdds(eventKeywords) {
    try {
      // Limitless API (if available)
      const resp = await fetch(
        "https://api.limitless.exchange/markets?status=active"
      );
      
      if (!resp.ok) {
        console.log(`   Limitless: API unavailable (${resp.status})`);
        return [];
      }
      
      const markets = await resp.json();
      
      const matches = [];
      for (const market of (markets || [])) {
        const title = market.title?.toLowerCase() || "";
        if (eventKeywords.some(kw => title.includes(kw.toLowerCase()))) {
          matches.push({
            exchange: "limitless",
            event: market.title,
            id: market.id,
            yesPrice: market.yesPrice || 0.5,
            noPrice: market.noPrice || 0.5,
            liquidity: market.liquidity || 0,
          });
        }
      }
      return matches;
    } catch (e) {
      console.log(`   Limitless: ${e.message}`);
      return [];
    }
  }

  /**
   * Find arbitrage opportunities
   */
  findArbOpportunities(allOdds) {
    const opportunities = [];
    
    // Group by similar events
    const eventGroups = {};
    for (const odds of allOdds) {
      // Normalize event name for matching
      const key = odds.event
        .toLowerCase()
        .replace(/[^a-z0-9]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 50);
      
      if (!eventGroups[key]) {
        eventGroups[key] = [];
      }
      eventGroups[key].push(odds);
    }

    // Find spreads within groups
    for (const [eventKey, group] of Object.entries(eventGroups)) {
      if (group.length < 2) continue;
      
      // Find min/max YES prices
      let minYes = { price: 1, exchange: null, data: null };
      let maxYes = { price: 0, exchange: null, data: null };
      
      for (const odds of group) {
        if (odds.yesPrice < minYes.price) {
          minYes = { price: odds.yesPrice, exchange: odds.exchange, data: odds };
        }
        if (odds.yesPrice > maxYes.price) {
          maxYes = { price: odds.yesPrice, exchange: odds.exchange, data: odds };
        }
      }
      
      const spread = maxYes.price - minYes.price;
      
      if (spread >= this.minSpread && minYes.exchange !== maxYes.exchange) {
        opportunities.push({
          event: eventKey,
          spread,
          spreadPct: (spread * 100).toFixed(1) + "%",
          buyExchange: minYes.exchange,
          buyPrice: minYes.price,
          sellExchange: maxYes.exchange,
          sellPrice: maxYes.price,
          potentialProfit: spread,
          buyData: minYes.data,
          sellData: maxYes.data,
          detectedAt: Date.now(),
        });
      }
    }

    return opportunities.sort((a, b) => b.spread - a.spread);
  }

  /**
   * Calculate position size with risk management
   */
  calculatePositionSize(capital, opportunity) {
    // Check daily stop loss
    if (this.state.dailyPnL <= this.dailyStopLoss * capital) {
      console.log(`   🛑 Daily stop-loss hit (${(this.state.dailyPnL * 100).toFixed(2)}%)`);
      return 0;
    }
    
    // Max 1% of capital
    const maxSize = capital * this.maxCapitalPct;
    
    // Adjust based on spread (bigger spread = more confident)
    const confidenceMultiplier = Math.min(opportunity.spread / this.minSpread, 2);
    
    return maxSize * confidenceMultiplier * 0.5; // 50% of max for safety
  }

  /**
   * Main analysis
   */
  async analyze(marketSlug, capital = 340) {
    console.log(`\n🔄 Cross-Exchange Arb: Scanning for opportunities...`);
    
    // Keywords to search across exchanges
    const keywords = ["bitcoin", "btc", "trump", "election", "fed", "rate"];
    
    // Fetch odds from all exchanges
    const [polymarket, kalshi, limitless] = await Promise.all([
      this.fetchPolymarketOdds(keywords),
      this.fetchKalshiOdds(keywords),
      this.fetchLimitlessOdds(keywords),
    ]);

    console.log(`   Polymarket: ${polymarket.length} markets`);
    console.log(`   Kalshi: ${kalshi.length} markets`);
    console.log(`   Limitless: ${limitless.length} markets`);

    const allOdds = [...polymarket, ...kalshi, ...limitless];
    
    if (allOdds.length < 2) {
      return {
        strategy: "creative:cross_exchange_arb",
        score: 0,
        confidence: 0,
        recommendation: { action: "HOLD", reason: "Insufficient exchange data" },
        reason: "Need data from multiple exchanges",
      };
    }

    // Find opportunities
    const opportunities = this.findArbOpportunities(allOdds);
    this.state.opportunities = opportunities;
    this.saveState();

    if (opportunities.length === 0) {
      console.log(`   No arb opportunities found (min spread: ${this.minSpread * 100}%)`);
      return {
        strategy: "creative:cross_exchange_arb",
        score: 0,
        confidence: 0,
        recommendation: { action: "HOLD", reason: "No arbitrage found" },
        reason: "Spreads below threshold",
      };
    }

    // Best opportunity
    const best = opportunities[0];
    console.log(`\n   🎯 Arb opportunity found!`);
    console.log(`   Event: ${best.event}`);
    console.log(`   Buy ${best.buyExchange} @ ${(best.buyPrice * 100).toFixed(1)}%`);
    console.log(`   Sell ${best.sellExchange} @ ${(best.sellPrice * 100).toFixed(1)}%`);
    console.log(`   Spread: ${best.spreadPct}`);

    const positionSize = this.calculatePositionSize(capital, best);
    
    if (positionSize === 0) {
      return {
        strategy: "creative:cross_exchange_arb",
        score: 0,
        confidence: 0,
        recommendation: { action: "HOLD", reason: "Risk limits reached" },
        reason: "Daily stop-loss or position limit",
      };
    }

    // Score based on spread size
    const score = Math.min(best.spread * 5, 1); // Max score at 20% spread
    
    return {
      strategy: "creative:cross_exchange_arb",
      score,
      confidence: 0.8, // High confidence for arb (risk-free in theory)
      recommendation: {
        action: "ARB",
        reason: `${best.spreadPct} spread: Buy ${best.buyExchange}, Sell ${best.sellExchange}`,
      },
      reason: `Arb: ${best.buyExchange} ${(best.buyPrice*100).toFixed(0)}% → ${best.sellExchange} ${(best.sellPrice*100).toFixed(0)}%`,
      opportunity: best,
      positionSize,
    };
  }
}

module.exports = CrossExchangeArb;
