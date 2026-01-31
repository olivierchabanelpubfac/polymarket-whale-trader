#!/usr/bin/env node
/**
 * Polymarket Whale Trader - Entry Point
 * 
 * Usage:
 *   node src/index.js          - Run trading cycle
 *   node src/index.js scan     - Scan signals only (no trading)
 *   node src/index.js trade    - Force trade cycle
 *   node src/index.js compete  - Run strategy competition (arena mode)
 *   node src/index.js arena    - Show arena status
 *   node src/index.js perf     - Show performance comparison
 *   node src/index.js close    - Close market and calculate results
 */

const WhaleTrader = require("./trader");
const PaperTrader = require("./paper-trader");
const StrategyArena = require("./arena");

async function main() {
  const command = process.argv[2] || "trade";

  // Commands that don't need full initialization
  if (command === "perf") {
    const paper = new PaperTrader();
    paper.showPerformance();
    return;
  }

  if (command === "arena") {
    const arena = new StrategyArena();
    arena.showStatus();
    return;
  }

  const trader = new WhaleTrader();

  try {
    await trader.initialize();

    switch (command) {
      case "scan":
        await trader.scanOnly();
        break;

      case "close": {
        // Close market with outcome
        const outcome = process.argv[3]?.toUpperCase(); // "UP" or "DOWN"
        if (!outcome || !["UP", "DOWN"].includes(outcome)) {
          console.log("Usage: node src/index.js close UP|DOWN");
          return;
        }
        const closeMarketSlug = process.argv[4] || "bitcoin-up-or-down-on-january-31";
        trader.paper.closeMarket(closeMarketSlug, outcome, {});
        trader.paper.showPerformance();
        break;
      }

      case "compete": {
        // Mode compétition: toutes les stratégies en compétition
        const arena = new StrategyArena();
        const competeMarketSlug = process.argv[3] || "bitcoin-up-or-down-on-january-31";
        const competeMarket = await trader.getMarket(competeMarketSlug);
        
        if (!competeMarket) {
          console.log("❌ No active market found");
          return;
        }
        
        await arena.runCompetition(competeMarketSlug, competeMarket, trader);
        break;
      }

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
