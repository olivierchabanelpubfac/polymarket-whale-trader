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
  
  console.log("═".repeat(50));
  console.log("📊 ÉTAT COMPLET DU PORTEFEUILLE");
  console.log("═".repeat(50));
  
  // Positions
  console.log("\n🎯 POSITIONS ACTUELLES:");
  const resp = await fetch(`https://data-api.polymarket.com/positions?user=${wallet.address}`);
  const positions = await resp.json();
  
  let totalValue = 0;
  for (const p of positions) {
    if (p.currentValue > 0) {
      console.log(`   ${p.outcome}: ${p.size} shares @ ${(p.curPrice*100).toFixed(1)}%`);
      console.log(`      Valeur: $${p.currentValue.toFixed(2)} | P&L: ${p.percentPnl?.toFixed(1) || '?'}%`);
      totalValue += p.currentValue;
    }
  }
  if (totalValue === 0) console.log("   (aucune position)");
  
  // Open orders
  console.log("\n📋 ORDRES EN ATTENTE:");
  const orders = await client.getOpenOrders();
  
  if (!orders || orders.length === 0) {
    console.log("   (aucun ordre)");
  } else {
    for (const o of orders) {
      const filled = o.size_matched || 0;
      const remaining = o.original_size - filled;
      console.log(`   ${o.side} ${o.original_size} @ ${(parseFloat(o.price)*100).toFixed(1)}%`);
      console.log(`      Rempli: ${filled}/${o.original_size}`);
    }
  }
  
  // USDC Balance
  console.log("\n💰 USDC DISPONIBLE:");
  const { ethers } = require("ethers");
  const provider = new ethers.providers.JsonRpcProvider("https://polygon-rpc.com");
  const USDC = new ethers.Contract(
    "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
    ["function balanceOf(address) view returns (uint256)"],
    provider
  );
  const balance = await USDC.balanceOf(wallet.address);
  console.log(`   $${ethers.utils.formatUnits(balance, 6)} USDC.e`);
  
  console.log("\n" + "═".repeat(50));
}

main().catch(e => console.error("Error:", e.message));
