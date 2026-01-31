/**
 * Position Manager - Track positions with targets
 * 
 * Stores entry price, target, stop-loss for each position
 * Monitors and exits when targets are hit
 */

const fs = require("fs");
const path = require("path");
const { ClobClient } = require("@polymarket/clob-client");
const { Wallet } = require("ethers");
const config = require("./config");

const POSITIONS_FILE = path.join(__dirname, "../data/positions.json");

class PositionManager {
  constructor() {
    this.positions = this.loadPositions();
    this.client = null;
  }

  loadPositions() {
    try {
      if (fs.existsSync(POSITIONS_FILE)) {
        return JSON.parse(fs.readFileSync(POSITIONS_FILE, "utf8"));
      }
    } catch (e) {}
    return {};
  }

  savePositions() {
    const dir = path.dirname(POSITIONS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(POSITIONS_FILE, JSON.stringify(this.positions, null, 2));
  }

  /**
   * Record a new position with targets
   */
  addPosition(params) {
    const {
      market,
      side,           // "UP" or "DOWN"
      tokenId,
      entryPrice,
      size,           // number of shares
      costBasis,      // $ spent
      takeProfit,     // target price to exit (e.g., 0.75)
      stopLoss,       // price to cut losses (e.g., 0.45)
      orderId,
    } = params;

    const id = `${market}_${side}`;
    
    this.positions[id] = {
      market,
      side,
      tokenId,
      entryPrice,
      size,
      costBasis,
      takeProfit,
      stopLoss,
      orderId,
      entryTime: Date.now(),
      status: "open",
    };

    this.savePositions();
    
    console.log(`\n📝 Position recorded:`);
    console.log(`   ${side} @ ${(entryPrice * 100).toFixed(1)}%`);
    console.log(`   🎯 Take Profit: ${(takeProfit * 100).toFixed(1)}%`);
    console.log(`   🛑 Stop Loss: ${(stopLoss * 100).toFixed(1)}%`);
    
    return this.positions[id];
  }

  /**
   * Check all positions against current prices and exit if targets hit
   */
  async checkAndExit(currentPrices) {
    const exits = [];

    for (const [id, pos] of Object.entries(this.positions)) {
      if (pos.status !== "open") continue;

      const currentPrice = currentPrices[pos.side.toLowerCase()];
      if (!currentPrice) continue;

      let shouldExit = false;
      let reason = "";

      // Check take profit
      if (currentPrice >= pos.takeProfit) {
        shouldExit = true;
        reason = `🎯 TAKE PROFIT hit (${(currentPrice * 100).toFixed(1)}% >= ${(pos.takeProfit * 100).toFixed(1)}%)`;
      }
      // Check stop loss
      else if (currentPrice <= pos.stopLoss) {
        shouldExit = true;
        reason = `🛑 STOP LOSS hit (${(currentPrice * 100).toFixed(1)}% <= ${(pos.stopLoss * 100).toFixed(1)}%)`;
      }

      if (shouldExit) {
        console.log(`\n${reason}`);
        console.log(`   Position: ${pos.side} ${pos.size} shares`);
        
        const pnl = ((currentPrice - pos.entryPrice) / pos.entryPrice * 100).toFixed(1);
        console.log(`   P&L: ${pnl}%`);

        exits.push({
          position: pos,
          currentPrice,
          reason,
          pnl,
        });

        // Mark as pending exit
        pos.status = "exiting";
        pos.exitReason = reason;
        pos.exitPrice = currentPrice;
      }
    }

    this.savePositions();
    return exits;
  }

  /**
   * Execute exit orders
   */
  async executeExits(exits, client) {
    const results = [];

    for (const exit of exits) {
      const { position, currentPrice } = exit;

      try {
        console.log(`\n📤 Selling ${position.size} ${position.side} @ ${currentPrice}`);
        
        const order = await client.createAndPostOrder({
          tokenID: position.tokenId,
          side: "SELL",
          price: currentPrice,
          size: position.size,
        });

        if (order.success) {
          console.log(`✅ Exit order placed: ${order.orderID}`);
          position.status = "closed";
          position.exitOrderId = order.orderID;
          position.exitTime = Date.now();
          results.push({ success: true, order, position });
        } else {
          console.log(`❌ Exit failed: ${order.errorMsg}`);
          position.status = "open"; // Revert to open
          results.push({ success: false, error: order.errorMsg, position });
        }
      } catch (e) {
        console.error(`❌ Exit error: ${e.message}`);
        position.status = "open";
        results.push({ success: false, error: e.message, position });
      }
    }

    this.savePositions();
    return results;
  }

  /**
   * Get summary of all positions
   */
  getSummary() {
    const open = Object.values(this.positions).filter(p => p.status === "open");
    const closed = Object.values(this.positions).filter(p => p.status === "closed");

    return {
      open,
      closed,
      totalOpen: open.length,
      totalClosed: closed.length,
    };
  }

  /**
   * Clear closed positions
   */
  clearClosed() {
    for (const [id, pos] of Object.entries(this.positions)) {
      if (pos.status === "closed") {
        delete this.positions[id];
      }
    }
    this.savePositions();
  }
}

module.exports = PositionManager;
