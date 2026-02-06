/**
 * Profit Target Optimizer
 * Analyzes historical trades to suggest optimal TP per strategy
 */

const fs = require('fs');
const path = require('path');

const TRADES_PATH = path.join(__dirname, '../../data/paper-trades.json');

function loadTrades() {
  const data = JSON.parse(fs.readFileSync(TRADES_PATH, 'utf8'));
  return data.trades.filter(t => t.status === 'closed' && t.outcome);
}

function analyzeByStrategy(trades) {
  const stats = {};
  
  for (const trade of trades) {
    const strat = trade.strategy;
    if (!stats[strat]) {
      stats[strat] = {
        trades: 0,
        wins: 0,
        losses: 0,
        totalPnl: 0,
        avgEntryPrice: 0,
        avgConfidence: 0,
        totalSize: 0,
        winPnls: [],
        lossPnls: [],
      };
    }
    
    stats[strat].trades++;
    stats[strat].totalPnl += trade.pnl || 0;
    stats[strat].avgEntryPrice += trade.entryPrice;
    stats[strat].avgConfidence += trade.confidence || 0;
    stats[strat].totalSize += trade.size;
    
    if (trade.outcome === 'WIN') {
      stats[strat].wins++;
      stats[strat].winPnls.push(trade.pnl);
    } else {
      stats[strat].losses++;
      stats[strat].lossPnls.push(trade.pnl);
    }
  }
  
  // Calculate averages and metrics
  for (const strat of Object.keys(stats)) {
    const s = stats[strat];
    s.winRate = s.trades > 0 ? (s.wins / s.trades) : 0;
    s.avgEntryPrice /= s.trades;
    s.avgConfidence /= s.trades;
    s.avgTradeSize = s.totalSize / s.trades;
    s.avgWinPnl = s.winPnls.length > 0 ? s.winPnls.reduce((a,b) => a+b, 0) / s.winPnls.length : 0;
    s.avgLossPnl = s.lossPnls.length > 0 ? s.lossPnls.reduce((a,b) => a+b, 0) / s.lossPnls.length : 0;
    
    // Calculate suggested TP based on win rate and avg win size
    // Higher win rate → can use tighter TP (secure gains faster)
    // Lower win rate → need wider TP (let winners run)
    if (s.winRate >= 0.7) {
      s.suggestedTP = 0.08; // 8% - high WR, take profits quick
    } else if (s.winRate >= 0.5) {
      s.suggestedTP = 0.12; // 12% - medium WR
    } else if (s.winRate >= 0.3) {
      s.suggestedTP = 0.18; // 18% - low WR, let winners run
    } else {
      s.suggestedTP = 0.25; // 25% - very low WR, need big wins
    }
    
    // Adjust based on avg entry price (extreme prices need different handling)
    if (s.avgEntryPrice < 0.15 || s.avgEntryPrice > 0.85) {
      s.suggestedTP *= 1.5; // Wider TP for extreme odds positions
    }
  }
  
  return stats;
}

function suggestTPConfig(stats) {
  const config = {};
  
  for (const [strat, s] of Object.entries(stats)) {
    config[strat] = {
      profitTarget: s.suggestedTP,
      stopLoss: Math.min(0.30, s.suggestedTP * 2), // SL = 2x TP
      rationale: `WR ${(s.winRate*100).toFixed(0)}%, ${s.trades} trades, avgEntry ${(s.avgEntryPrice*100).toFixed(0)}%`
    };
  }
  
  // Manual overrides based on strategy characteristics
  const overrides = {
    momentum_pure: { profitTarget: 0.08, rationale: 'Quick scalps, take profits fast' },
    whale_copy: { profitTarget: 0.20, rationale: 'High confidence, let winners run' },
    contrarian: { profitTarget: 0.25, rationale: 'Counter-trend, needs big wins' },
    mean_reversion: { profitTarget: 0.15, rationale: 'Reversion plays, medium target' },
    volatility_breakout: { profitTarget: 0.12, rationale: 'Breakouts, capture momentum' },
    time_decay: { profitTarget: 0.15, rationale: 'Time-based, standard target' },
    baseline: { profitTarget: 0.15, rationale: 'Default strategy' },
  };
  
  // Merge overrides
  for (const [strat, override] of Object.entries(overrides)) {
    if (config[strat]) {
      config[strat].profitTarget = override.profitTarget;
      config[strat].rationale = override.rationale;
      config[strat].stopLoss = Math.min(0.30, override.profitTarget * 2);
    } else {
      config[strat] = {
        profitTarget: override.profitTarget,
        stopLoss: Math.min(0.30, override.profitTarget * 2),
        rationale: override.rationale
      };
    }
  }
  
  return config;
}

function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('📊 PROFIT TARGET OPTIMIZER');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  const trades = loadTrades();
  console.log(`Analyzing ${trades.length} closed trades...\n`);
  
  const stats = analyzeByStrategy(trades);
  
  console.log('Strategy Performance:\n');
  console.log('Strategy            | Trades | Win%  | Avg PnL | Suggested TP');
  console.log('────────────────────|────────|───────|─────────|─────────────');
  
  for (const [strat, s] of Object.entries(stats).sort((a,b) => b[1].winRate - a[1].winRate)) {
    const avgPnl = s.totalPnl / s.trades;
    console.log(
      `${strat.padEnd(20)}| ${String(s.trades).padStart(6)} | ${(s.winRate*100).toFixed(0).padStart(4)}% | ${avgPnl >= 0 ? '+' : ''}${avgPnl.toFixed(2).padStart(6)} | ${(s.suggestedTP*100).toFixed(0)}%`
    );
  }
  
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('📋 RECOMMENDED TP CONFIG');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  const config = suggestTPConfig(stats);
  
  console.log('// Add to each strategy file or config.js:\n');
  console.log('const STRATEGY_TARGETS = {');
  for (const [strat, c] of Object.entries(config)) {
    console.log(`  ${strat}: {`);
    console.log(`    profitTarget: ${c.profitTarget}, // ${(c.profitTarget*100).toFixed(0)}%`);
    console.log(`    stopLoss: ${c.stopLoss},    // ${(c.stopLoss*100).toFixed(0)}%`);
    console.log(`    // ${c.rationale}`);
    console.log('  },');
  }
  console.log('};');
  
  // Save config to file
  const configPath = path.join(__dirname, '../../data/strategy-targets.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log(`\n✅ Config saved to ${configPath}`);
}

main();
