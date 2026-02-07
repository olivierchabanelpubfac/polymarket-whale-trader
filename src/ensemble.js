/**
 * ENSEMBLE STRATEGY ALLOCATION
 * 
 * Instead of a single champion, all profitable strategies trade
 * with allocation proportional to their risk-adjusted performance.
 */

const fs = require("fs");
const path = require("path");

const PAPER_FILE = path.join(__dirname, "../data/paper-trades.json");
const ENSEMBLE_STATE_FILE = path.join(__dirname, "../data/ensemble-state.json");

// Minimum requirements for a strategy to be included in ensemble
const MIN_TRADES = 3;          // Need at least 3 closed trades
const MIN_WIN_RATE = 0.3;      // At least 30% win rate
const MIN_PNL = -10;           // Not too deep in the red
const LOOKBACK_HOURS = 168;    // 7 days for performance calculation

class EnsembleAllocator {
  constructor() {
    this.state = this.loadState();
  }

  loadState() {
    try {
      if (fs.existsSync(ENSEMBLE_STATE_FILE)) {
        return JSON.parse(fs.readFileSync(ENSEMBLE_STATE_FILE, "utf8"));
      }
    } catch (e) {}
    return {
      mode: "ensemble",  // "champion" or "ensemble"
      allocations: {},
      lastUpdate: Date.now(),
    };
  }

  saveState() {
    fs.writeFileSync(ENSEMBLE_STATE_FILE, JSON.stringify(this.state, null, 2));
  }

  /**
   * Load trades and calculate stats per strategy
   */
  getStrategyStats(lookbackHours = LOOKBACK_HOURS) {
    let trades = [];
    try {
      const data = JSON.parse(fs.readFileSync(PAPER_FILE, "utf8"));
      trades = data.trades || [];
    } catch (e) {
      return {};
    }

    const cutoff = Date.now() - lookbackHours * 60 * 60 * 1000;
    const stats = {};

    for (const trade of trades) {
      if (trade.timestamp < cutoff) continue;
      
      const strat = trade.strategy;
      if (!stats[strat]) {
        stats[strat] = {
          trades: 0,
          closedTrades: 0,
          wins: 0,
          totalPnl: 0,
          pnls: [],
        };
      }

      stats[strat].trades++;
      
      if (trade.status === "closed" && trade.pnl !== undefined) {
        stats[strat].closedTrades++;
        stats[strat].totalPnl += trade.pnl;
        stats[strat].pnls.push(trade.pnl);
        if (trade.pnl > 0) stats[strat].wins++;
      }
    }

    // Calculate derived metrics
    for (const [name, s] of Object.entries(stats)) {
      s.winRate = s.closedTrades > 0 ? s.wins / s.closedTrades : 0;
      s.avgPnl = s.closedTrades > 0 ? s.totalPnl / s.closedTrades : 0;
      
      // Calculate Sharpe-like ratio (avg return / std dev)
      if (s.pnls.length >= 2) {
        const mean = s.pnls.reduce((a, b) => a + b, 0) / s.pnls.length;
        const variance = s.pnls.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / s.pnls.length;
        const stdDev = Math.sqrt(variance);
        s.sharpe = stdDev > 0 ? mean / stdDev : 0;
      } else {
        s.sharpe = 0;
      }
    }

    return stats;
  }

  /**
   * Calculate allocation weights for each strategy
   * Returns: { strategyName: weight } where weights sum to 1
   */
  calculateAllocations() {
    const stats = this.getStrategyStats();
    const eligible = {};

    // Filter to eligible strategies
    for (const [name, s] of Object.entries(stats)) {
      // Skip disabled strategies
      if (name === "contrarian" || name === "mean_reversion") continue;
      
      if (
        s.closedTrades >= MIN_TRADES &&
        s.winRate >= MIN_WIN_RATE &&
        s.totalPnl >= MIN_PNL
      ) {
        eligible[name] = s;
      }
    }

    if (Object.keys(eligible).length === 0) {
      // Fallback: use momentum_pure or first available
      return { momentum_pure: 1.0 };
    }

    // Calculate weights based on Sharpe ratio (positive only)
    let totalWeight = 0;
    const weights = {};
    
    for (const [name, s] of Object.entries(eligible)) {
      // Use Sharpe if positive, else small base weight for profitable strategies
      const baseWeight = s.sharpe > 0 ? s.sharpe : (s.totalPnl > 0 ? 0.1 : 0);
      weights[name] = baseWeight;
      totalWeight += baseWeight;
    }

    // Normalize to sum to 1
    if (totalWeight > 0) {
      for (const name of Object.keys(weights)) {
        weights[name] /= totalWeight;
      }
    }

    // Apply minimum allocation floor (10%) and cap (50%)
    const MIN_ALLOC = 0.1;
    const MAX_ALLOC = 0.5;
    const MAX_ITERATIONS = 10; // Prevent infinite loop
    
    let adjusted = { ...weights };
    let iterations = 0;
    
    while (iterations < MAX_ITERATIONS) {
      iterations++;
      let needsRebalance = false;
      let total = 0;
      
      for (const [name, w] of Object.entries(adjusted)) {
        if (w > 0 && w < MIN_ALLOC) {
          adjusted[name] = MIN_ALLOC;
          needsRebalance = true;
        }
        if (w > MAX_ALLOC) {
          adjusted[name] = MAX_ALLOC;
          needsRebalance = true;
        }
        total += adjusted[name];
      }
      
      // Renormalize
      if (total > 0 && Math.abs(total - 1) > 0.01) {
        for (const name of Object.keys(adjusted)) {
          adjusted[name] /= total;
        }
      }
      
      if (!needsRebalance) break;
    }

    return adjusted;
  }

  /**
   * Determine if a strategy should trade and with what size
   * @param {string} strategyName 
   * @param {number} baseSize - Base position size
   * @returns {{ canTrade: boolean, size: number, allocation: number }}
   */
  getAllocation(strategyName, baseSize) {
    const allocations = this.calculateAllocations();
    const allocation = allocations[strategyName] || 0;
    
    return {
      canTrade: allocation > 0,
      size: baseSize * allocation,
      allocation,
      isEnsemble: true,
    };
  }

  /**
   * Print ensemble status
   */
  showStatus() {
    const stats = this.getStrategyStats();
    const allocations = this.calculateAllocations();

    console.log("\n" + "═".repeat(60));
    console.log("🎭 ENSEMBLE ALLOCATION");
    console.log("═".repeat(60));

    console.log("\n Strategy            | Trades | Win% | PnL     | Sharpe | Alloc");
    console.log("─".repeat(60));

    for (const [name, alloc] of Object.entries(allocations).sort((a, b) => b[1] - a[1])) {
      const s = stats[name] || { closedTrades: 0, winRate: 0, totalPnl: 0, sharpe: 0 };
      const pnlStr = s.totalPnl >= 0 ? `+$${s.totalPnl.toFixed(2)}` : `-$${Math.abs(s.totalPnl).toFixed(2)}`;
      console.log(
        ` ${name.padEnd(19)} |   ${String(s.closedTrades).padStart(3)}  | ${(s.winRate * 100).toFixed(0).padStart(3)}% | ${pnlStr.padStart(7)} |  ${s.sharpe.toFixed(2).padStart(4)} | ${(alloc * 100).toFixed(0)}%`
      );
    }

    console.log("═".repeat(60));
    
    return allocations;
  }
}

module.exports = EnsembleAllocator;
