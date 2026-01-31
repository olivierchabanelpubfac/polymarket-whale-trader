#!/usr/bin/env node
/**
 * Polymarket Whale Trader - Entry Point
 * 
 * Usage:
 *   node src/index.js          - Run trading cycle
 *   node src/index.js scan     - Scan signals only (no trading)
 *   node src/index.js trade    - Force trade cycle
 *   node src/index.js perf     - Show performance comparison
 *   node src/index.js close    - Close market and calculate results
 */

const WhaleTrader = require("./trader");
const PaperTrader = require("./paper-trader");

async function main() {
  const command = process.argv[2] || "trade";

  // Commands that don't need full initialization
  if (command === "perf") {
    const paper = new PaperTrader();
    paper.showPerformance();
    return;
  }

  const trader = new WhaleTrader();

  try {
    await trader.initialize();

    switch (command) {
      case "scan":
        await trader.scanOnly();
        break;

      case "close":
        // Close market with outcome
        const outcome = process.argv[3]?.toUpperCase(); // "UP" or "DOWN"
        if (!outcome || !["UP", "DOWN"].includes(outcome)) {
          console.log("Usage: node src/index.js close UP|DOWN");
          return;
        }
        const market = process.argv[4] || "bitcoin-up-or-down-on-january-31";
        trader.paper.closeMarket(market, outcome, {});
        trader.paper.showPerformance();
        break;

      case "trade":
      default:
        const result = await trader.runFullCycle();
        
        if (result?.order?.success) {
          console.log("\n🎉 Trade executed successfully!");
        }
        if (result?.exits?.length > 0) {
          console.log("\n🚪 Position(s) exited!");
        }
        break;
    }
  } catch (e) {
    console.error("\n❌ Error:", e.message);
    process.exit(1);
  }
}

main();
