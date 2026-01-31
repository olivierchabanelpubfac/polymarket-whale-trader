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
  console.log(`Wallet: ${wallet.address}`);
  
  const tempClient = new ClobClient(HOST, CHAIN_ID, wallet);
  const apiCreds = await tempClient.createOrDeriveApiKey();
  const client = new ClobClient(HOST, CHAIN_ID, wallet, apiCreds, 0, wallet.address);
  
  // UP token ID for Jan 31 market
  const UP_TOKEN = "104654371106328340370851190866138578890372380489856819236186101949732258611553";
  
  // Get current UP price
  const resp = await fetch("https://gamma-api.polymarket.com/events?slug=bitcoin-up-or-down-on-january-31");
  const events = await resp.json();
  const market = events[0].markets[0];
  const prices = JSON.parse(market.outcomePrices);
  const upPrice = parseFloat(prices[0]);
  
  console.log(`\n📊 Current UP price: ${(upPrice * 100).toFixed(1)}%`);
  console.log(`📦 Selling 83 UP shares @ ${upPrice}`);
  
  // Place SELL order
  const order = await client.createAndPostOrder({
    tokenID: UP_TOKEN,
    side: "SELL",
    price: upPrice,
    size: 83,
  });
  
  console.log(`\n✅ Sell order placed:`, JSON.stringify(order, null, 2));
}

main().catch(e => console.error("Error:", e.message));
