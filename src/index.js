#!/usr/bin/env node
/**
 * Polymarket Whale Trader - Entry Point
 * 
 * Usage:
 *   node src/index.js          - Run trading cycle
 *   node src/index.js scan     - Scan signals only (no trading)
 *   node src/index.js trade    - Force trade cycle
 */

const WhaleTrader = require("./trader");

async function main() {
  const command = process.argv[2] || "trade";
  const trader = new WhaleTrader();

  try {
    await trader.initialize();

    switch (command) {
      case "scan":
        await trader.scanOnly();
        break;

      case "trade":
      default:
        const result = await trader.runTradingCycle();
        
        if (result?.order?.success) {
          console.log("\n🎉 Trade executed successfully!");
          // Could send notification here
        }
        break;
    }
  } catch (e) {
    console.error("\n❌ Error:", e.message);
    process.exit(1);
  }
}

main();
