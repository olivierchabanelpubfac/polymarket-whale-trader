/**
 * Whale-Enhanced Polymarket Trader
 */

const { ClobClient } = require("@polymarket/clob-client");
const { Wallet } = require("ethers");
const fs = require("fs");
const path = require("path");
const config = require("./config");
const SignalAggregator = require("./signals");
const PositionManager = require("./position-manager");

class WhaleTrader {
  constructor() {
    this.privateKey = this.loadPrivateKey();
    this.wallet = new Wallet(this.privateKey);
    this.client = null;
    this.signals = new SignalAggregator();
    this.positions = new PositionManager();
  }

  loadPrivateKey() {
    const secretsPath = path.join(process.env.HOME, ".config/clawd/secrets.env");
    const content = fs.readFileSync(secretsPath, "utf8");
    const match = content.match(/POLYMARKET_PRIVATE_KEY="?(0x[a-fA-F0-9]+)"?/);
    if (!match) throw new Error("No private key found in secrets.env");
    return match[1];
  }

  async initialize() {
    console.log(`🐋 Whale Trader v1.0`);
    console.log(`💼 Wallet: ${this.wallet.address}`);
    
    const tempClient = new ClobClient(config.CLOB_HOST, config.CHAIN_ID, this.wallet);
    const apiCreds = await tempClient.createOrDeriveApiKey();
    
    this.client = new ClobClient(
      config.CLOB_HOST,
      config.CHAIN_ID,
      this.wallet,
      apiCreds,
      0,
      this.wallet.address
    );
    
    console.log("✅ Connected to Polymarket CLOB\n");
    return true;
  }

  async getMarket(slug) {
    try {
      const resp = await fetch(`${config.GAMMA_HOST}/events?slug=${slug}`);
      const events = await resp.json();
      
      if (!events?.length) return null;
      
      const event = events[0];
      const market = event.markets[0];
      
      const prices = JSON.parse(market.outcomePrices);
      const tokens = JSON.parse(market.clobTokenIds);
      
      return {
        title: event.title,
        slug: event.slug,
        endDate: event.endDate,
        upPrice: parseFloat(prices[0]),
        downPrice: parseFloat(prices[1]),
        upToken: tokens[0],
        downToken: tokens[1],
        liquidity: event.liquidity,
        volume: event.volume,
      };
    } catch (e) {
      console.error(`Failed to fetch market: ${e.message}`);
      return null;
    }
  }

  calculatePositionSize(edge, confidence, bankroll) {
    // Kelly Criterion: f* = (bp - q) / b
    // where b = odds, p = probability of winning, q = 1-p
    
    // Estimate win probability from edge
    const winProb = 0.5 + edge / 2;
    const loseProb = 1 - winProb;
    
    // Simplified odds (assuming fair-ish market)
    const odds = 1;
    
    const kellyFraction = (odds * winProb - loseProb) / odds;
    
    // Apply safety factor and cap
    let betFraction = kellyFraction * config.KELLY_FRACTION * confidence;
    betFraction = Math.max(0, Math.min(betFraction, config.MAX_KELLY_BET));
    
    const betSize = bankroll * betFraction;
    
    // Cap at max position size
    return Math.min(betSize, config.MAX_POSITION_SIZE);
  }

  async placeOrder(tokenId, side, price, size, marketSlug) {
    try {
      console.log(`\n📝 Placing order: ${side} $${size.toFixed(2)} @ ${price}`);
      
      const shares = Math.floor(size / price);
      const order = await this.client.createAndPostOrder({
        tokenID: tokenId,
        side: "BUY",
        price: price,
        size: shares,
      });
      
      if (order.success) {
        console.log(`✅ Order placed! ID: ${order.orderID}`);
        
        // Calculate targets
        const takeProfit = config.TAKE_PROFIT_PRICE || price * (1 + config.TAKE_PROFIT_PCT);
        const stopLoss = config.STOP_LOSS_PRICE || price * (1 - config.STOP_LOSS_PCT);
        
        // Record position with targets
        this.positions.addPosition({
          market: marketSlug,
          side,
          tokenId,
          entryPrice: price,
          size: shares,
          costBasis: size,
          takeProfit,
          stopLoss,
          orderId: order.orderID,
        });
        
        return order;
      } else {
        console.log(`❌ Order failed: ${order.errorMsg || JSON.stringify(order)}`);
        return null;
      }
    } catch (e) {
      console.error(`❌ Order error: ${e.message}`);
      return null;
    }
  }

  /**
   * Check positions and exit if targets hit
   */
  async monitorPositions(market) {
    const currentPrices = {
      up: market.upPrice,
      down: market.downPrice,
    };

    console.log("\n👀 Checking position targets...");
    
    const exits = await this.positions.checkAndExit(currentPrices);
    
    if (exits.length > 0) {
      const results = await this.positions.executeExits(exits, this.client);
      return results;
    }
    
    // Show open positions status
    const summary = this.positions.getSummary();
    if (summary.totalOpen > 0) {
      console.log(`\n📊 Open positions: ${summary.totalOpen}`);
      for (const pos of summary.open) {
        const current = currentPrices[pos.side.toLowerCase()];
        const pnl = ((current - pos.entryPrice) / pos.entryPrice * 100).toFixed(1);
        const toTP = ((pos.takeProfit - current) / current * 100).toFixed(1);
        console.log(`   ${pos.side}: entry ${(pos.entryPrice*100).toFixed(1)}% → now ${(current*100).toFixed(1)}% (${pnl}%)`);
        console.log(`      🎯 TP: ${(pos.takeProfit*100).toFixed(1)}% (${toTP}% away) | 🛑 SL: ${(pos.stopLoss*100).toFixed(1)}%`);
      }
    }
    
    return [];
  }

  formatSignalReport(analysis) {
    const { signals, finalScore, finalConfidence, recommendation } = analysis;
    
    let report = "\n" + "═".repeat(60) + "\n";
    report += "📊 SIGNAL ANALYSIS\n";
    report += "═".repeat(60) + "\n\n";

    // Whale consensus
    report += `🐋 WHALE CONSENSUS (${(config.WEIGHTS.WHALE_CONSENSUS * 100)}%)\n`;
    report += `   Score: ${(signals.whale.score * 100).toFixed(1)}%\n`;
    report += `   Confidence: ${(signals.whale.confidence * 100).toFixed(0)}%\n`;
    report += `   Details: ${signals.whale.details}\n\n`;

    // Momentum
    report += `📈 MOMENTUM (${(config.WEIGHTS.MOMENTUM * 100)}%)\n`;
    report += `   Score: ${(signals.momentum.score * 100).toFixed(1)}%\n`;
    report += `   5m: ${signals.momentum.m5} | 15m: ${signals.momentum.m15}\n`;
    report += `   1h: ${signals.momentum.m60} | 4h: ${signals.momentum.m240}\n\n`;

    // Technicals
    report += `📉 TECHNICALS (${(config.WEIGHTS.TECHNICALS * 100)}%)\n`;
    report += `   Score: ${(signals.technicals.score * 100).toFixed(1)}%\n`;
    report += `   ${signals.technicals.details}\n\n`;

    // Sentiment
    report += `😱 SENTIMENT (${(config.WEIGHTS.SENTIMENT * 100)}%)\n`;
    report += `   Score: ${(signals.sentiment.score * 100).toFixed(1)}%\n`;
    report += `   ${signals.sentiment.details}\n\n`;

    // Final
    report += "─".repeat(60) + "\n";
    report += `🎯 FINAL SCORE: ${(finalScore * 100).toFixed(1)}%\n`;
    report += `📊 CONFIDENCE: ${(finalConfidence * 100).toFixed(0)}%\n`;
    report += `💡 RECOMMENDATION: ${recommendation.action}\n`;
    report += `   Reason: ${recommendation.reason}\n`;
    report += "═".repeat(60) + "\n";

    return report;
  }

  async runTradingCycle(marketSlug = "bitcoin-up-or-down-on-january-31") {
    console.log("\n" + "═".repeat(60));
    console.log(`🕐 Trading Cycle - ${new Date().toLocaleTimeString()}`);
    console.log("═".repeat(60));

    // Get market info
    const market = await this.getMarket(marketSlug);
    if (!market) {
      console.log("❌ No active market found");
      return null;
    }

    console.log(`\n📊 ${market.title}`);
    console.log(`   UP: ${(market.upPrice * 100).toFixed(1)}% | DOWN: ${(market.downPrice * 100).toFixed(1)}%`);
    console.log(`   Liquidity: $${market.liquidity?.toLocaleString()}`);

    // Get all signals
    const analysis = await this.signals.getAllSignals("bitcoin");
    console.log(this.formatSignalReport(analysis));

    const { recommendation, finalScore, finalConfidence } = analysis;

    // Execute trade if recommended
    if (recommendation.action === "HOLD") {
      console.log("⏸️ No trade - holding position");
      return { action: "HOLD", reason: recommendation.reason };
    }

    // Calculate edge based on our score vs market price
    const isUp = recommendation.action === "BUY_UP";
    const marketPrice = isUp ? market.upPrice : market.downPrice;
    const ourEstimate = isUp ? (0.5 + finalScore / 2) : (0.5 - finalScore / 2);
    const edge = ourEstimate - marketPrice;

    console.log(`\n🎯 Trade Setup:`);
    console.log(`   Side: ${isUp ? "UP" : "DOWN"}`);
    console.log(`   Market Price: ${(marketPrice * 100).toFixed(1)}%`);
    console.log(`   Our Estimate: ${(ourEstimate * 100).toFixed(1)}%`);
    console.log(`   Edge: ${(edge * 100).toFixed(1)}%`);

    if (edge < config.MIN_EDGE) {
      console.log(`\n⏸️ Edge too small (${(edge * 100).toFixed(1)}% < ${(config.MIN_EDGE * 100)}%)`);
      return { action: "HOLD", reason: "Insufficient edge vs market" };
    }

    // Calculate position size (assume $340 bankroll for now)
    const bankroll = 340;
    const positionSize = this.calculatePositionSize(edge, finalConfidence, bankroll);

    console.log(`   Position Size: $${positionSize.toFixed(2)} (Kelly-adjusted)`);

    // Place order
    const tokenId = isUp ? market.upToken : market.downToken;
    const order = await this.placeOrder(tokenId, isUp ? "UP" : "DOWN", marketPrice, positionSize, marketSlug);

    return {
      action: recommendation.action,
      order,
      edge,
      size: positionSize,
      market: market.title,
    };
  }

  /**
   * Full cycle: check exits first, then look for new entries
   */
  async runFullCycle(marketSlug = "bitcoin-up-or-down-on-january-31") {
    console.log("\n" + "═".repeat(60));
    console.log(`🕐 Full Trading Cycle - ${new Date().toLocaleTimeString()}`);
    console.log("═".repeat(60));

    // Get market info
    const market = await this.getMarket(marketSlug);
    if (!market) {
      console.log("❌ No active market found");
      return null;
    }

    console.log(`\n📊 ${market.title}`);
    console.log(`   UP: ${(market.upPrice * 100).toFixed(1)}% | DOWN: ${(market.downPrice * 100).toFixed(1)}%`);

    // FIRST: Check if any positions need to exit
    const exitResults = await this.monitorPositions(market);
    
    if (exitResults.length > 0) {
      console.log(`\n🚪 Exited ${exitResults.length} position(s)`);
      return { action: "EXIT", exits: exitResults };
    }

    // THEN: Look for new trades
    return this.runTradingCycle(marketSlug);
  }

  async scanOnly() {
    console.log("\n🔍 Signal Scan Mode (no trading)\n");
    
    const analysis = await this.signals.getAllSignals("bitcoin");
    console.log(this.formatSignalReport(analysis));
    
    return analysis;
  }
}

module.exports = WhaleTrader;
