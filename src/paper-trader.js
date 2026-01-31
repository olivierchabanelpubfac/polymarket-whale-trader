/**
 * PAPER TRADER
 * 
 * Log virtual trades for creative strategies
 * alongside real baseline trades.
 * 
 * Track performance to compare strategies over time.
 */

const fs = require("fs");
const path = require("path");
const config = require("./config");

const PAPER_FILE = path.join(__dirname, "../data/paper-trades.json");

class PaperTrader {
  constructor() {
    this.data = this.load();
  }

  load() {
    try {
      if (fs.existsSync(PAPER_FILE)) {
        return JSON.parse(fs.readFileSync(PAPER_FILE, "utf8"));
      }
    } catch (e) {}
    return {
      trades: [],
      performance: {
        baseline: { trades: 0, wins: 0, pnl: 0 },
        creative: {}
      }
    };
  }

  save() {
    const dir = path.dirname(PAPER_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(PAPER_FILE, JSON.stringify(this.data, null, 2));
  }

  /**
   * Log a trade (real or paper)
   */
  logTrade(params) {
    const {
      strategy,        // "baseline" or "creative:variant"
      isReal,          // true for baseline, false for paper
      market,
      action,          // "BUY_UP" or "BUY_DOWN"
      entryPrice,      // price at entry
      size,            // $ amount
      score,           // strategy score
      confidence,
      reason,
    } = params;

    const trade = {
      id: Date.now().toString(36),
      timestamp: Date.now(),
      version: config.VERSION,
      strategy,
      isReal,
      market,
      action,
      entryPrice,
      size,
      score,
      confidence,
      reason,
      status: "open",
      exitPrice: null,
      pnl: null,
    };

    this.data.trades.push(trade);
    this.save();

    const emoji = isReal ? "💰" : "📝";
    console.log(`\n${emoji} ${isReal ? "REAL" : "PAPER"} TRADE logged:`);
    console.log(`   Strategy: ${strategy}`);
    console.log(`   Action: ${action} @ ${(entryPrice * 100).toFixed(1)}%`);
    console.log(`   Size: $${size.toFixed(2)}`);

    return trade;
  }

  /**
   * Close all open trades for a market with final result
   */
  closeMarket(market, outcome, finalPrices) {
    const openTrades = this.data.trades.filter(
      t => t.market === market && t.status === "open"
    );

    console.log(`\n📊 Closing ${openTrades.length} trades for ${market}`);
    console.log(`   Outcome: ${outcome}`);

    for (const trade of openTrades) {
      // Calculate P&L
      const isWin = 
        (trade.action === "BUY_UP" && outcome === "UP") ||
        (trade.action === "BUY_DOWN" && outcome === "DOWN");

      // If win: each share pays $1. If lose: $0
      const exitPrice = isWin ? 1.0 : 0.0;
      const shares = trade.size / trade.entryPrice;
      const payout = shares * exitPrice;
      const pnl = payout - trade.size;
      const pnlPct = (pnl / trade.size * 100).toFixed(1);

      trade.status = "closed";
      trade.exitPrice = exitPrice;
      trade.pnl = pnl;
      trade.outcome = outcome;
      trade.closedAt = Date.now();

      // Update performance stats
      const stratKey = trade.strategy.startsWith("creative:") 
        ? trade.strategy.split(":")[1] 
        : trade.strategy;
      
      if (!this.data.performance[stratKey]) {
        this.data.performance[stratKey] = { trades: 0, wins: 0, pnl: 0 };
      }
      
      this.data.performance[stratKey].trades++;
      if (isWin) this.data.performance[stratKey].wins++;
      this.data.performance[stratKey].pnl += pnl;

      const emoji = trade.isReal ? "💰" : "📝";
      const resultEmoji = isWin ? "✅" : "❌";
      console.log(`\n${emoji} ${trade.strategy}: ${resultEmoji} ${isWin ? "WIN" : "LOSS"}`);
      console.log(`   Entry: ${(trade.entryPrice * 100).toFixed(1)}% → Exit: ${isWin ? "100%" : "0%"}`);
      console.log(`   P&L: ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)} (${pnlPct}%)`);
    }

    this.save();
    return openTrades;
  }

  /**
   * Show performance comparison
   */
  showPerformance() {
    console.log("\n" + "═".repeat(60));
    console.log("📊 PERFORMANCE COMPARISON");
    console.log("═".repeat(60));

    const perf = this.data.performance;
    
    // Sort by PnL
    const sorted = Object.entries(perf)
      .filter(([_, v]) => v.trades > 0)
      .sort((a, b) => b[1].pnl - a[1].pnl);

    console.log("\n Strategy           | Trades | Win Rate |    P&L");
    console.log("─".repeat(60));

    for (const [name, stats] of sorted) {
      const winRate = stats.trades > 0 
        ? ((stats.wins / stats.trades) * 100).toFixed(0) 
        : "0";
      const pnlStr = stats.pnl >= 0 
        ? `+$${stats.pnl.toFixed(2)}` 
        : `-$${Math.abs(stats.pnl).toFixed(2)}`;
      
      const isBaseline = name === "baseline";
      const emoji = isBaseline ? "💰" : "📝";
      
      console.log(
        ` ${emoji} ${name.padEnd(16)} |   ${stats.trades.toString().padStart(3)}  |    ${winRate.padStart(3)}%   | ${pnlStr.padStart(10)}`
      );
    }

    console.log("─".repeat(60));
    
    // Best performer
    if (sorted.length > 1) {
      const [bestName, bestStats] = sorted[0];
      const [baselineStats] = sorted.filter(([n]) => n === "baseline");
      
      if (bestName !== "baseline" && baselineStats) {
        const diff = bestStats.pnl - baselineStats[1].pnl;
        if (diff > 0) {
          console.log(`\n🏆 ${bestName} outperforms baseline by $${diff.toFixed(2)}!`);
        }
      }
    }

    console.log("═".repeat(60));
  }

  /**
   * Get open trades
   */
  getOpenTrades() {
    return this.data.trades.filter(t => t.status === "open");
  }
}

module.exports = PaperTrader;
