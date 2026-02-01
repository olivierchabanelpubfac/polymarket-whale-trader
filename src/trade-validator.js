/**
 * TRADE VALIDATOR
 * 
 * Gate tous les trades avant exécution.
 * Vérifie que le trade a un edge positif et vaut le coup.
 */

const config = require("./config");

// Seuils configurables
const THRESHOLDS = {
  MIN_PRICE: 0.05,       // Skip si prix < 5%
  MAX_PRICE: 0.95,       // Skip si prix > 95%
  MIN_EDGE: 0.03,        // Edge minimum 3% entre signal et prix
  MIN_TIME_HOURS: 1,     // Minimum 1h avant expiration
  MAX_SPREAD: 0.05,      // Spread max 5%
};

/**
 * Valide un trade avant exécution
 * @param {Object} trade - {action, score, confidence}
 * @param {Object} market - {upPrice, downPrice, expiresAt, spread?}
 * @returns {Object} {valid, checks, reason}
 */
function validate(trade, market) {
  const action = trade.recommendation?.action || trade.action;
  const score = Math.abs(trade.score || 0);
  
  // Determine which price we're buying at
  const price = action === "BUY_UP" ? market.upPrice : market.downPrice;
  
  // Calculate expected edge
  // Score is the strategy's confidence in direction (-1 to 1)
  // We want to check if there's value at current price
  const impliedProb = Math.abs(trade.score); // Strategy thinks this is the "true" probability
  const edge = impliedProb - price;
  
  const checks = {
    // Prix pas aux extrêmes (no edge possible)
    priceInRange: price > THRESHOLDS.MIN_PRICE && price < THRESHOLDS.MAX_PRICE,
    
    // Edge minimum (expected value doit être positif)
    hasEdge: edge >= THRESHOLDS.MIN_EDGE,
    
    // Pas trop proche expiration
    timeLeft: !market.expiresAt || 
      (new Date(market.expiresAt).getTime() - Date.now() > THRESHOLDS.MIN_TIME_HOURS * 60 * 60 * 1000),
    
    // Liquidité suffisante (si spread disponible)
    liquidEnough: !market.spread || market.spread <= THRESHOLDS.MAX_SPREAD,
  };
  
  const failedChecks = Object.entries(checks)
    .filter(([_, passed]) => !passed)
    .map(([name]) => name);
  
  const valid = failedChecks.length === 0;
  
  return {
    valid,
    checks,
    reason: failedChecks.join(", ") || "OK",
    details: {
      price: (price * 100).toFixed(1) + "%",
      impliedProb: (impliedProb * 100).toFixed(1) + "%",
      edge: (edge * 100).toFixed(1) + "%",
      thresholds: THRESHOLDS,
    }
  };
}

/**
 * Log la raison du skip
 */
function logSkip(strategyName, validation) {
  console.log(`\n⏭️  SKIP ${strategyName}: ${validation.reason}`);
  console.log(`   Prix: ${validation.details.price} | Signal: ${validation.details.impliedProb} | Edge: ${validation.details.edge}`);
}

module.exports = {
  validate,
  logSkip,
  THRESHOLDS,
};
