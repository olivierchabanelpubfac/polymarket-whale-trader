/**
 * =============================================================================
 * STRATEGY: ORDERBOOK IMBALANCE GAS PREDICTOR
 *
 * Generated from idea: ml2h8zoygt3m
 * AlphaScore: 9/10 | Complexity: high
 *
 * Détecte orderbook imbalances (>15% bid-ask skew) corrélés à gas price spikes
 * (>avg+2σ) pour anticiper inflows massifs sur sports markets. Exécute
 * delta-hedged entries via Kalman-smoothed imbalance signal. Exit sur reversion
 * à equilibrium ou 5% profit.
 *
 * Entry: imbalance > 0.15 && gas_spike > 2, confirm with volume surge > 20% 1h MA
 * Exit: imbalance reverts < 0.05 or profit >5% or time_decay >24h
 * Risk: Kelly frac = (edge/vol^2)*0.25 adj, max 0.5% capital (.5), portfolio DD cap 2%
 * =============================================================================
 */

const fs = require("fs");
const path = require("path");
const config = require("../config");

const STATE_FILE = path.join(__dirname, "../../data/orderbook-imbalance-gas-predictor-state.json");

class OrderbookImbalanceGasPredictorStrategy {
  constructor() {
    this.name = "orderbook_imbalance_gas_predictor";
    this.description = "Detects orderbook imbalances correlated with gas spikes to predict market movements";

    // Strategy parameters
    this.params = {
      imbalanceThreshold: 0.15,        // 15% bid-ask skew
      gasStdDevMultiplier: 2,          // 2 standard deviations
      volumeSurgeThreshold: 0.20,      // 20% above 1h MA
      exitImbalanceThreshold: 0.05,    // 5% reversion
      exitProfitThreshold: 0.05,       // 5% profit target
      maxPositionAge: 24 * 60 * 60 * 1000, // 24 hours
      maxCapitalPct: 0.005,            // 0.5% max per trade
      portfolioDDCap: 0.02,            // 2% portfolio drawdown cap
      kalmanR: 0.01,                   // Kalman measurement noise
      kalmanQ: 0.0001,                 // Kalman process noise
    };

    // State management
    this.state = this.loadState();
  }

  loadState() {
    try {
      if (fs.existsSync(STATE_FILE)) {
        return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
      }
    } catch (e) {
      console.error(`Failed to load state: ${e.message}`);
    }
    return {
      lastRun: null,
      positions: [],
      gasHistory: [],
      imbalanceHistory: [],
      volumeHistory: [],
      kalmanState: { x: 0, p: 1 }, // Kalman filter state
      portfolioPnL: 0,
    };
  }

  saveState() {
    const dir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.state.lastRun = Date.now();
    fs.writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2));
  }

  checkDependencies() {
    // Polygon RPC endpoint can be public or use env var
    const envVars = process.env.POLYGON_RPC_URL ? ["POLYGON_RPC_URL"] : [];
    const missing = envVars.filter(key => !process.env[key]);

    if (missing.length > 0) {
      console.warn(`  ${this.name}: Optional env vars missing: ${missing.join(", ")}`);
      console.warn(`  ${this.name}: Will use public endpoints (rate-limited)`);
    }
    return true; // Strategy can work with public endpoints
  }

  /**
   * Fetch current Polygon gas prices
   */
  async fetchGasPrices() {
    try {
      // Polygon gas station API
      const resp = await fetch("https://gasstation.polygon.technology/v2");
      if (!resp.ok) throw new Error(`Gas API error: ${resp.status}`);

      const data = await resp.json();
      return {
        fast: parseFloat(data.fast?.maxFee || 50),
        standard: parseFloat(data.standard?.maxFee || 40),
        baseFee: parseFloat(data.estimatedBaseFee || 30),
        timestamp: Date.now(),
      };
    } catch (e) {
      console.error(`   Gas fetch error: ${e.message}`);
      return null;
    }
  }

  /**
   * Calculate gas price statistics from history
   */
  calculateGasStats() {
    if (this.state.gasHistory.length < 10) {
      return { avg: 50, stdDev: 10, isSpike: false, zScore: 0 };
    }

    const prices = this.state.gasHistory.map(h => h.fast);
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    const variance = prices.reduce((sum, p) => sum + Math.pow(p - avg, 2), 0) / prices.length;
    const stdDev = Math.sqrt(variance);

    const current = prices[prices.length - 1];
    const zScore = (current - avg) / (stdDev || 1);
    const isSpike = zScore > this.params.gasStdDevMultiplier;

    return { avg, stdDev, isSpike, zScore, current };
  }

  /**
   * Fetch orderbook data via Gamma API to get token IDs, then CLOB for orderbook
   */
  async fetchOrderbook(marketSlug) {
    try {
      // Get market data from Gamma API (has clobTokenIds)
      const gammaResp = await fetch(
        `https://gamma-api.polymarket.com/events?slug=${marketSlug}`
      );

      if (!gammaResp.ok) throw new Error(`Gamma API error: ${gammaResp.status}`);

      const events = await gammaResp.json();
      if (!events || events.length === 0) {
        throw new Error("Market not found in Gamma");
      }

      // Get the first market from the event
      const market = events[0]?.markets?.[0];
      if (!market) throw new Error("No market data");

      // clobTokenIds is a JSON string containing [yesTokenId, noTokenId]
      let tokenIds = market.clobTokenIds;
      if (!tokenIds) {
        throw new Error("No clobTokenIds available");
      }
      
      // Parse if it's a string (Gamma API returns it as JSON string)
      if (typeof tokenIds === 'string') {
        try {
          tokenIds = JSON.parse(tokenIds);
        } catch (e) {
          throw new Error(`Failed to parse clobTokenIds: ${e.message}`);
        }
      }
      
      if (!Array.isArray(tokenIds) || tokenIds.length === 0) {
        throw new Error("Invalid clobTokenIds format");
      }

      // Use the "Yes" token (first one) for orderbook
      const yesTokenId = tokenIds[0];
      const conditionId = market.conditionId;

      // Fetch orderbook from CLOB
      const obResp = await fetch(
        `https://clob.polymarket.com/book?token_id=${yesTokenId}`
      );

      if (!obResp.ok) {
        const errText = await obResp.text();
        throw new Error(`CLOB Orderbook error: ${obResp.status} - ${errText}`);
      }

      const orderbook = await obResp.json();

      return {
        tokenId: yesTokenId,
        conditionId,
        bids: orderbook.bids || [],
        asks: orderbook.asks || [],
        market: market.question,
        timestamp: Date.now(),
      };
    } catch (e) {
      console.error(`   Orderbook fetch error: ${e.message}`);
      return null;
    }
  }

  /**
   * Calculate orderbook imbalance
   * Positive = bullish (more bids), Negative = bearish (more asks)
   */
  calculateOrderbookImbalance(orderbook) {
    if (!orderbook || !orderbook.bids.length || !orderbook.asks.length) {
      return { imbalance: 0, bidVolume: 0, askVolume: 0 };
    }

    // Sum top 10 levels or all if less
    const bidVolume = orderbook.bids
      .slice(0, 10)
      .reduce((sum, bid) => sum + parseFloat(bid.size || 0), 0);

    const askVolume = orderbook.asks
      .slice(0, 10)
      .reduce((sum, ask) => sum + parseFloat(ask.size || 0), 0);

    const totalVolume = bidVolume + askVolume;

    if (totalVolume === 0) {
      return { imbalance: 0, bidVolume, askVolume };
    }

    // Imbalance: (bids - asks) / total
    // Range: -1 (all asks) to +1 (all bids)
    const imbalance = (bidVolume - askVolume) / totalVolume;

    return { imbalance, bidVolume, askVolume, totalVolume };
  }

  /**
   * Apply Kalman filter to smooth imbalance signal
   */
  applyKalmanFilter(measurement) {
    const { x, p } = this.state.kalmanState;
    const { kalmanR, kalmanQ } = this.params;

    // Prediction
    const xPred = x;
    const pPred = p + kalmanQ;

    // Update
    const K = pPred / (pPred + kalmanR);
    const xNew = xPred + K * (measurement - xPred);
    const pNew = (1 - K) * pPred;

    this.state.kalmanState = { x: xNew, p: pNew };
    return xNew;
  }

  /**
   * Fetch market volume data
   */
  async fetchMarketVolume(marketSlug) {
    try {
      const resp = await fetch(
        `https://gamma-api.polymarket.com/events?slug=${marketSlug}`
      );

      if (!resp.ok) throw new Error(`Volume API error: ${resp.status}`);

      const events = await resp.json();
      if (!events || events.length === 0) {
        throw new Error("Market not found");
      }

      const event = events[0];
      const market = event.markets?.[0];

      return {
        volume: parseFloat(market?.volume || 0),
        liquidity: parseFloat(market?.liquidity || 0),
        timestamp: Date.now(),
      };
    } catch (e) {
      console.error(`   Volume fetch error: ${e.message}`);
      return null;
    }
  }

  /**
   * Calculate volume surge vs 1h moving average
   */
  calculateVolumeSurge(currentVolume) {
    if (this.state.volumeHistory.length < 6) {
      return { surge: 0, avgVolume: currentVolume, isSurge: false };
    }

    // Last 6 data points = ~1 hour if sampled every 10 minutes
    const recentVolumes = this.state.volumeHistory.slice(-6).map(v => v.volume);
    const avgVolume = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;

    const surge = avgVolume > 0 ? (currentVolume - avgVolume) / avgVolume : 0;
    const isSurge = surge > this.params.volumeSurgeThreshold;

    return { surge, avgVolume, isSurge };
  }

  /**
   * Calculate Kelly fraction for position sizing
   */
  calculateKellyFraction(edge, volatility) {
    if (volatility === 0) return 0;

    // Kelly fraction = edge / variance
    const kellyFrac = edge / Math.pow(volatility, 2);

    // Apply 0.25 adjustment for safety (quarter Kelly)
    const adjustedKelly = kellyFrac * 0.25;

    // Cap at max position size
    return Math.min(Math.max(adjustedKelly, 0), this.params.maxCapitalPct);
  }

  /**
   * Check exit conditions for existing positions
   */
  checkExitConditions(position, currentImbalance, currentPrice) {
    const age = Date.now() - position.entryTime;
    const profit = position.direction === "LONG"
      ? (currentPrice - position.entryPrice) / position.entryPrice
      : (position.entryPrice - currentPrice) / position.entryPrice;

    // Exit condition 1: Imbalance reverted
    const imbalanceReverted = Math.abs(currentImbalance) < this.params.exitImbalanceThreshold;

    // Exit condition 2: Profit target hit
    const profitTargetHit = profit >= this.params.exitProfitThreshold;

    // Exit condition 3: Time decay
    const timeDecayed = age >= this.params.maxPositionAge;

    if (imbalanceReverted) {
      return { shouldExit: true, reason: "Imbalance reverted to equilibrium" };
    }
    if (profitTargetHit) {
      return { shouldExit: true, reason: `Profit target hit: ${(profit * 100).toFixed(1)}%` };
    }
    if (timeDecayed) {
      return { shouldExit: true, reason: "Max position age exceeded" };
    }

    return { shouldExit: false, reason: null };
  }

  /**
   * Main analysis method
   */
  async analyze(marketSlug, capital = 340) {
    console.log(`\n📊 ${this.name}: Analyzing ${marketSlug}...`);

    if (!this.checkDependencies()) {
      return this.holdResponse("Missing dependencies");
    }

    // Check portfolio drawdown cap
    if (Math.abs(this.state.portfolioPnL) >= this.params.portfolioDDCap * capital) {
      return this.holdResponse(`Portfolio DD cap hit: ${(this.state.portfolioPnL / capital * 100).toFixed(1)}%`);
    }

    // Fetch all data in parallel
    const [gasData, orderbook, volumeData] = await Promise.all([
      this.fetchGasPrices(),
      this.fetchOrderbook(marketSlug),
      this.fetchMarketVolume(marketSlug),
    ]);

    // Update history
    if (gasData) {
      this.state.gasHistory.push(gasData);
      // Keep last 100 data points
      if (this.state.gasHistory.length > 100) {
        this.state.gasHistory.shift();
      }
    }

    if (volumeData) {
      this.state.volumeHistory.push(volumeData);
      if (this.state.volumeHistory.length > 100) {
        this.state.volumeHistory.shift();
      }
    }

    // Check for missing data
    if (!gasData || !orderbook || !volumeData) {
      return this.holdResponse("Insufficient data from APIs");
    }

    // Calculate metrics
    const gasStats = this.calculateGasStats();
    const { imbalance, bidVolume, askVolume, totalVolume } = this.calculateOrderbookImbalance(orderbook);
    const smoothedImbalance = this.applyKalmanFilter(imbalance);
    const { surge, avgVolume, isSurge } = this.calculateVolumeSurge(volumeData.volume);

    // Store imbalance history
    this.state.imbalanceHistory.push({
      raw: imbalance,
      smoothed: smoothedImbalance,
      timestamp: Date.now(),
    });
    if (this.state.imbalanceHistory.length > 100) {
      this.state.imbalanceHistory.shift();
    }

    // Log current state
    console.log(`   Gas: ${gasStats.current.toFixed(1)} gwei (z-score: ${gasStats.zScore.toFixed(2)}, spike: ${gasStats.isSpike})`);
    console.log(`   Imbalance: ${(imbalance * 100).toFixed(1)}% (smoothed: ${(smoothedImbalance * 100).toFixed(1)}%)`);
    console.log(`   Volume: ${volumeData.volume.toFixed(0)} (surge: ${(surge * 100).toFixed(1)}%, is_surge: ${isSurge})`);
    console.log(`   Orderbook: ${bidVolume.toFixed(0)} bids vs ${askVolume.toFixed(0)} asks`);

    // Check entry conditions
    const entryConditions = {
      imbalanceSignal: Math.abs(smoothedImbalance) > this.params.imbalanceThreshold,
      gasSpike: gasStats.isSpike,
      volumeSurge: isSurge,
    };

    const allConditionsMet = Object.values(entryConditions).every(c => c);

    console.log(`   Entry conditions: imbalance=${entryConditions.imbalanceSignal}, gas=${entryConditions.gasSpike}, volume=${entryConditions.volumeSurge}`);

    // Determine direction from imbalance
    const direction = smoothedImbalance > 0 ? "LONG" : "SHORT";
    const action = smoothedImbalance > 0 ? "BUY_UP" : "BUY_DOWN";

    // Calculate score and confidence
    let score = 0;
    let confidence = 0;

    if (allConditionsMet) {
      // Score based on imbalance magnitude
      score = Math.sign(smoothedImbalance) * Math.min(Math.abs(smoothedImbalance) * 3, 1);

      // Confidence based on signal strength
      const imbalanceStrength = Math.min(Math.abs(smoothedImbalance) / this.params.imbalanceThreshold, 1);
      const gasStrength = Math.min(gasStats.zScore / this.params.gasStdDevMultiplier, 1);
      const volumeStrength = Math.min(surge / this.params.volumeSurgeThreshold, 1);

      confidence = (imbalanceStrength + gasStrength + volumeStrength) / 3;

      // Calculate position size using Kelly criterion
      const edge = Math.abs(smoothedImbalance); // Estimated edge from imbalance
      const volatility = gasStats.stdDev / gasStats.avg; // Use gas volatility as proxy
      const kellyFraction = this.calculateKellyFraction(edge, volatility);

      console.log(`   ✅ Entry signal detected!`);
      console.log(`   Direction: ${direction}`);
      console.log(`   Score: ${(score * 100).toFixed(1)}%`);
      console.log(`   Confidence: ${(confidence * 100).toFixed(1)}%`);
      console.log(`   Kelly fraction: ${(kellyFraction * 100).toFixed(2)}%`);

      this.saveState();

      return {
        strategy: `creative:${this.name}`,
        score,
        confidence,
        recommendation: {
          action,
          reason: `Imbalance ${(smoothedImbalance * 100).toFixed(1)}% + Gas spike ${gasStats.zScore.toFixed(1)}σ + Volume surge ${(surge * 100).toFixed(1)}%`,
        },
        reason: `Entry: ${direction} on correlated signals`,
        data: {
          gasStats,
          imbalance: smoothedImbalance,
          volumeSurge: surge,
          kellyFraction,
          entryConditions,
        },
      };
    }

    // No entry signal
    this.saveState();

    return {
      strategy: `creative:${this.name}`,
      score: 0,
      confidence: 0,
      recommendation: {
        action: "HOLD",
        reason: "Entry conditions not met",
      },
      reason: `Waiting for signal: imb=${entryConditions.imbalanceSignal}, gas=${entryConditions.gasSpike}, vol=${entryConditions.volumeSurge}`,
      data: {
        gasStats,
        imbalance: smoothedImbalance,
        volumeSurge: surge,
        entryConditions,
      },
    };
  }

  holdResponse(reason) {
    return {
      strategy: `creative:${this.name}`,
      score: 0,
      confidence: 0,
      recommendation: { action: "HOLD", reason },
      reason,
    };
  }
}

module.exports = OrderbookImbalanceGasPredictorStrategy;
