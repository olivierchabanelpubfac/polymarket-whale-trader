/**
 * INSIDER WHALE TRACKER
 * 
 * Détecte les "early movers" sur nouveaux marchés:
 * - Monitor nouveaux wallets avec gros bets (>$10k)
 * - Détecte clusters de bets unilatéraux
 * - Bayesian probability aggregation
 * - Delayed entry pour éviter front-running
 */

const config = require("../config");
const fs = require("fs");
const path = require("path");

const CACHE_FILE = path.join(__dirname, "../../data/insider-cache.json");

// Known whales to EXCLUDE (we want NEW wallets)
const KNOWN_WHALES = new Set(Object.keys(config.WHALES));

class InsiderTracker {
  constructor() {
    this.cache = this.loadCache();
    this.minBetSize = 10000; // $10k minimum
    this.clusterThreshold = 3; // 3+ wallets = cluster
    this.delayMinutes = 5; // Wait 5min before entry
  }

  loadCache() {
    try {
      if (fs.existsSync(CACHE_FILE)) {
        return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
      }
    } catch (e) {}
    return { 
      trackedMarkets: {},
      signals: [],
      lastScan: 0 
    };
  }

  saveCache() {
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(this.cache, null, 2));
  }

  /**
   * Fetch recent large trades on a market
   */
  async fetchMarketActivity(conditionId) {
    try {
      // Use Polymarket activity API
      const resp = await fetch(
        `https://data-api.polymarket.com/activity?market=${conditionId}&limit=100`
      );
      return await resp.json();
    } catch (e) {
      console.error(`Failed to fetch activity: ${e.message}`);
      return [];
    }
  }

  /**
   * Fetch new/fresh markets (created in last 24h)
   */
  async fetchFreshMarkets() {
    try {
      const resp = await fetch(
        `https://gamma-api.polymarket.com/events?active=true&closed=false&limit=50`
      );
      const events = await resp.json();
      
      const now = Date.now();
      const oneDayAgo = now - 24 * 60 * 60 * 1000;
      
      // Filter to recent markets with decent volume
      return events.filter(e => {
        const created = new Date(e.createdAt || e.startDate).getTime();
        return created > oneDayAgo && (e.volume || 0) > 10000;
      });
    } catch (e) {
      console.error(`Failed to fetch markets: ${e.message}`);
      return [];
    }
  }

  /**
   * Analyze activity for insider patterns
   */
  analyzeInsiderPatterns(activity, marketSlug) {
    // Group by wallet
    const walletBets = {};
    
    for (const trade of activity) {
      const wallet = trade.user?.toLowerCase();
      if (!wallet) continue;
      
      // Skip known whales
      if (KNOWN_WHALES.has(wallet)) continue;
      
      const size = Math.abs(trade.usdcSize || trade.size || 0);
      if (size < this.minBetSize) continue;
      
      if (!walletBets[wallet]) {
        walletBets[wallet] = { 
          wallet, 
          bets: [], 
          totalSize: 0,
          direction: null 
        };
      }
      
      walletBets[wallet].bets.push(trade);
      walletBets[wallet].totalSize += size;
      walletBets[wallet].direction = trade.side || trade.outcome;
    }

    const newWallets = Object.values(walletBets);
    
    if (newWallets.length === 0) {
      return null;
    }

    // Check for cluster (multiple wallets same direction)
    const directions = {};
    for (const w of newWallets) {
      const dir = w.direction?.toLowerCase();
      if (dir) {
        directions[dir] = (directions[dir] || 0) + 1;
      }
    }

    // Find dominant direction
    let dominantDir = null;
    let dominantCount = 0;
    for (const [dir, count] of Object.entries(directions)) {
      if (count > dominantCount) {
        dominantDir = dir;
        dominantCount = count;
      }
    }

    const isCluster = dominantCount >= this.clusterThreshold;
    const totalVolume = newWallets.reduce((sum, w) => sum + w.totalSize, 0);

    return {
      market: marketSlug,
      newWalletCount: newWallets.length,
      dominantDirection: dominantDir,
      clusterSize: dominantCount,
      isCluster,
      totalVolume,
      wallets: newWallets.map(w => ({
        wallet: w.wallet.slice(0, 10) + "...",
        size: w.totalSize,
        direction: w.direction,
      })),
      detectedAt: Date.now(),
    };
  }

  /**
   * Bayesian probability aggregation
   * Combine multiple signals into confidence score
   */
  bayesianAggregate(signals) {
    if (signals.length === 0) return { score: 0, confidence: 0 };

    // Prior: 50% (neutral)
    let prob = 0.5;

    for (const signal of signals) {
      // Each cluster adjusts probability
      // Larger clusters = stronger signal
      const strength = Math.min(signal.clusterSize / 10, 0.3);
      const direction = signal.dominantDirection?.includes("yes") || 
                       signal.dominantDirection?.includes("up") ? 1 : -1;
      
      // Bayesian update (simplified)
      if (direction > 0) {
        prob = prob + strength * (1 - prob);
      } else {
        prob = prob - strength * prob;
      }
    }

    // Convert to score (-1 to 1)
    const score = (prob - 0.5) * 2;
    
    // Confidence based on number of signals and cluster sizes
    const avgClusterSize = signals.reduce((s, x) => s + x.clusterSize, 0) / signals.length;
    const confidence = Math.min(0.9, 0.3 + avgClusterSize * 0.1 + signals.length * 0.1);

    return { score, confidence, prob };
  }

  /**
   * Main analysis for a market
   */
  async analyze(marketSlug) {
    console.log(`\n🔍 Insider Tracker: Scanning for early movers...`);

    // Check cache for recent signal
    const cached = this.cache.trackedMarkets[marketSlug];
    if (cached && Date.now() - cached.detectedAt < this.delayMinutes * 60 * 1000) {
      console.log(`   ⏳ Signal detected ${Math.round((Date.now() - cached.detectedAt) / 60000)}min ago, waiting...`);
      return {
        strategy: "creative:insider_tracker",
        score: 0,
        confidence: 0,
        recommendation: { action: "HOLD", reason: "Delayed entry - waiting" },
        reason: "Respecting delay period",
      };
    }

    // For now, analyze the specific market
    // In production, would scan fresh markets
    const activity = await this.fetchMarketActivity(marketSlug);
    const pattern = this.analyzeInsiderPatterns(activity, marketSlug);

    if (!pattern || !pattern.isCluster) {
      console.log(`   No insider cluster detected`);
      return {
        strategy: "creative:insider_tracker",
        score: 0,
        confidence: 0,
        recommendation: { action: "HOLD", reason: "No cluster detected" },
        reason: "No significant new wallet activity",
      };
    }

    // Cache the signal
    this.cache.trackedMarkets[marketSlug] = pattern;
    this.cache.signals.push(pattern);
    this.saveCache();

    // Aggregate with any other recent signals
    const recentSignals = this.cache.signals.filter(
      s => Date.now() - s.detectedAt < 60 * 60 * 1000 // Last hour
    );
    
    const { score, confidence } = this.bayesianAggregate(recentSignals);

    console.log(`   🎯 Insider cluster detected!`);
    console.log(`   Direction: ${pattern.dominantDirection}`);
    console.log(`   Wallets: ${pattern.clusterSize} new wallets`);
    console.log(`   Volume: $${pattern.totalVolume.toLocaleString()}`);

    return {
      strategy: "creative:insider_tracker",
      score,
      confidence,
      recommendation: this.getRecommendation(score, confidence),
      reason: `${pattern.clusterSize} new wallets betting ${pattern.dominantDirection} ($${(pattern.totalVolume/1000).toFixed(0)}k)`,
      pattern,
    };
  }

  getRecommendation(score, confidence) {
    if (confidence < 0.5) {
      return { action: "HOLD", reason: "Low confidence" };
    }
    if (score > 0.15) {
      return { action: "BUY_UP", reason: `Insider signal bullish (${(score*100).toFixed(0)}%)` };
    }
    if (score < -0.15) {
      return { action: "BUY_DOWN", reason: `Insider signal bearish (${(-score*100).toFixed(0)}%)` };
    }
    return { action: "HOLD", reason: "No clear insider direction" };
  }
}

module.exports = InsiderTracker;
