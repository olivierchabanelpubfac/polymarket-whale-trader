const { ClobClient } = require("@polymarket/clob-client");
const { Wallet } = require("ethers");
const fs = require("fs");
const path = require("path");

const HOST = "https://clob.polymarket.com";
const CHAIN_ID = 137;

function loadPrivateKey() {
  const secretsPath = path.join(process.env.HOME, ".config/clawd/secrets.env");
  const content = fs.readFileSync(secretsPath, "utf8");
  const match = content.match(/POLYMARKET_PRIVATE_KEY="?(0x[a-fA-F0-9]+)"?/);
  return match[1];
}

async function main() {
  const wallet = new Wallet(loadPrivateKey());
  console.log(`Wallet: ${wallet.address}\n`);
  
  const tempClient = new ClobClient(HOST, CHAIN_ID, wallet);
  const apiCreds = await tempClient.createOrDeriveApiKey();
  const client = new ClobClient(HOST, CHAIN_ID, wallet, apiCreds, 0, wallet.address);
  
  // Get current positions
  const resp = await fetch(`https://data-api.polymarket.com/positions?user=${wallet.address}`);
  const positions = await resp.json();
  
  // Find DOWN position
  const downPos = positions.find(p => 
    p.outcome?.toLowerCase() === "down" && 
    p.currentValue > 0
  );
  
  if (!downPos) {
    console.log("❌ No DOWN position found");
    
    // Check open orders
    const orders = await client.getOpenOrders();
    console.log(`\n📋 Open orders: ${orders?.length || 0}`);
    for (const o of (orders || [])) {
      console.log(`   ${o.side} ${o.original_size} @ ${o.price}`);
    }
    return;
  }
  
  console.log(`📊 DOWN Position found:`);
  console.log(`   Shares: ${downPos.size}`);
  console.log(`   Value: $${downPos.currentValue.toFixed(2)}`);
  console.log(`   Current price: ${(downPos.curPrice * 100).toFixed(1)}%`);
  
  // DOWN token for Jan 31
  const DOWN_TOKEN = "51320713513210947924498084352927832634689106458328255635947801346339223679051";
  
  // Sell at current price
  console.log(`\n📤 Selling ${downPos.size} DOWN @ ${downPos.curPrice}`);
  
  const order = await client.createAndPostOrder({
    tokenID: DOWN_TOKEN,
    side: "SELL",
    price: downPos.curPrice,
    size: Math.floor(downPos.size),
  });
  
  console.log(`\n✅ Sell order:`, JSON.stringify(order, null, 2));
}

main().catch(e => console.error("Error:", e.message));
