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
const InsiderTracker = require("./insider-tracker");
const CrossExchangeArb = require("./cross-exchange-arb");
const SentimentDivergence = require("./sentiment-divergence");
const DemNomSentimentGasAccel = require("./dem-nom-sentiment-gas-accel");

class CreativeStrategy {
  constructor() {
    this.name = "creative";
    this.currentVariant = null;
    this.insiderTracker = new InsiderTracker();
    this.crossExchangeArb = new CrossExchangeArb();
    this.sentimentDivergence = new SentimentDivergence();
    this.demNomSentimentGas = new DemNomSentimentGasAccel();
    this.variants = [
      "contrarian",
      "momentum_pure", 
      "whale_copy",
      "mean_reversion",
      "volatility_breakout",
      "time_decay",
      "insider_tracker",
      "cross_exchange_arb",
      "sentiment_divergence",
      "dem_nom_sentiment_gas",
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
      case "insider_tracker":
        return this.insiderTracker.analyze(marketData.slug);
      case "cross_exchange_arb":
        return this.crossExchangeArb.analyze(marketData.slug);
      case "sentiment_divergence":
        return this.sentimentDivergence.analyze(marketData.slug);
      case "dem_nom_sentiment_gas":
        return this.demNomSentimentGas.analyze(marketData.slug);
      default:
        return this.analyzeContrarian(signals, marketData);
    }
  }

  /**
   * CONTRARIAN: Fade extreme sentiment
   * Quand tout le monde est bearish → go bullish
   * Enhanced: uses market-specific price bonus to diversify across markets
   */
  analyzeContrarian(signals, marketData) {
    const fearGreed = signals.sentiment?.fearGreed || 50;
    const whaleScore = signals.whale?.score || 0;
    const upPrice = marketData?.upPrice || 0.5;
    
    let baseScore = 0;
    let reason = "";
    
    // Extreme fear = buy signal
    if (fearGreed < 20) {
      baseScore = 0.6;
      reason = `Extreme fear (${fearGreed}) - contrarian BUY`;
    }
    // Extreme greed = sell signal  
    else if (fearGreed > 80) {
      baseScore = -0.6;
      reason = `Extreme greed (${fearGreed}) - contrarian SELL`;
    }
    // Fade whale consensus if extreme
    else if (Math.abs(whaleScore) > 0.8) {
      baseScore = -whaleScore * 0.5; // Fade the whales
      reason = `Fading whale consensus (${(whaleScore*100).toFixed(0)}%)`;
    }
    
    // Market-specific bonus: favor prices near 50% (most room to move)
    // Also add small random factor for market diversity
    const priceBonus = (1 - Math.abs(upPrice - 0.5) * 2) * 0.1; // 0 to 0.1
    const marketHash = (marketData?.slug || "").length % 10 / 100; // 0 to 0.09
    const score = baseScore + priceBonus + marketHash;
    
    return {
      strategy: "creative:contrarian",
      score,
      confidence: Math.abs(baseScore) > 0.3 ? 0.7 : 0.4,
      recommendation: this.getRecommendation(score),
      reason: reason + ` [${(upPrice*100).toFixed(0)}% price]`,
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
   * Enhanced: now triggers at wider price ranges (not just <15%)
   * Favors markets with prices 30-70% (away from 50% but not extreme)
   */
  analyzeMeanReversion(marketData) {
    const upPrice = marketData?.upPrice || 0.5;
    const downPrice = marketData?.downPrice || 0.5;
    const marketHash = ((marketData?.slug || "").length * 7) % 10 / 100;
    
    let score = 0;
    let reason = "";
    
    // Distance from 50% - the further away, the stronger the reversion signal
    const distanceFrom50 = Math.abs(upPrice - 0.5);
    
    // Active range: 20-45% or 55-80% (bet toward 50%)
    if (upPrice < 0.45 && upPrice > 0.15) {
      score = (0.45 - upPrice) * 2 + marketHash; // Bet UP
      reason = `UP at ${(upPrice*100).toFixed(0)}% - expect reversion to 50%`;
    }
    else if (upPrice > 0.55 && upPrice < 0.85) {
      score = -(upPrice - 0.55) * 2 - marketHash; // Bet DOWN
      reason = `UP at ${(upPrice*100).toFixed(0)}% - expect reversion to 50%`;
    }
    // Extreme prices (old behavior but stronger)
    else if (upPrice < 0.15) {
      score = (0.15 - upPrice) * 5 + marketHash;
      reason = `UP extremely cheap at ${(upPrice*100).toFixed(0)}%`;
    }
    else if (downPrice < 0.15) {
      score = -(0.15 - downPrice) * 5 - marketHash;
      reason = `DOWN extremely cheap at ${(downPrice*100).toFixed(0)}%`;
    }
    
    return {
      strategy: "creative:mean_reversion",
      score: Math.max(-1, Math.min(1, score)),
      confidence: Math.abs(score) > 0.2 ? 0.65 : 0.35,
      recommendation: this.getRecommendation(score),
      reason: reason || "No mean reversion signal",
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
   * TIME DECAY: Bet on probability drift
   * Enhanced: uses Bayesian probability updates based on price position
   * More active - doesn't wait for expiration
   */
  analyzeTimeDecay(marketData) {
    const upPrice = marketData?.upPrice || 0.5;
    const endDate = marketData?.endDate ? new Date(marketData.endDate) : null;
    const now = new Date();
    const hoursRemaining = endDate ? (endDate - now) / (1000 * 60 * 60) : 1000;
    const marketHash = ((marketData?.slug || "").length * 13) % 10 / 100;
    
    let score = 0;
    let reason = "";
    
    // Active strategy: bet on undervalued outcomes
    // If something is priced at 30-45%, there's value betting UP
    // If something is priced at 55-70%, there's value betting DOWN
    if (upPrice >= 0.30 && upPrice <= 0.45) {
      score = (0.45 - upPrice) * 1.5 + marketHash;
      reason = `Value bet: UP at ${(upPrice*100).toFixed(0)}% undervalued`;
    }
    else if (upPrice >= 0.55 && upPrice <= 0.70) {
      score = -(upPrice - 0.55) * 1.5 - marketHash;
      reason = `Value bet: DOWN (NO) at ${((1-upPrice)*100).toFixed(0)}% undervalued`;
    }
    // Near expiration: fade extreme odds more aggressively
    else if (hoursRemaining < 24 && (upPrice < 0.1 || upPrice > 0.9)) {
      score = upPrice < 0.5 ? 0.5 : -0.5;
      reason = `Time decay near expiry: ${hoursRemaining.toFixed(0)}h left, extreme odds`;
    }
    
    return {
      strategy: "creative:time_decay",
      score,
      confidence: Math.abs(score) > 0.2 ? 0.65 : 0.4,
      recommendation: this.getRecommendation(score),
      reason: reason || `Neutral at ${(upPrice*100).toFixed(0)}%`,
    };
  }

  getRecommendation(score) {
    if (score > 0.1) return { action: "BUY_UP", reason: `Score ${(score*100).toFixed(0)}% bullish` };
    if (score < -0.1) return { action: "BUY_DOWN", reason: `Score ${(-score*100).toFixed(0)}% bearish` };
    return { action: "HOLD", reason: "No clear signal" };
  }
}

module.exports = CreativeStrategy;
