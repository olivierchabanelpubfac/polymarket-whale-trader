#!/usr/bin/env node
/**
 * STRATEGY LAB
 * 
 * Compare baseline vs creative strategies in real-time.
 * Logs predictions to track performance over time.
 */

const fs = require("fs");
const path = require("path");
const BaselineStrategy = require("./strategies/baseline");
const CreativeStrategy = require("./strategies/creative");
const config = require("./config");

console.log(`🤖 Whale Trader v${config.VERSION}`);

const RESULTS_FILE = path.join(__dirname, "../data/strategy-results.json");

class StrategyLab {
  constructor() {
    this.baseline = new BaselineStrategy();
    this.creative = new CreativeStrategy();
    this.results = this.loadResults();
  }

  loadResults() {
    try {
      if (fs.existsSync(RESULTS_FILE)) {
        return JSON.parse(fs.readFileSync(RESULTS_FILE, "utf8"));
      }
    } catch (e) {}
    return { predictions: [], summary: {} };
  }

  saveResults() {
    const dir = path.dirname(RESULTS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(RESULTS_FILE, JSON.stringify(this.results, null, 2));
  }

  async fetchMarketData(marketSlug) {
    try {
      const resp = await fetch(
        `${config.GAMMA_HOST}/events?slug=${marketSlug}`
      );
      const events = await resp.json();
      if (!events?.length) return null;
      
      const event = events[0];
      const market = event.markets[0];
      const prices = JSON.parse(market.outcomePrices);
      
      return {
        title: event.title,
        slug: event.slug,
        endDate: event.endDate,
        upPrice: parseFloat(prices[0]),
        downPrice: parseFloat(prices[1]),
        liquidity: event.liquidity,
      };
    } catch (e) {
      console.error("Failed to fetch market:", e.message);
      return null;
    }
  }

  async runComparison(marketSlug = "democratic-presidential-nominee-2028") {
    console.log("\n" + "═".repeat(60));
    console.log("🔬 STRATEGY LAB - Comparison");
    console.log("═".repeat(60));

    const market = await this.fetchMarketData(marketSlug);
    if (!market) {
      console.log("❌ No market data");
      return null;
    }

    console.log(`\n📊 ${market.title}`);
    console.log(`   UP: ${(market.upPrice * 100).toFixed(1)}% | DOWN: ${(market.downPrice * 100).toFixed(1)}%`);

    // Run baseline
    console.log("\n" + "─".repeat(60));
    console.log("📘 BASELINE STRATEGY");
    const baselineResult = await this.baseline.analyze(marketSlug);
    this.printResult(baselineResult);

    // Run creative
    console.log("\n" + "─".repeat(60));
    console.log("🎨 CREATIVE STRATEGY");
    const creativeResult = await this.creative.analyze(
      marketSlug,
      market,
      baselineResult.signals
    );
    this.printResult(creativeResult);

    // Compare
    console.log("\n" + "─".repeat(60));
    console.log("⚖️ COMPARISON");
    
    const agree = this.signsMatch(baselineResult.score, creativeResult.score);
    console.log(`   Agreement: ${agree ? "✅ SAME DIRECTION" : "❌ DISAGREE"}`);
    console.log(`   Baseline: ${(baselineResult.score * 100).toFixed(1)}% → ${baselineResult.recommendation.action}`);
    console.log(`   Creative: ${(creativeResult.score * 100).toFixed(1)}% → ${creativeResult.recommendation.action}`);
    
    if (!agree) {
      console.log(`\n   🤔 Strategies disagree!`);
      console.log(`   Creative reason: ${creativeResult.reason}`);
    }

    // Log prediction
    const prediction = {
      timestamp: Date.now(),
      version: config.VERSION,
      market: marketSlug,
      marketState: {
        upPrice: market.upPrice,
        downPrice: market.downPrice,
      },
      baseline: {
        score: baselineResult.score,
        action: baselineResult.recommendation.action,
      },
      creative: {
        variant: creativeResult.strategy,
        score: creativeResult.score,
        action: creativeResult.recommendation.action,
        reason: creativeResult.reason,
      },
      agreement: agree,
    };

    this.results.predictions.push(prediction);
    this.saveResults();

    console.log("\n" + "═".repeat(60));
    
    return { baseline: baselineResult, creative: creativeResult, agreement: agree };
  }

  signsMatch(a, b) {
    if (Math.abs(a) < 0.1 && Math.abs(b) < 0.1) return true; // Both HOLD
    return (a > 0) === (b > 0);
  }

  printResult(result) {
    console.log(`   Score: ${(result.score * 100).toFixed(1)}%`);
    console.log(`   Confidence: ${(result.confidence * 100).toFixed(0)}%`);
    console.log(`   Action: ${result.recommendation.action}`);
    if (result.reason) console.log(`   Reason: ${result.reason}`);
  }

  showHistory() {
    console.log("\n" + "═".repeat(60));
    console.log("📊 PREDICTION HISTORY");
    console.log("═".repeat(60));

    const recent = this.results.predictions.slice(-10);
    
    for (const p of recent) {
      const time = new Date(p.timestamp).toLocaleTimeString();
      const agree = p.agreement ? "✅" : "❌";
      console.log(`\n${time} ${agree}`);
      console.log(`   Market: UP ${(p.marketState.upPrice*100).toFixed(0)}% / DOWN ${(p.marketState.downPrice*100).toFixed(0)}%`);
      console.log(`   Baseline: ${p.baseline.action} (${(p.baseline.score*100).toFixed(0)}%)`);
      console.log(`   Creative [${p.creative.variant}]: ${p.creative.action} (${(p.creative.score*100).toFixed(0)}%)`);
    }

    // Summary
    const total = this.results.predictions.length;
    const agreements = this.results.predictions.filter(p => p.agreement).length;
    console.log(`\n📈 Agreement rate: ${agreements}/${total} (${(agreements/total*100).toFixed(0)}%)`);
  }
}

// Main
async function main() {
  const lab = new StrategyLab();
  const cmd = process.argv[2] || "compare";

  switch (cmd) {
    case "compare":
      await lab.runComparison();
      break;
    case "history":
      lab.showHistory();
      break;
    default:
      console.log("Usage: node strategy-lab.js [compare|history]");
  }
}

main().catch(console.error);
