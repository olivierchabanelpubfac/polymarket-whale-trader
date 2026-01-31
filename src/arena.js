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
const BaselineStrategy = require("./strategies/baseline");
const CreativeStrategy = require("./strategies/creative");
const InsiderTracker = require("./strategies/insider-tracker");
const CrossExchangeArb = require("./strategies/cross-exchange-arb");
const SentimentDivergence = require("./strategies/sentiment-divergence");

const ARENA_STATE_FILE = path.join(__dirname, "../data/arena-state.json");
const COMPARISON_WINDOW_HOURS = 48; // Fenêtre glissante pour comparaison
const WINS_FOR_PROMOTION = 3; // Victoires consécutives requises

class StrategyArena {
  constructor() {
    this.paper = new PaperTrader();
    this.state = this.loadState();
    this.strategies = this.loadStrategies();
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
   * Charge toutes les stratégies disponibles
   */
  loadStrategies() {
    const baseline = new BaselineStrategy();
    const creative = new CreativeStrategy();
    const insiderTracker = new InsiderTracker();
    const crossExchangeArb = new CrossExchangeArb();
    const sentimentDivergence = new SentimentDivergence();
    
    // Liste des stratégies avec interface unifiée
    return {
      baseline: {
        name: "baseline",
        instance: baseline,
        analyze: async (marketSlug, marketData, signals) => {
          return baseline.analyze(marketSlug);
        },
      },
      contrarian: {
        name: "contrarian",
        instance: creative,
        analyze: async (marketSlug, marketData, signals) => {
          creative.currentVariant = "contrarian";
          return creative.analyzeContrarian(signals, marketData);
        },
      },
      momentum_pure: {
        name: "momentum_pure",
        instance: creative,
        analyze: async (marketSlug, marketData, signals) => {
          creative.currentVariant = "momentum_pure";
          return creative.analyzeMomentumPure(signals);
        },
      },
      whale_copy: {
        name: "whale_copy",
        instance: creative,
        analyze: async (marketSlug, marketData, signals) => {
          creative.currentVariant = "whale_copy";
          return creative.analyzeWhaleCopy(signals);
        },
      },
      mean_reversion: {
        name: "mean_reversion",
        instance: creative,
        analyze: async (marketSlug, marketData, signals) => {
          creative.currentVariant = "mean_reversion";
          return creative.analyzeMeanReversion(marketData);
        },
      },
      volatility_breakout: {
        name: "volatility_breakout",
        instance: creative,
        analyze: async (marketSlug, marketData, signals) => {
          creative.currentVariant = "volatility_breakout";
          return creative.analyzeVolatilityBreakout(signals);
        },
      },
      time_decay: {
        name: "time_decay",
        instance: creative,
        analyze: async (marketSlug, marketData, signals) => {
          creative.currentVariant = "time_decay";
          return creative.analyzeTimeDecay(marketData);
        },
      },
      insider_tracker: {
        name: "insider_tracker",
        instance: insiderTracker,
        analyze: async (marketSlug, marketData, signals) => {
          return insiderTracker.analyze(marketSlug);
        },
      },
      cross_exchange_arb: {
        name: "cross_exchange_arb",
        instance: crossExchangeArb,
        analyze: async (marketSlug, marketData, signals) => {
          return crossExchangeArb.analyze(marketSlug);
        },
      },
      sentiment_divergence: {
        name: "sentiment_divergence",
        instance: sentimentDivergence,
        analyze: async (marketSlug, marketData, signals) => {
          return sentimentDivergence.analyze(marketSlug);
        },
      },
    };
  }

  /**
   * Exécute un cycle de compétition complet
   */
  async runCompetition(marketSlug, marketData, realTrader) {
    console.log("\n" + "═".repeat(60));
    console.log("🏟️  STRATEGY ARENA - Competition Cycle");
    console.log("═".repeat(60));
    console.log(`👑 Champion actuel: ${this.state.champion}`);

    // 1. Récupérer les signaux de base (utilisés par toutes les stratégies)
    const baselineResult = await this.strategies.baseline.analyze(marketSlug, marketData, null);
    const signals = baselineResult.signals;

    // 2. Analyser chaque stratégie
    const results = {};
    for (const [name, strategy] of Object.entries(this.strategies)) {
      try {
        const result = await strategy.analyze(marketSlug, marketData, signals);
        results[name] = {
          ...result,
          strategy: name,
        };
        console.log(`\n📊 ${name}: ${result.recommendation?.action || "HOLD"} (score: ${(result.score * 100).toFixed(1)}%)`);
      } catch (e) {
        console.error(`   Error in ${name}: ${e.message}`);
        results[name] = { strategy: name, score: 0, recommendation: { action: "HOLD" } };
      }
    }

    // 3. Exécuter les trades
    const championName = this.state.champion;
    const championResult = results[championName];

    for (const [name, result] of Object.entries(results)) {
      const isChampion = name === championName;
      const action = result.recommendation?.action;

      if (action && action !== "HOLD") {
        const price = action === "BUY_UP" ? marketData.upPrice : marketData.downPrice;
        const size = this.calculatePositionSize(result, marketData);

        if (isChampion && realTrader) {
          // Trade RÉEL pour le champion
          console.log(`\n💰 CHAMPION ${name} - REAL TRADE: ${action}`);
          const tokenId = action === "BUY_UP" ? marketData.upToken : marketData.downToken;
          const order = await realTrader.placeOrder(tokenId, action === "BUY_UP" ? "UP" : "DOWN", price, size, marketSlug);
          
          this.paper.logTrade({
            strategy: name,
            isReal: true,
            market: marketSlug,
            action,
            entryPrice: price,
            size,
            score: result.score,
            confidence: result.confidence,
            reason: result.reason || result.recommendation?.reason,
          });
        } else {
          // Trade PAPER pour les challengers
          console.log(`\n📝 CHALLENGER ${name} - PAPER TRADE: ${action}`);
          this.paper.logTrade({
            strategy: name,
            isReal: false,
            market: marketSlug,
            action,
            entryPrice: price,
            size,
            score: result.score,
            confidence: result.confidence,
            reason: result.reason || result.recommendation?.reason,
          });
        }
      }
    }

    // 4. Comparer les performances et gérer les promotions
    await this.compareAndPromote(marketData);

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
    const championPnL = performances[this.state.champion]?.pnl || 0;
    let bestChallenger = null;
    let bestChallengerPnL = championPnL;

    for (const [name, stats] of sorted) {
      if (name !== this.state.champion && stats.pnl > bestChallengerPnL) {
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
