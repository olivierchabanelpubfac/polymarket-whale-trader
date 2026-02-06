/**
 * STRATEGY ARENA
 * 
 * Système de compétition entre stratégies:
 * - Le champion trade en réel (wallet)
 * - Les challengers tradent en paper
 * - Comparaison sur PnL glissant 24-48h
 * - Promotion si challenger > champion 3 fois consécutives
 */

const fs = require("fs");
const path = require("path");
const config = require("./config");
const PaperTrader = require("./paper-trader");
const tradeValidator = require("./trade-validator");
const RiskManager = require("./risk-manager");
const EnsembleAllocator = require("./ensemble");

const ARENA_STATE_FILE = path.join(__dirname, "../data/arena-state.json");
const ACTIVE_MARKETS_FILE = path.join(__dirname, "../data/active-markets.json");
const STRATEGIES_DIR = path.join(__dirname, "strategies");

// Files to skip when loading strategies dynamically
const SKIP_FILES = ["TEMPLATE.js", "creative.js"];
const COMPARISON_WINDOW_HOURS = 48; // Fenêtre glissante pour comparaison
const WINS_FOR_PROMOTION = 3; // Victoires consécutives requises

class StrategyArena {
  constructor() {
    this.paper = new PaperTrader();
    this.riskManager = new RiskManager(this.paper);
    this.ensemble = new EnsembleAllocator();
    this.state = this.loadState();
    this.activeMarkets = this.loadActiveMarkets();
    this.strategies = this.loadStrategies();
  }

  /**
   * Load active markets configuration
   */
  loadActiveMarkets() {
    try {
      if (fs.existsSync(ACTIVE_MARKETS_FILE)) {
        return JSON.parse(fs.readFileSync(ACTIVE_MARKETS_FILE, "utf8"));
      }
    } catch (e) {
      console.warn("Failed to load active markets:", e.message);
    }
    return { markets: [], default: null };
  }

  /**
   * Find the best market for a strategy based on targetMarkets
   */
  findMarketForStrategy(strategy) {
    const instance = strategy.instance;
    
    // If strategy has targetMarkets, find matching market
    if (instance.targetMarkets && Array.isArray(instance.targetMarkets)) {
      for (const market of this.activeMarkets.markets) {
        const slug = market.slug.toLowerCase();
        const matches = instance.targetMarkets.some(pattern => 
          slug.includes(pattern.toLowerCase())
        );
        if (matches) return market.slug;
      }
      // No matching market found
      return null;
    }
    
    // If strategy has matchesMarket method, use it
    if (typeof instance.matchesMarket === "function") {
      for (const market of this.activeMarkets.markets) {
        if (instance.matchesMarket(market.slug)) {
          return market.slug;
        }
      }
    }
    
    // Default: use default market (generic strategies)
    return this.activeMarkets.default;
  }

  loadState() {
    try {
      if (fs.existsSync(ARENA_STATE_FILE)) {
        return JSON.parse(fs.readFileSync(ARENA_STATE_FILE, "utf8"));
      }
    } catch (e) {
      console.error("Failed to load arena state:", e.message);
    }
    return {
      champion: "baseline",
      challengerWins: {},
      promotionHistory: [],
      lastUpdate: Date.now(),
    };
  }

  saveState() {
    const dir = path.dirname(ARENA_STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.state.lastUpdate = Date.now();
    fs.writeFileSync(ARENA_STATE_FILE, JSON.stringify(this.state, null, 2));
  }

  /**
   * Charge toutes les stratégies disponibles dynamiquement
   * Scanne src/strategies/ et charge tous les fichiers .js
   */
  loadStrategies() {
    const strategies = {};
    
    console.log("📂 Loading strategies from src/strategies/...");
    
    // Get all .js files in strategies directory
    const files = fs.readdirSync(STRATEGIES_DIR)
      .filter(f => f.endsWith(".js") && !SKIP_FILES.includes(f));
    
    for (const file of files) {
      try {
        const filePath = path.join(STRATEGIES_DIR, file);
        const Strategy = require(filePath);
        const instance = new Strategy();
        
        // Validate strategy interface
        if (!instance.name || typeof instance.analyze !== "function") {
          console.warn(`   Skip ${file}: missing name or analyze() method`);
          continue;
        }
        
        strategies[instance.name] = {
          name: instance.name,
          instance,
          analyze: async (marketSlug, marketData, signals) => {
            return instance.analyze(marketSlug);
          },
        };
        
        console.log(`   Loaded: ${instance.name}`);
      } catch (e) {
        // Dependency missing or syntax error - skip strategy
        console.warn(`   Skip ${file}: ${e.message}`);
      }
    }
    
    // Also load creative.js variants (legacy support)
    try {
      const CreativeStrategy = require("./strategies/creative");
      const creative = new CreativeStrategy();
      
      const variants = [
        // { name: "contrarian", method: "analyzeContrarian", needsSignals: true, needsMarket: true },  // DISABLED: 0% WR
        { name: "momentum_pure", method: "analyzeMomentumPure", needsSignals: true },
        { name: "whale_copy", method: "analyzeWhaleCopy", needsSignals: true },
        // { name: "mean_reversion", method: "analyzeMeanReversion", needsMarket: true },  // DISABLED: 0% WR
        { name: "volatility_breakout", method: "analyzeVolatilityBreakout", needsSignals: true },
        { name: "time_decay", method: "analyzeTimeDecay", needsMarket: true },
      ];
      
      for (const v of variants) {
        if (typeof creative[v.method] === "function") {
          strategies[v.name] = {
            name: v.name,
            instance: creative,
            analyze: async (marketSlug, marketData, signals) => {
              creative.currentVariant = v.name;
              const args = [];
              if (v.needsSignals) args.push(signals);
              if (v.needsMarket) args.push(marketData);
              return creative[v.method](...args);
            },
          };
          console.log(`   Loaded: ${v.name} (creative variant)`);
        }
      }
    } catch (e) {
      console.warn(`   Skip creative.js variants: ${e.message}`);
    }
    
    console.log(`   Total: ${Object.keys(strategies).length} strategies loaded\n`);
    
    return strategies;
  }

  /**
   * Exécute un cycle de compétition complet
   * Chaque stratégie analyse TOUS les marchés actifs et trade sur celui avec le meilleur signal
   */
  async runCompetition(defaultMarketSlug, defaultMarketData, realTrader) {
    console.log("\n" + "═".repeat(60));
    console.log("🏟️  STRATEGY ARENA - Competition Cycle (Multi-Market)");
    console.log("═".repeat(60));
    console.log(`👑 Champion actuel: ${this.state.champion}`);
    console.log(`📈 Marchés actifs: ${this.activeMarkets.markets.map(m => m.slug.split('-').slice(0,2).join('-')).join(', ')}`);
    
    // Cache for fetched markets - preload all active markets
    const marketCache = {
      [defaultMarketSlug]: defaultMarketData,
    };
    
    // Preload all active markets
    for (const market of this.activeMarkets.markets) {
      if (!marketCache[market.slug]) {
        try {
          const fetchedMarket = await realTrader.getMarket(market.slug);
          if (fetchedMarket) {
            marketCache[market.slug] = fetchedMarket;
            console.log(`   ✓ Loaded: ${market.slug.substring(0, 30)}...`);
          }
        } catch (e) {
          console.warn(`   ✗ Failed to load: ${market.slug} - ${e.message}`);
        }
      }
    }
    
    const allMarkets = Object.keys(marketCache);
    console.log(`\n📊 ${allMarkets.length} marchés disponibles pour analyse\n`);

    // 0. CHECK TAKE PROFITS - Fermer les positions qui ont atteint leur cible
    const marketPrices = {};
    for (const [slug, data] of Object.entries(marketCache)) {
      marketPrices[slug] = {
        upPrice: data.upPrice,
        downPrice: data.downPrice,
      };
    }
    const closedByTP = this.paper.checkTakeProfits(marketPrices);
    if (closedByTP.length > 0) {
      console.log(`\n✅ ${closedByTP.length} position(s) fermée(s) avec Take Profit!\n`);
    }

    // 1. Récupérer les signaux de base (utilisés par toutes les stratégies)
    const baselineResult = await this.strategies.baseline.analyze(defaultMarketSlug, defaultMarketData, null);
    const signals = baselineResult.signals;

    // 2. Analyser chaque stratégie sur TOUS les marchés, garder le meilleur signal
    const results = {};
    for (const [name, strategy] of Object.entries(this.strategies)) {
      try {
        let bestResult = null;
        let bestScore = -Infinity;
        let bestMarketSlug = null;
        let allAnalyses = [];
        
        // Analyze ALL markets for this strategy
        for (const marketSlug of allMarkets) {
          const marketData = marketCache[marketSlug];
          
          try {
            const result = await strategy.analyze(marketSlug, marketData, signals);
            const absScore = Math.abs(result.score || 0);
            
            allAnalyses.push({
              market: marketSlug.substring(0, 25),
              score: result.score,
              action: result.recommendation?.action || "HOLD",
            });
            
            // Keep the best signal (highest absolute score = strongest conviction)
            if (absScore > bestScore && result.recommendation?.action !== "HOLD") {
              bestScore = absScore;
              bestResult = result;
              bestMarketSlug = marketSlug;
            }
          } catch (e) {
            // Skip failed analysis for this market
          }
        }
        
        // If no actionable signal found, use default market with HOLD
        if (!bestResult) {
          bestResult = { score: 0, recommendation: { action: "HOLD" } };
          bestMarketSlug = defaultMarketSlug;
        }
        
        results[name] = {
          ...bestResult,
          strategy: name,
          marketSlug: bestMarketSlug,
          marketData: marketCache[bestMarketSlug],
          allAnalyses, // Include all market analyses for debugging
        };
        
        // Log with market selection info
        const actionStr = bestResult.recommendation?.action || "HOLD";
        const marketShort = bestMarketSlug.split('-').slice(0, 3).join('-');
        const scoreStr = (bestResult.score * 100).toFixed(1);
        
        if (actionStr !== "HOLD") {
          console.log(`📊 ${name.padEnd(22)} → ${actionStr.padEnd(8)} on ${marketShort} (score: ${scoreStr}%)`);
        } else {
          console.log(`📊 ${name.padEnd(22)} → HOLD (no signal across ${allMarkets.length} markets)`);
        }
      } catch (e) {
        console.error(`   Error in ${name}: ${e.message}`);
        results[name] = { strategy: name, score: 0, recommendation: { action: "HOLD" }, marketSlug: defaultMarketSlug };
      }
    }

    // 3. Exécuter les trades - ENSEMBLE MODE
    const championName = this.state.champion;
    const useEnsemble = config.USE_ENSEMBLE !== false; // Default to ensemble mode
    
    // Show ensemble allocations
    if (useEnsemble) {
      this.ensemble.showStatus();
    }

    // Risk management summary
    console.log("\n" + "─".repeat(60));
    console.log("🛡️  RISK MANAGEMENT CHECK");
    console.log("─".repeat(60));
    const riskStatus = this.riskManager.getStatus();
    console.log(`   Portfolio: $${riskStatus.portfolio.toFixed(2)}`);
    console.log(`   Open trades: ${riskStatus.openTrades}`);
    console.log(`   Mode: ${useEnsemble ? "ENSEMBLE" : "CHAMPION"}`);

    for (const [name, result] of Object.entries(results)) {
      const action = result.recommendation?.action;
      const stratMarketData = result.marketData || defaultMarketData;
      const stratMarketSlug = result.marketSlug || defaultMarketSlug;

      if (action && action !== "HOLD" && !result.skipped) {
        const price = action === "BUY_UP" ? stratMarketData.upPrice : stratMarketData.downPrice;

        // Valider le trade avant exécution (trade-validator)
        const validation = tradeValidator.validate(result, stratMarketData);
        if (!validation.valid) {
          tradeValidator.logSkip(name, validation);
          continue; // Skip ce trade
        }

        // RISK MANAGEMENT VALIDATION
        const riskValidation = this.riskManager.validate({
          strategy: name,
          marketSlug: stratMarketSlug,
          action,
          confidence: result.confidence || 0.5,
        });

        if (!riskValidation.valid) {
          this.riskManager.logSkip(name, riskValidation);
          continue; // Skip ce trade pour raison de risk
        }

        // ENSEMBLE or CHAMPION mode
        let canTradeReal = false;
        let tradeSize = riskValidation.size;
        
        if (useEnsemble) {
          // Ensemble mode: check allocation for this strategy
          const ensembleAlloc = this.ensemble.getAllocation(name, riskValidation.size);
          canTradeReal = ensembleAlloc.canTrade && realTrader;
          tradeSize = ensembleAlloc.size;
          
          if (ensembleAlloc.allocation > 0) {
            console.log(`   🎭 [${name}] Ensemble alloc: ${(ensembleAlloc.allocation * 100).toFixed(0)}% → $${tradeSize.toFixed(2)}`);
          }
        } else {
          // Champion mode: only champion trades real
          canTradeReal = (name === championName) && realTrader;
        }
        
        if (riskValidation.adjusted) {
          console.log(`   ℹ️  [${name}] ${riskValidation.adjustReason}`);
        }

        if (canTradeReal && tradeSize >= 1) {
          // Trade RÉEL (ensemble ou champion)
          const modeLabel = useEnsemble ? "ENSEMBLE" : "CHAMPION";
          console.log(`\n💰 ${modeLabel} ${name} - REAL TRADE: ${action} $${tradeSize.toFixed(2)}`);
          const tokenId = action === "BUY_UP" ? stratMarketData.upToken : stratMarketData.downToken;
          const order = await realTrader.placeOrder(tokenId, action === "BUY_UP" ? "UP" : "DOWN", price, tradeSize, stratMarketSlug);
          
          this.paper.logTrade({
            strategy: name,
            isReal: true,
            market: stratMarketSlug,
            action,
            entryPrice: price,
            size: tradeSize,
            score: result.score,
            confidence: result.confidence,
            reason: result.reason || result.recommendation?.reason,
          });
        } else if (tradeSize >= 1) {
          // Trade PAPER
          console.log(`\n📝 PAPER ${name}: ${action} $${tradeSize.toFixed(2)}`);
          this.paper.logTrade({
            strategy: name,
            isReal: false,
            market: stratMarketSlug,
            action,
            entryPrice: price,
            size: tradeSize,
            score: result.score,
            confidence: result.confidence,
            reason: result.reason || result.recommendation?.reason,
          });
        }
      }
    }

    // 4. Comparer les performances et gérer les promotions
    await this.compareAndPromote(defaultMarketData);

    return results;
  }

  /**
   * Calcule la taille de position (simplifié)
   */
  calculatePositionSize(result, marketData) {
    const baseSize = config.MAX_POSITION_SIZE;
    const confidence = result.confidence || 0.5;
    return Math.min(baseSize, baseSize * confidence);
  }

  /**
   * Compare les performances et gère les promotions
   */
  async compareAndPromote(marketData) {
    console.log("\n" + "─".repeat(60));
    console.log("📈 PERFORMANCE COMPARISON");
    console.log("─".repeat(60));

    // Calculer le PnL sur la fenêtre glissante
    const performances = this.paper.getPerformanceWindow(COMPARISON_WINDOW_HOURS);
    
    // Afficher les performances
    const sorted = Object.entries(performances)
      .sort((a, b) => b[1].pnl - a[1].pnl);

    console.log(`\n Stratégie         | Trades | PnL (${COMPARISON_WINDOW_HOURS}h)`);
    console.log("─".repeat(50));

    for (const [name, stats] of sorted) {
      const isChampion = name === this.state.champion;
      const emoji = isChampion ? "👑" : "  ";
      const pnlStr = stats.pnl >= 0 ? `+$${stats.pnl.toFixed(2)}` : `-$${Math.abs(stats.pnl).toFixed(2)}`;
      console.log(`${emoji} ${name.padEnd(18)} |   ${stats.trades.toString().padStart(3)}  | ${pnlStr.padStart(10)}`);
    }

    // Trouver le meilleur challenger
    // CONDITIONS POUR UNE VICTOIRE:
    // 1. PnL challenger > PnL champion
    // 2. PnL challenger > 0 (doit être profitable)
    // 3. Edge minimum de $1 vs champion
    const MIN_EDGE_FOR_WIN = 1.0; // $1 minimum edge
    const championPnL = performances[this.state.champion]?.pnl || 0;
    let bestChallenger = null;
    let bestChallengerPnL = championPnL;

    for (const [name, stats] of sorted) {
      if (name !== this.state.champion && 
          stats.pnl > bestChallengerPnL &&
          stats.pnl > 0 &&  // Must be profitable
          (stats.pnl - championPnL) >= MIN_EDGE_FOR_WIN) {  // Min $1 edge
        bestChallenger = name;
        bestChallengerPnL = stats.pnl;
      }
    }

    // Gérer les victoires consécutives
    if (bestChallenger) {
      this.state.challengerWins[bestChallenger] = (this.state.challengerWins[bestChallenger] || 0) + 1;
      console.log(`\n🔥 ${bestChallenger} surpasse le champion! (${this.state.challengerWins[bestChallenger]}/${WINS_FOR_PROMOTION} victoires)`);

      // Reset les autres challengers
      for (const name of Object.keys(this.state.challengerWins)) {
        if (name !== bestChallenger) {
          this.state.challengerWins[name] = 0;
        }
      }

      // Vérifier si promotion
      if (this.state.challengerWins[bestChallenger] >= WINS_FOR_PROMOTION) {
        await this.promote(bestChallenger);
      }
    } else {
      // Champion reste en tête - reset tous les challengers
      console.log(`\n👑 ${this.state.champion} reste champion!`);
      this.state.challengerWins = {};
    }

    this.saveState();
  }

  /**
   * Promeut un challenger en nouveau champion
   */
  async promote(newChampion) {
    const oldChampion = this.state.champion;
    
    console.log("\n" + "═".repeat(60));
    console.log(`🎉 PROMOTION! ${newChampion} devient le nouveau champion!`);
    console.log(`   ${oldChampion} → challenger`);
    console.log("═".repeat(60));

    // Enregistrer l'historique
    this.state.promotionHistory.push({
      timestamp: Date.now(),
      oldChampion,
      newChampion,
      reason: `${WINS_FOR_PROMOTION} victoires consécutives`,
    });

    // Changer de champion
    this.state.champion = newChampion;
    this.state.challengerWins = {};

    this.saveState();
  }

  /**
   * Affiche le statut de l'arène
   */
  showStatus() {
    console.log("\n" + "═".repeat(60));
    console.log("🏟️  STRATEGY ARENA - Status");
    console.log("═".repeat(60));
    console.log(`\n👑 Champion: ${this.state.champion}`);
    
    if (Object.keys(this.state.challengerWins).length > 0) {
      console.log("\n🔥 Challengers en progression:");
      for (const [name, wins] of Object.entries(this.state.challengerWins)) {
        if (wins > 0) {
          console.log(`   ${name}: ${wins}/${WINS_FOR_PROMOTION} victoires`);
        }
      }
    }

    if (this.state.promotionHistory.length > 0) {
      console.log("\n📜 Historique des promotions:");
      for (const p of this.state.promotionHistory.slice(-5)) {
        const date = new Date(p.timestamp).toLocaleString();
        console.log(`   ${date}: ${p.oldChampion} → ${p.newChampion}`);
      }
    }

    // Performances actuelles
    const performances = this.paper.getPerformanceWindow(COMPARISON_WINDOW_HOURS);
    if (Object.keys(performances).length > 0) {
      console.log(`\n📊 Performances (${COMPARISON_WINDOW_HOURS}h):`);
      const sorted = Object.entries(performances).sort((a, b) => b[1].pnl - a[1].pnl);
      for (const [name, stats] of sorted) {
        const isChampion = name === this.state.champion;
        const emoji = isChampion ? "👑" : "  ";
        const pnlStr = stats.pnl >= 0 ? `+$${stats.pnl.toFixed(2)}` : `-$${Math.abs(stats.pnl).toFixed(2)}`;
        console.log(`   ${emoji} ${name}: ${pnlStr} (${stats.trades} trades)`);
      }
    }

    console.log("\n" + "═".repeat(60));
  }
}

module.exports = StrategyArena;
