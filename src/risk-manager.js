/**
 * RISK MANAGER
 * 
 * Implements risk management rules before trade execution:
 * 1. MAX_EXPOSURE_PER_MARKET (20%) - No more than 20% of portfolio in one market
 * 2. COOLDOWN_MINUTES (10 min) - Min 10 min between trades for same strategy
 * 3. NO_STACKING_SAME_DIRECTION - No duplicate positions same market/direction
 * 4. POSITION_SIZING_PCT (5%) - Dynamic position sizing based on portfolio
 */

const config = require("./config");

class RiskManager {
  constructor(paperTrader) {
    this.paper = paperTrader;
    this.risk = config.RISK;
  }

  /**
   * Calculate total portfolio value (USDC + open positions)
   * For now, we estimate based on open trades
   */
  getPortfolioValue() {
    const openTrades = this.paper.getOpenTrades();
    const openValue = openTrades.reduce((sum, t) => sum + t.size, 0);
    
    // Assume starting balance of $500 for paper trading
    // In production, this would come from wallet balance
    const baseBalance = 500;
    return baseBalance + openValue;
  }

  /**
   * Calculate market exposure (total open positions on a market)
   */
  getMarketExposure(marketSlug) {
    const openTrades = this.paper.getOpenTrades();
    const marketTrades = openTrades.filter(t => t.market === marketSlug);
    return marketTrades.reduce((sum, t) => sum + t.size, 0);
  }

  /**
   * Get last trade timestamp for a strategy
   */
  getLastTradeTime(strategyName) {
    const trades = this.paper.data.trades.filter(t => t.strategy === strategyName);
    if (trades.length === 0) return null;
    
    // Sort by timestamp desc and get the most recent
    const sorted = trades.sort((a, b) => b.timestamp - a.timestamp);
    return sorted[0].timestamp;
  }

  /**
   * Check if a position already exists on market/direction
   */
  hasOpenPosition(strategyName, marketSlug, action) {
    const openTrades = this.paper.getOpenTrades();
    return openTrades.some(t => 
      t.strategy === strategyName && 
      t.market === marketSlug && 
      t.action === action
    );
  }

  /**
   * Calculate dynamic position size based on portfolio
   */
  calculatePositionSize(confidence = 0.5) {
    const portfolio = this.getPortfolioValue();
    let size = portfolio * this.risk.POSITION_SIZE_PCT;
    
    // Adjust by confidence (optional enhancement)
    size = size * (0.5 + confidence * 0.5); // 50-100% of base size
    
    // Apply min/max bounds
    size = Math.max(this.risk.MIN_TRADE_SIZE, size);
    size = Math.min(this.risk.MAX_TRADE_SIZE, size);
    
    return Math.round(size * 100) / 100; // Round to 2 decimals
  }

  /**
   * Validate a trade against all risk rules
   * Returns { valid: boolean, reason?: string, size?: number }
   */
  validate(params) {
    const { strategy, marketSlug, action, confidence } = params;
    
    // 1. Check market exposure limit (20%)
    const portfolio = this.getPortfolioValue();
    const currentExposure = this.getMarketExposure(marketSlug);
    const exposurePct = currentExposure / portfolio;
    
    if (exposurePct >= this.risk.MAX_EXPOSURE_PER_MARKET) {
      return {
        valid: false,
        rule: "MAX_EXPOSURE",
        reason: `Market exposure limit (${(exposurePct * 100).toFixed(1)}% >= ${this.risk.MAX_EXPOSURE_PER_MARKET * 100}%)`,
      };
    }

    // 2. Check cooldown (10 min)
    const lastTradeTime = this.getLastTradeTime(strategy);
    if (lastTradeTime) {
      const cooldownMs = this.risk.COOLDOWN_MINUTES * 60 * 1000;
      const elapsed = Date.now() - lastTradeTime;
      
      if (elapsed < cooldownMs) {
        const remainingMin = Math.ceil((cooldownMs - elapsed) / 60000);
        return {
          valid: false,
          rule: "COOLDOWN",
          reason: `Cooldown active (${remainingMin}min remaining)`,
        };
      }
    }

    // 3. Check no stacking same direction
    if (this.risk.NO_STACKING) {
      if (this.hasOpenPosition(strategy, marketSlug, action)) {
        return {
          valid: false,
          rule: "NO_STACKING",
          reason: `Position already open on ${marketSlug.substring(0, 20)}.../${action}`,
        };
      }
    }

    // 4. Calculate position size
    const size = this.calculatePositionSize(confidence);
    
    // Check if adding this position would exceed market exposure
    const newExposurePct = (currentExposure + size) / portfolio;
    if (newExposurePct > this.risk.MAX_EXPOSURE_PER_MARKET) {
      // Reduce size to fit within limit
      const maxAllowed = (this.risk.MAX_EXPOSURE_PER_MARKET * portfolio) - currentExposure;
      if (maxAllowed < this.risk.MIN_TRADE_SIZE) {
        return {
          valid: false,
          rule: "MAX_EXPOSURE",
          reason: `Would exceed market exposure limit (${(newExposurePct * 100).toFixed(1)}% > ${this.risk.MAX_EXPOSURE_PER_MARKET * 100}%)`,
        };
      }
      return {
        valid: true,
        size: Math.max(this.risk.MIN_TRADE_SIZE, maxAllowed),
        adjusted: true,
        adjustReason: `Size reduced to stay within exposure limit`,
      };
    }

    return {
      valid: true,
      size,
    };
  }

  /**
   * Log a risk skip with clear emoji format
   */
  logSkip(strategyName, validation) {
    const prefix = "⛔ RISK:";
    console.log(`${prefix} [${strategyName}] ${validation.reason}`);
  }

  /**
   * Get risk status summary
   */
  getStatus() {
    const portfolio = this.getPortfolioValue();
    const openTrades = this.paper.getOpenTrades();
    
    // Group by market
    const marketExposures = {};
    for (const trade of openTrades) {
      if (!marketExposures[trade.market]) {
        marketExposures[trade.market] = { total: 0, trades: [] };
      }
      marketExposures[trade.market].total += trade.size;
      marketExposures[trade.market].trades.push(trade);
    }
    
    return {
      portfolio,
      openTrades: openTrades.length,
      marketExposures,
      riskConfig: this.risk,
    };
  }
}

module.exports = RiskManager;
