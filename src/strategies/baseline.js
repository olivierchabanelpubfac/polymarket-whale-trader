/**
 * BASELINE STRATEGY
 * 
 * Notre stratégie de référence:
 * - 50% Whale consensus
 * - 20% Momentum multi-timeframe
 * - 15% Technicals (RSI, MA)
 * - 15% Sentiment (Fear & Greed)
 */

const SignalAggregator = require("../signals");

class BaselineStrategy {
  constructor() {
    this.name = "baseline";
    this.description = "Whale consensus + momentum + technicals + sentiment";
    this.signals = new SignalAggregator();
  }

  async analyze(marketSlug) {
    const analysis = await this.signals.getAllSignals(marketSlug);
    
    return {
      strategy: this.name,
      score: analysis.finalScore,
      confidence: analysis.finalConfidence,
      recommendation: analysis.recommendation,
      signals: analysis.signals,
    };
  }
}

module.exports = BaselineStrategy;
