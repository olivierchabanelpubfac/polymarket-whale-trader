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
  
  // Get open orders
  console.log("\n📋 Fetching open orders...\n");
  const orders = await client.getOpenOrders();
  
  if (!orders || orders.length === 0) {
    console.log("No open orders found");
    return;
  }
  
  console.log(`Found ${orders.length} open order(s):\n`);
  for (const order of orders) {
    console.log(`  ID: ${order.id}`);
    console.log(`  Side: ${order.side}`);
    console.log(`  Price: ${order.price}`);
    console.log(`  Size: ${order.original_size}`);
    console.log(`  Filled: ${order.size_matched || 0}`);
    console.log("");
  }
  
  // Cancel all
  if (process.argv[2] === "cancel") {
    console.log("🗑️ Cancelling all orders...\n");
    for (const order of orders) {
      try {
        const result = await client.cancelOrder({ orderID: order.id });
        console.log(`Cancelled ${order.id}: ${JSON.stringify(result)}`);
      } catch (e) {
        console.log(`Failed to cancel ${order.id}: ${e.message}`);
      }
    }
  }
}

main().catch(console.error);
