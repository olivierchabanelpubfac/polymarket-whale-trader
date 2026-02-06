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

  /**
   * Calcule le PnL mark-to-market d'un trade ouvert
   * Basé sur le prix actuel vs prix d'entrée
   */
  calculateMtmPnL(trade, currentPrices) {
    if (trade.status === "closed") {
      return trade.pnl || 0;
    }

    // Pour les trades ouverts, estimer le PnL basé sur le prix actuel
    const side = trade.action === "BUY_UP" ? "up" : "down";
    const currentPrice = currentPrices?.[side] || trade.entryPrice;
    
    // Shares = size / entryPrice
    // Current value = shares * currentPrice
    // PnL = current value - cost basis
    const shares = trade.size / trade.entryPrice;
    const currentValue = shares * currentPrice;
    const pnl = currentValue - trade.size;

    return pnl;
  }

  /**
   * Récupère les performances sur une fenêtre glissante
   * @param {number} hours - Nombre d'heures de la fenêtre
   * @param {object} currentPrices - Prix actuels pour le mark-to-market { up, down }
   * @returns {object} Performances par stratégie
   */
  getPerformanceWindow(hours, currentPrices = null) {
    const windowStart = Date.now() - hours * 60 * 60 * 1000;
    const performances = {};

    // Filtrer les trades dans la fenêtre
    const windowTrades = this.data.trades.filter(t => t.timestamp >= windowStart);

    for (const trade of windowTrades) {
      // Normaliser le nom de stratégie (enlever "creative:" prefix)
      const stratName = trade.strategy.startsWith("creative:") 
        ? trade.strategy.split(":")[1] 
        : trade.strategy;

      if (!performances[stratName]) {
        performances[stratName] = {
          trades: 0,
          wins: 0,
          pnl: 0,
          openPnL: 0,
          closedPnL: 0,
        };
      }

      performances[stratName].trades++;

      if (trade.status === "closed") {
        // Trade fermé - utiliser le PnL réel
        performances[stratName].closedPnL += trade.pnl || 0;
        performances[stratName].pnl += trade.pnl || 0;
        if (trade.pnl > 0) performances[stratName].wins++;
      } else {
        // Trade ouvert - calculer le mark-to-market
        const mtmPnL = this.calculateMtmPnL(trade, currentPrices);
        performances[stratName].openPnL += mtmPnL;
        performances[stratName].pnl += mtmPnL;
      }
    }

    return performances;
  }

  /**
   * Met à jour le mark-to-market de tous les trades ouverts
   * avec les prix actuels du marché
   */
  updateMarkToMarket(market, currentPrices) {
    const openTrades = this.data.trades.filter(
      t => t.market === market && t.status === "open"
    );

    for (const trade of openTrades) {
      trade.currentMtmPnL = this.calculateMtmPnL(trade, currentPrices);
      trade.lastMtmUpdate = Date.now();
    }

    this.save();
    return openTrades;
  }

  /**
   * Affiche les performances sur une fenêtre glissante
   */
  showPerformanceWindow(hours, currentPrices = null) {
    console.log("\n" + "═".repeat(60));
    console.log(`📊 PERFORMANCE (dernières ${hours}h)`);
    console.log("═".repeat(60));

    const perf = this.getPerformanceWindow(hours, currentPrices);
    
    // Sort by PnL
    const sorted = Object.entries(perf)
      .filter(([_, v]) => v.trades > 0)
      .sort((a, b) => b[1].pnl - a[1].pnl);

    if (sorted.length === 0) {
      console.log("\n   Aucun trade dans cette fenêtre.");
      console.log("═".repeat(60));
      return;
    }

    console.log("\n Stratégie         | Trades | Closed PnL | Open PnL |  Total");
    console.log("─".repeat(60));

    for (const [name, stats] of sorted) {
      const closedStr = stats.closedPnL >= 0 
        ? `+$${stats.closedPnL.toFixed(2)}` 
        : `-$${Math.abs(stats.closedPnL).toFixed(2)}`;
      const openStr = stats.openPnL >= 0 
        ? `+$${stats.openPnL.toFixed(2)}` 
        : `-$${Math.abs(stats.openPnL).toFixed(2)}`;
      const totalStr = stats.pnl >= 0 
        ? `+$${stats.pnl.toFixed(2)}` 
        : `-$${Math.abs(stats.pnl).toFixed(2)}`;
      
      console.log(
        ` ${name.padEnd(18)} |   ${stats.trades.toString().padStart(3)}  | ${closedStr.padStart(10)} | ${openStr.padStart(8)} | ${totalStr.padStart(8)}`
      );
    }

    console.log("═".repeat(60));
  }

  /**
   * CHECK TAKE PROFITS - Ferme les positions qui ont atteint leur cible
   * @param {object} marketPrices - Map de slug -> { upPrice, downPrice }
   * @returns {array} Trades fermés avec profit
   */
  checkTakeProfits(marketPrices) {
    const openTrades = this.getOpenTrades();
    const closedTrades = [];
    const takeProfitPct = config.TAKE_PROFIT_PCT || 0.30; // 30% par défaut

    for (const trade of openTrades) {
      const prices = marketPrices[trade.market];
      if (!prices) continue; // Market not in current cycle

      const currentPrice = trade.action === "BUY_UP" ? prices.upPrice : prices.downPrice;
      if (!currentPrice) continue;

      // Calculate profit percentage
      const entryPrice = trade.entryPrice;
      let profitPct;
      
      if (trade.action === "BUY_UP") {
        // For BUY_UP: profit when price goes UP
        profitPct = (currentPrice - entryPrice) / entryPrice;
      } else {
        // For BUY_DOWN: profit when price goes DOWN (we bought the NO side)
        // Entry was at (1 - upPrice), current is (1 - currentUpPrice)
        // But since we store downPrice entry, check if down price went up
        profitPct = (currentPrice - entryPrice) / entryPrice;
      }

      // Check if take profit hit
      if (profitPct >= takeProfitPct) {
        // Close the position with profit
        const shares = trade.size / trade.entryPrice;
        const exitValue = shares * currentPrice;
        const pnl = exitValue - trade.size;

        trade.status = "closed";
        trade.exitPrice = currentPrice;
        trade.pnl = pnl;
        trade.closedAt = Date.now();
        trade.closeReason = "TAKE_PROFIT";

        // Update performance stats
        const stratKey = trade.strategy.startsWith("creative:") 
          ? trade.strategy.split(":")[1] 
          : trade.strategy;
        
        if (!this.data.performance[stratKey]) {
          this.data.performance[stratKey] = { trades: 0, wins: 0, pnl: 0 };
        }
        this.data.performance[stratKey].trades++;
        this.data.performance[stratKey].wins++;
        this.data.performance[stratKey].pnl += pnl;

        console.log(`\n🎯 TAKE PROFIT HIT!`);
        console.log(`   ${trade.strategy}: ${trade.action} on ${trade.market.substring(0, 30)}`);
        console.log(`   Entry: ${(entryPrice * 100).toFixed(1)}% → Exit: ${(currentPrice * 100).toFixed(1)}%`);
        console.log(`   Profit: +$${pnl.toFixed(2)} (+${(profitPct * 100).toFixed(1)}%)`);

        closedTrades.push(trade);
      }
    }

    if (closedTrades.length > 0) {
      this.save();
    }

    return closedTrades;
  }
}

module.exports = PaperTrader;
