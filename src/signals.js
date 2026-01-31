/**
 * Signal Sources for Trading Decisions
 */

const config = require("./config");

class SignalAggregator {
  constructor() {
    this.cache = {};
    this.cacheTTL = 60000; // 1 minute cache
  }

  async cached(key, fetcher) {
    const now = Date.now();
    if (this.cache[key] && now - this.cache[key].time < this.cacheTTL) {
      return this.cache[key].data;
    }
    const data = await fetcher();
    this.cache[key] = { data, time: now };
    return data;
  }

  // === WHALE SIGNALS ===
  
  async getWhalePositions(marketSlug) {
    return this.cached(`whales_${marketSlug}`, async () => {
      const positions = [];
      
      for (const [address, whale] of Object.entries(config.WHALES)) {
        try {
          const resp = await fetch(
            `${config.DATA_HOST}/positions?user=${address}`
          );
          const data = await resp.json();
          
          // Find positions on this market
          const marketPositions = data.filter(p => 
            p.eventSlug?.includes(marketSlug) || 
            p.title?.toLowerCase().includes("bitcoin")
          );
          
          for (const pos of marketPositions) {
            if (pos.currentValue >= whale.minPosition) {
              positions.push({
                whale: whale.name,
                address,
                weight: whale.weight,
                outcome: pos.outcome,
                size: pos.currentValue,
                price: pos.curPrice,
                pnl: pos.percentPnl,
              });
            }
          }
        } catch (e) {
          console.error(`Failed to fetch ${whale.name}: ${e.message}`);
        }
        
        // Rate limiting
        await new Promise(r => setTimeout(r, 200));
      }
      
      return positions;
    });
  }

  calculateWhaleConsensus(positions) {
    if (!positions.length) {
      return { score: 0, confidence: 0, details: "No whale positions" };
    }

    let upWeight = 0;
    let downWeight = 0;
    let totalWeight = 0;

    for (const pos of positions) {
      const posWeight = pos.weight * Math.log10(pos.size + 1);
      
      if (pos.outcome?.toLowerCase().includes("up") || 
          pos.outcome?.toLowerCase().includes("yes")) {
        upWeight += posWeight;
      } else {
        downWeight += posWeight;
      }
      totalWeight += posWeight;
    }

    if (totalWeight === 0) {
      return { score: 0, confidence: 0, details: "No weighted positions" };
    }

    // Score from -1 (all down) to +1 (all up)
    const score = (upWeight - downWeight) / totalWeight;
    
    // Confidence based on number of whales agreeing
    const dominantCount = positions.filter(p => {
      const isUp = p.outcome?.toLowerCase().includes("up");
      return score > 0 ? isUp : !isUp;
    }).length;
    const confidence = dominantCount / positions.length;

    return {
      score,
      confidence,
      upWeight,
      downWeight,
      whaleCount: positions.length,
      details: `${positions.length} whales, consensus: ${score > 0 ? "UP" : "DOWN"}`,
    };
  }

  // === PRICE MOMENTUM ===
  
  async getBTCData() {
    return this.cached("btc_data", async () => {
      try {
        const resp = await fetch(
          "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=1"
        );
        const data = await resp.json();
        return data.prices || [];
      } catch (e) {
        console.error(`Failed to fetch BTC data: ${e.message}`);
        return [];
      }
    });
  }

  async getMomentumSignals() {
    const prices = await this.getBTCData();
    if (prices.length < 10) {
      return { score: 0, confidence: 0, details: "Insufficient data" };
    }

    const currentPrice = prices[prices.length - 1][1];
    const now = Date.now();

    // Calculate momentum at different timeframes
    const getMomentum = (minutesAgo) => {
      const targetTime = now - minutesAgo * 60 * 1000;
      let pastPrice = currentPrice;
      for (let i = prices.length - 1; i >= 0; i--) {
        if (prices[i][0] <= targetTime) {
          pastPrice = prices[i][1];
          break;
        }
      }
      return (currentPrice - pastPrice) / pastPrice;
    };

    const m5 = getMomentum(5);
    const m15 = getMomentum(15);
    const m60 = getMomentum(60);
    const m240 = getMomentum(240);

    // Weighted momentum score
    const score = (m5 * 0.1 + m15 * 0.2 + m60 * 0.3 + m240 * 0.4) * 10;
    
    // Confidence based on alignment
    const signs = [m5, m15, m60, m240].map(m => m > 0 ? 1 : -1);
    const alignment = Math.abs(signs.reduce((a, b) => a + b, 0)) / 4;

    return {
      score: Math.max(-1, Math.min(1, score)),
      confidence: alignment,
      price: currentPrice,
      m5: (m5 * 100).toFixed(2) + "%",
      m15: (m15 * 100).toFixed(2) + "%",
      m60: (m60 * 100).toFixed(2) + "%",
      m240: (m240 * 100).toFixed(2) + "%",
      details: `BTC $${currentPrice.toLocaleString()}, 1h: ${(m60 * 100).toFixed(2)}%`,
    };
  }

  // === TECHNICAL INDICATORS ===
  
  calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50;

    const changes = [];
    for (let i = 1; i < prices.length; i++) {
      changes.push(prices[i][1] - prices[i - 1][1]);
    }

    const recentChanges = changes.slice(-period);
    const gains = recentChanges.filter(c => c > 0);
    const losses = recentChanges.filter(c => c < 0).map(c => -c);

    const avgGain = gains.length ? gains.reduce((a, b) => a + b, 0) / period : 0;
    const avgLoss = losses.length ? losses.reduce((a, b) => a + b, 0) / period : 0;

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  async getTechnicalSignals() {
    const prices = await this.getBTCData();
    if (prices.length < 20) {
      return { score: 0, confidence: 0, details: "Insufficient data" };
    }

    const rsi = this.calculateRSI(prices);
    
    // RSI signal: oversold (<30) = bullish, overbought (>70) = bearish
    let rsiScore = 0;
    if (rsi < 30) rsiScore = (30 - rsi) / 30;  // Max +1 at RSI 0
    else if (rsi > 70) rsiScore = -(rsi - 70) / 30;  // Max -1 at RSI 100
    
    // Simple MA cross (short vs long)
    const recentPrices = prices.slice(-20).map(p => p[1]);
    const ma5 = recentPrices.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const ma20 = recentPrices.reduce((a, b) => a + b, 0) / 20;
    const maScore = (ma5 - ma20) / ma20 * 10;

    const score = (rsiScore * 0.6 + Math.max(-1, Math.min(1, maScore)) * 0.4);
    
    return {
      score: Math.max(-1, Math.min(1, score)),
      confidence: Math.abs(score) > 0.3 ? 0.8 : 0.5,
      rsi: rsi.toFixed(1),
      ma5: ma5.toFixed(0),
      ma20: ma20.toFixed(0),
      details: `RSI: ${rsi.toFixed(1)}, MA5/20: ${ma5 > ma20 ? "bullish" : "bearish"}`,
    };
  }

  // === SENTIMENT ===
  
  async getSentimentSignals() {
    return this.cached("sentiment", async () => {
      try {
        const resp = await fetch("https://api.alternative.me/fng/");
        const data = await resp.json();
        const fng = parseInt(data.data[0].value);
        
        // Fear & Greed: 0-25 = extreme fear (bullish contrarian)
        // 75-100 = extreme greed (bearish contrarian)
        let score = 0;
        if (fng < 25) score = (25 - fng) / 50;  // Contrarian bullish
        else if (fng > 75) score = -(fng - 75) / 50;  // Contrarian bearish
        else score = (fng - 50) / 100;  // Mild trend following
        
        return {
          score,
          confidence: Math.abs(fng - 50) > 25 ? 0.7 : 0.4,
          fearGreed: fng,
          classification: data.data[0].value_classification,
          details: `Fear & Greed: ${fng} (${data.data[0].value_classification})`,
        };
      } catch (e) {
        return { score: 0, confidence: 0, details: "Failed to fetch sentiment" };
      }
    });
  }

  // === AGGREGATE ===
  
  async getAllSignals(marketSlug = "bitcoin") {
    console.log("\n📡 Fetching signals...\n");

    const [whalePositions, momentum, technicals, sentiment] = await Promise.all([
      this.getWhalePositions(marketSlug),
      this.getMomentumSignals(),
      this.getTechnicalSignals(),
      this.getSentimentSignals(),
    ]);

    const whaleConsensus = this.calculateWhaleConsensus(whalePositions);

    const signals = {
      whale: whaleConsensus,
      momentum,
      technicals,
      sentiment,
    };

    // Calculate weighted final score
    const weights = config.WEIGHTS;
    const finalScore = 
      whaleConsensus.score * weights.WHALE_CONSENSUS +
      momentum.score * weights.MOMENTUM +
      technicals.score * weights.TECHNICALS +
      sentiment.score * weights.SENTIMENT;

    // Confidence is weighted average of confident signals
    const finalConfidence = 
      whaleConsensus.confidence * weights.WHALE_CONSENSUS +
      momentum.confidence * weights.MOMENTUM +
      technicals.confidence * weights.TECHNICALS +
      sentiment.confidence * weights.SENTIMENT;

    return {
      signals,
      finalScore,
      finalConfidence,
      recommendation: this.getRecommendation(finalScore, finalConfidence),
    };
  }

  getRecommendation(score, confidence) {
    if (confidence < config.MIN_CONFIDENCE) {
      return { action: "HOLD", reason: "Low confidence" };
    }
    
    if (score > config.MIN_EDGE) {
      return { action: "BUY_UP", reason: `Score ${(score * 100).toFixed(1)}% bullish` };
    } else if (score < -config.MIN_EDGE) {
      return { action: "BUY_DOWN", reason: `Score ${(-score * 100).toFixed(1)}% bearish` };
    }
    
    return { action: "HOLD", reason: "No clear edge" };
  }
}

module.exports = SignalAggregator;
