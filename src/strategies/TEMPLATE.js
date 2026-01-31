/**
 * STRATEGY TEMPLATE
 * 
 * This file is a reference template for auto-generated strategies.
 * DO NOT require() this file - it will not work.
 * 
 * To implement a new strategy from an idea:
 * 1. Copy this template to {idea.name}.js (snake_case with hyphens)
 * 2. Replace all {PLACEHOLDERS} with actual values
 * 3. Implement the analyze() method
 * 4. Export the class
 * 
 * =============================================================================
 * STRATEGY: {NAME}
 * 
 * Generated from idea: {ID}
 * AlphaScore: {SCORE}/10 | Complexity: {COMPLEXITY}
 * 
 * {DESCRIPTION}
 * 
 * Entry: {ENTRY_RULES}
 * Exit: {EXIT_RULES}
 * Risk: {RISK_SIZING}
 * =============================================================================
 */

const fs = require("fs");
const path = require("path");
const config = require("../config");

// Optional: State file for caching/persistence
const STATE_FILE = path.join(__dirname, "../../data/{name}-state.json");

class {ClassName}Strategy {
  constructor() {
    // REQUIRED: Unique identifier (snake_case)
    this.name = "{snake_case_name}";
    
    // REQUIRED: Human-readable description
    this.description = "{description}";
    
    // Optional: Load persisted state
    this.state = this.loadState();
  }

  /**
   * Load persisted state from disk
   */
  loadState() {
    try {
      if (fs.existsSync(STATE_FILE)) {
        return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
      }
    } catch (e) {
      console.error(`Failed to load state: ${e.message}`);
    }
    return {
      lastRun: null,
      // Add strategy-specific state here
    };
  }

  /**
   * Save state to disk
   */
  saveState() {
    const dir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.state.lastRun = Date.now();
    fs.writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2));
  }

  /**
   * Check if required environment variables are set
   * @returns {boolean} true if all required env vars are present
   */
  checkDependencies() {
    const required = [/* "API_KEY_NAME" */];
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
      console.warn(`  ${this.name}: Missing env vars: ${missing.join(", ")}`);
      return false;
    }
    return true;
  }

  /**
   * REQUIRED: Main analysis method
   * 
   * @param {string} marketSlug - The market identifier (e.g., "bitcoin-up-or-down-on-january-31")
   * @returns {Promise<Object>} Analysis result with recommendation
   * 
   * Return format:
   * {
   *   strategy: "creative:{name}",     // Strategy identifier
   *   score: 0.0,                       // -1 to 1 (negative = bearish, positive = bullish)
   *   confidence: 0.0,                  // 0 to 1 (how confident in the signal)
   *   recommendation: {
   *     action: "HOLD",                 // "BUY_UP" | "BUY_DOWN" | "HOLD"
   *     reason: "Why this action"
   *   },
   *   reason: "Short summary",          // One-line reason for logging
   *   data: {}                          // Optional: raw data for debugging
   * }
   */
  async analyze(marketSlug) {
    console.log(`\n📊 ${this.name}: Analyzing ${marketSlug}...`);

    // Check dependencies first - return HOLD if missing
    if (!this.checkDependencies()) {
      return {
        strategy: `creative:${this.name}`,
        score: 0,
        confidence: 0,
        recommendation: { action: "HOLD", reason: "Missing dependencies" },
        reason: "Dependencies not configured",
      };
    }

    // =========================================================================
    // IMPLEMENT YOUR STRATEGY LOGIC HERE
    // =========================================================================
    
    // 1. Fetch data from your data sources
    // const data = await this.fetchData(marketSlug);
    
    // 2. Apply entry rules
    // const shouldEnter = this.checkEntryConditions(data);
    
    // 3. Calculate score and confidence
    // const score = this.calculateScore(data);
    // const confidence = this.calculateConfidence(data);
    
    // 4. Determine action
    // const action = this.determineAction(score, confidence);

    // =========================================================================
    // PLACEHOLDER RETURN - Replace with actual implementation
    // =========================================================================
    
    return {
      strategy: `creative:${this.name}`,
      score: 0,
      confidence: 0,
      recommendation: { action: "HOLD", reason: "Not implemented" },
      reason: "Strategy not yet implemented",
    };
  }

  /**
   * Helper: Determine action based on score and confidence
   */
  determineAction(score, confidence, thresholds = { score: 0.15, confidence: 0.5 }) {
    if (confidence < thresholds.confidence) {
      return { action: "HOLD", reason: "Low confidence" };
    }
    if (score > thresholds.score) {
      return { action: "BUY_UP", reason: `Bullish signal (${(score * 100).toFixed(0)}%)` };
    }
    if (score < -thresholds.score) {
      return { action: "BUY_DOWN", reason: `Bearish signal (${(-score * 100).toFixed(0)}%)` };
    }
    return { action: "HOLD", reason: "No clear signal" };
  }
}

module.exports = {ClassName}Strategy;
