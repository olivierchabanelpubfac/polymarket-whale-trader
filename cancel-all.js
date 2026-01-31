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
  
  const tempClient = new ClobClient(HOST, CHAIN_ID, wallet);
  const apiCreds = await tempClient.createOrDeriveApiKey();
  const client = new ClobClient(HOST, CHAIN_ID, wallet, apiCreds, 0, wallet.address);
  
  console.log("🗑️ Annulation de tous les ordres...\n");
  
  const orders = await client.getOpenOrders();
  
  if (!orders || orders.length === 0) {
    console.log("Aucun ordre à annuler");
    return;
  }
  
  for (const order of orders) {
    try {
      console.log(`Annulation: ${order.side} @ ${order.price}...`);
      await client.cancelOrder({ orderID: order.id });
      console.log(`✅ Annulé`);
    } catch (e) {
      console.log(`❌ Erreur: ${e.message}`);
    }
  }
  
  console.log("\n✅ Tous les ordres annulés");
}

main().catch(e => console.error("Error:", e.message));
