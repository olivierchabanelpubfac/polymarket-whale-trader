/**
 * CREATIVE STRATEGY
 * 
 * Agent expérimental qui teste des approches alternatives:
 * - Contrarian (fade the crowd)
 * - Momentum pure (trend following)
 * - Whale copy (100% whale signals)
 * - Mean reversion
 * - Volatility breakout
 * - Social sentiment (à implémenter)
 */

const config = require("../config");

class CreativeStrategy {
  constructor() {
    this.name = "creative";
    this.currentVariant = null;
    this.variants = [
      "contrarian",
      "momentum_pure", 
      "whale_copy",
      "mean_reversion",
      "volatility_breakout",
      "time_decay",
    ];
  }

  /**
   * Rotate through variants or pick randomly
   */
  selectVariant() {
    // Rotate daily based on date
    const dayOfYear = Math.floor(Date.now() / 86400000);
    const idx = dayOfYear % this.variants.length;
    this.currentVariant = this.variants[idx];
    return this.currentVariant;
  }

  async analyze(marketSlug, marketData, signals) {
    const variant = this.selectVariant();
    
    console.log(`\n🎨 Creative Strategy: ${variant}`);
    
    switch (variant) {
      case "contrarian":
        return this.analyzeContrarian(signals, marketData);
      case "momentum_pure":
        return this.analyzeMomentumPure(signals);
      case "whale_copy":
        return this.analyzeWhaleCopy(signals);
      case "mean_reversion":
        return this.analyzeMeanReversion(marketData);
      case "volatility_breakout":
        return this.analyzeVolatilityBreakout(signals);
      case "time_decay":
        return this.analyzeTimeDecay(marketData);
      default:
        return this.analyzeContrarian(signals, marketData);
    }
  }

  /**
   * CONTRARIAN: Fade extreme sentiment
   * Quand tout le monde est bearish → go bullish
   */
  analyzeContrarian(signals, marketData) {
    const fearGreed = signals.sentiment?.fearGreed || 50;
    const whaleScore = signals.whale?.score || 0;
    
    let score = 0;
    let reason = "";
    
    // Extreme fear = buy signal
    if (fearGreed < 20) {
      score = 0.6;
      reason = `Extreme fear (${fearGreed}) - contrarian BUY`;
    }
    // Extreme greed = sell signal  
    else if (fearGreed > 80) {
      score = -0.6;
      reason = `Extreme greed (${fearGreed}) - contrarian SELL`;
    }
    // Fade whale consensus if extreme
    else if (Math.abs(whaleScore) > 0.8) {
      score = -whaleScore * 0.5; // Fade the whales
      reason = `Fading whale consensus (${(whaleScore*100).toFixed(0)}%)`;
    }
    
    return {
      strategy: "creative:contrarian",
      score,
      confidence: Math.abs(score) > 0.3 ? 0.7 : 0.4,
      recommendation: this.getRecommendation(score),
      reason,
    };
  }

  /**
   * MOMENTUM PURE: 100% price action
   * Ignore fundamentals, follow the trend
   */
  analyzeMomentumPure(signals) {
    const m = signals.momentum || {};
    
    // Weight recent momentum more heavily
    const score = (
      parseFloat(m.m5 || 0) * 0.4 +
      parseFloat(m.m15 || 0) * 0.3 +
      parseFloat(m.m60 || 0) * 0.2 +
      parseFloat(m.m240 || 0) * 0.1
    ) * 50; // Scale up
    
    return {
      strategy: "creative:momentum_pure",
      score: Math.max(-1, Math.min(1, score)),
      confidence: Math.abs(score) > 0.3 ? 0.75 : 0.5,
      recommendation: this.getRecommendation(score),
      reason: `Pure momentum: 5m=${m.m5}, 15m=${m.m15}`,
    };
  }

  /**
   * WHALE COPY: 100% follow the whales
   * Trust the smart money completely
   */
  analyzeWhaleCopy(signals) {
    const whaleScore = signals.whale?.score || 0;
    const whaleConfidence = signals.whale?.confidence || 0;
    
    return {
      strategy: "creative:whale_copy",
      score: whaleScore,
      confidence: whaleConfidence,
      recommendation: this.getRecommendation(whaleScore),
      reason: `100% whale copy: ${signals.whale?.details}`,
    };
  }

  /**
   * MEAN REVERSION: Bet on prices returning to 50%
   * When odds are extreme, bet on the underdog
   */
  analyzeMeanReversion(marketData) {
    const upPrice = marketData.upPrice || 0.5;
    const downPrice = marketData.downPrice || 0.5;
    
    let score = 0;
    let reason = "";
    
    // If UP is very cheap, bet on UP
    if (upPrice < 0.15) {
      score = (0.15 - upPrice) * 5; // Scale
      reason = `UP undervalued at ${(upPrice*100).toFixed(0)}%`;
    }
    // If DOWN is very cheap, bet on DOWN
    else if (downPrice < 0.15) {
      score = -(0.15 - downPrice) * 5;
      reason = `DOWN undervalued at ${(downPrice*100).toFixed(0)}%`;
    }
    
    return {
      strategy: "creative:mean_reversion",
      score: Math.max(-1, Math.min(1, score)),
      confidence: Math.abs(score) > 0.3 ? 0.6 : 0.3,
      recommendation: this.getRecommendation(score),
      reason,
    };
  }

  /**
   * VOLATILITY BREAKOUT: Trade big moves
   * When price moves fast, follow the direction
   */
  analyzeVolatilityBreakout(signals) {
    const m5 = Math.abs(parseFloat(signals.momentum?.m5 || 0));
    const m15 = Math.abs(parseFloat(signals.momentum?.m15 || 0));
    
    // High volatility threshold
    const isVolatile = m5 > 0.5 || m15 > 1.0;
    
    if (!isVolatile) {
      return {
        strategy: "creative:volatility_breakout",
        score: 0,
        confidence: 0.3,
        recommendation: { action: "HOLD", reason: "No volatility breakout" },
        reason: "Waiting for volatility",
      };
    }
    
    // Follow the direction of the breakout
    const direction = parseFloat(signals.momentum?.m5 || 0);
    const score = direction > 0 ? 0.7 : -0.7;
    
    return {
      strategy: "creative:volatility_breakout",
      score,
      confidence: 0.8,
      recommendation: this.getRecommendation(score),
      reason: `Volatility breakout detected: ${direction > 0 ? "UP" : "DOWN"}`,
    };
  }

  /**
   * TIME DECAY: Bet against extreme odds near expiration
   * Markets often overreact, then correct
   */
  analyzeTimeDecay(marketData) {
    const endDate = new Date(marketData.endDate);
    const now = new Date();
    const hoursRemaining = (endDate - now) / (1000 * 60 * 60);
    
    // Only active in last 6 hours
    if (hoursRemaining > 6) {
      return {
        strategy: "creative:time_decay",
        score: 0,
        confidence: 0.3,
        recommendation: { action: "HOLD", reason: "Too early for time decay" },
        reason: `${hoursRemaining.toFixed(1)}h remaining - waiting`,
      };
    }
    
    // In final hours, fade extreme odds
    const upPrice = marketData.upPrice || 0.5;
    let score = 0;
    
    if (upPrice < 0.1 || upPrice > 0.9) {
      // Extreme odds - bet on reversal
      score = upPrice < 0.5 ? 0.5 : -0.5;
    }
    
    return {
      strategy: "creative:time_decay",
      score,
      confidence: Math.abs(score) > 0.3 ? 0.65 : 0.4,
      recommendation: this.getRecommendation(score),
      reason: `Time decay: ${hoursRemaining.toFixed(1)}h left, odds at ${(upPrice*100).toFixed(0)}%`,
    };
  }

  getRecommendation(score) {
    if (score > 0.1) return { action: "BUY_UP", reason: `Score ${(score*100).toFixed(0)}% bullish` };
    if (score < -0.1) return { action: "BUY_DOWN", reason: `Score ${(-score*100).toFixed(0)}% bearish` };
    return { action: "HOLD", reason: "No clear signal" };
  }
}

module.exports = CreativeStrategy;
