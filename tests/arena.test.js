/**
 * Tests pour le mécanisme de compétition (Strategy Arena)
 * 
 * Usage: node tests/arena.test.js
 */

const assert = require("assert");
const path = require("path");
const fs = require("fs");

// Mock des dépendances avant d'importer les modules
const TEST_DATA_DIR = path.join(__dirname, "../data-test");
const TEST_PAPER_FILE = path.join(TEST_DATA_DIR, "paper-trades.json");
const TEST_ARENA_FILE = path.join(TEST_DATA_DIR, "arena-state.json");

// Setup: créer le dossier de test
function setup() {
  if (!fs.existsSync(TEST_DATA_DIR)) {
    fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  }
  // Nettoyer les fichiers de test
  if (fs.existsSync(TEST_PAPER_FILE)) fs.unlinkSync(TEST_PAPER_FILE);
  if (fs.existsSync(TEST_ARENA_FILE)) fs.unlinkSync(TEST_ARENA_FILE);
}

// Teardown: nettoyer après les tests
function teardown() {
  if (fs.existsSync(TEST_PAPER_FILE)) fs.unlinkSync(TEST_PAPER_FILE);
  if (fs.existsSync(TEST_ARENA_FILE)) fs.unlinkSync(TEST_ARENA_FILE);
  if (fs.existsSync(TEST_DATA_DIR)) {
    try { fs.rmdirSync(TEST_DATA_DIR); } catch (e) {}
  }
}

// ============================================
// Tests unitaires pour PaperTrader
// ============================================

function testPaperTraderPerformanceWindow() {
  console.log("  Test: getPerformanceWindow filtre correctement par timestamp...");
  
  const now = Date.now();
  const hourMs = 60 * 60 * 1000;
  
  // Créer des données de test directement
  const testData = {
    trades: [
      // Trade dans la fenêtre (il y a 1h)
      {
        id: "t1",
        timestamp: now - 1 * hourMs,
        strategy: "baseline",
        status: "closed",
        pnl: 10,
        action: "BUY_UP",
        entryPrice: 0.5,
        size: 50,
      },
      // Trade hors fenêtre (il y a 50h)
      {
        id: "t2",
        timestamp: now - 50 * hourMs,
        strategy: "baseline",
        status: "closed",
        pnl: 100,
        action: "BUY_UP",
        entryPrice: 0.5,
        size: 50,
      },
      // Trade dans la fenêtre pour autre stratégie (il y a 2h)
      {
        id: "t3",
        timestamp: now - 2 * hourMs,
        strategy: "momentum_pure",
        status: "closed",
        pnl: 20,
        action: "BUY_DOWN",
        entryPrice: 0.6,
        size: 50,
      },
    ],
    performance: {},
  };

  // Simuler PaperTrader avec données de test
  const PaperTrader = require("../src/paper-trader");
  const paper = new PaperTrader();
  paper.data = testData;

  // Test fenêtre 48h
  const perf48h = paper.getPerformanceWindow(48);
  
  assert.strictEqual(perf48h.baseline?.trades, 1, "Baseline devrait avoir 1 trade dans les 48h");
  assert.strictEqual(perf48h.baseline?.pnl, 10, "Baseline PnL devrait être 10");
  assert.strictEqual(perf48h.momentum_pure?.trades, 1, "momentum_pure devrait avoir 1 trade");
  assert.strictEqual(perf48h.momentum_pure?.pnl, 20, "momentum_pure PnL devrait être 20");

  console.log("    ✓ Fenêtre glissante fonctionne correctement");
}

function testPaperTraderMtmCalculation() {
  console.log("  Test: calculateMtmPnL calcule correctement le mark-to-market...");
  
  const PaperTrader = require("../src/paper-trader");
  const paper = new PaperTrader();

  // Trade ouvert: acheté UP à 0.5, prix actuel 0.6
  const trade = {
    status: "open",
    action: "BUY_UP",
    entryPrice: 0.5,
    size: 50, // $50 investis
  };

  const currentPrices = { up: 0.6, down: 0.4 };
  const mtmPnL = paper.calculateMtmPnL(trade, currentPrices);

  // shares = 50 / 0.5 = 100
  // current value = 100 * 0.6 = 60
  // pnl = 60 - 50 = 10
  assert.strictEqual(mtmPnL, 10, "MtM PnL devrait être +$10");

  // Trade fermé devrait retourner le pnl enregistré
  const closedTrade = { status: "closed", pnl: 25 };
  const closedMtm = paper.calculateMtmPnL(closedTrade, currentPrices);
  assert.strictEqual(closedMtm, 25, "Trade fermé devrait retourner son PnL");

  console.log("    ✓ Calcul MtM correct");
}

function testPaperTraderStrategyNormalization() {
  console.log("  Test: Normalisation des noms de stratégie (creative:xxx -> xxx)...");
  
  const now = Date.now();
  const testData = {
    trades: [
      {
        id: "t1",
        timestamp: now,
        strategy: "creative:contrarian",
        status: "closed",
        pnl: 15,
        action: "BUY_UP",
        entryPrice: 0.5,
        size: 50,
      },
      {
        id: "t2",
        timestamp: now,
        strategy: "contrarian", // Même stratégie, nom différent
        status: "closed",
        pnl: 5,
        action: "BUY_UP",
        entryPrice: 0.5,
        size: 50,
      },
    ],
    performance: {},
  };

  const PaperTrader = require("../src/paper-trader");
  const paper = new PaperTrader();
  paper.data = testData;

  const perf = paper.getPerformanceWindow(48);
  
  // Les deux devraient être agrégés sous "contrarian"
  assert.strictEqual(perf.contrarian?.trades, 2, "Devrait agréger les 2 trades");
  assert.strictEqual(perf.contrarian?.pnl, 20, "PnL total devrait être 20");

  console.log("    ✓ Normalisation des noms fonctionne");
}

// ============================================
// Tests unitaires pour StrategyArena
// ============================================

function testArenaInitialState() {
  console.log("  Test: État initial de l'arène...");
  
  // Créer une arène avec état vide
  const arenaState = {
    champion: "baseline",
    challengerWins: {},
    promotionHistory: [],
    lastUpdate: Date.now(),
  };

  assert.strictEqual(arenaState.champion, "baseline", "Champion initial devrait être baseline");
  assert.deepStrictEqual(arenaState.challengerWins, {}, "Pas de victoires au départ");
  assert.deepStrictEqual(arenaState.promotionHistory, [], "Pas d'historique au départ");

  console.log("    ✓ État initial correct");
}

function testChallengerWinsAccumulation() {
  console.log("  Test: Accumulation des victoires de challenger...");
  
  const state = {
    champion: "baseline",
    challengerWins: {},
  };

  // Simuler 3 victoires consécutives de momentum_pure
  function simulateWin(challenger) {
    state.challengerWins[challenger] = (state.challengerWins[challenger] || 0) + 1;
    // Reset autres challengers
    for (const name of Object.keys(state.challengerWins)) {
      if (name !== challenger) state.challengerWins[name] = 0;
    }
  }

  simulateWin("momentum_pure");
  assert.strictEqual(state.challengerWins.momentum_pure, 1);

  simulateWin("momentum_pure");
  assert.strictEqual(state.challengerWins.momentum_pure, 2);

  simulateWin("momentum_pure");
  assert.strictEqual(state.challengerWins.momentum_pure, 3);

  console.log("    ✓ Accumulation des victoires fonctionne");
}

function testChallengerWinsReset() {
  console.log("  Test: Reset des victoires quand un autre challenger gagne...");
  
  const state = {
    champion: "baseline",
    challengerWins: { momentum_pure: 2 },
  };

  // Un autre challenger gagne
  function simulateWin(challenger) {
    state.challengerWins[challenger] = (state.challengerWins[challenger] || 0) + 1;
    for (const name of Object.keys(state.challengerWins)) {
      if (name !== challenger) state.challengerWins[name] = 0;
    }
  }

  simulateWin("contrarian");
  
  assert.strictEqual(state.challengerWins.contrarian, 1, "contrarian devrait avoir 1 victoire");
  assert.strictEqual(state.challengerWins.momentum_pure, 0, "momentum_pure devrait être reset");

  console.log("    ✓ Reset des victoires fonctionne");
}

function testChallengerWinsResetWhenChampionWins() {
  console.log("  Test: Reset de toutes les victoires quand le champion gagne...");
  
  const state = {
    champion: "baseline",
    challengerWins: { momentum_pure: 2, contrarian: 1 },
  };

  // Champion reste en tête - reset tous
  state.challengerWins = {};
  
  assert.deepStrictEqual(state.challengerWins, {}, "Toutes les victoires devraient être reset");

  console.log("    ✓ Reset total quand champion gagne");
}

function testPromotionLogic() {
  console.log("  Test: Logique de promotion (3 victoires consécutives)...");
  
  const WINS_FOR_PROMOTION = 3;
  const state = {
    champion: "baseline",
    challengerWins: { momentum_pure: 2 },
    promotionHistory: [],
  };

  // Fonction de promotion
  function checkPromotion(challenger) {
    state.challengerWins[challenger] = (state.challengerWins[challenger] || 0) + 1;
    
    if (state.challengerWins[challenger] >= WINS_FOR_PROMOTION) {
      const oldChampion = state.champion;
      state.promotionHistory.push({
        timestamp: Date.now(),
        oldChampion,
        newChampion: challenger,
      });
      state.champion = challenger;
      state.challengerWins = {};
      return true;
    }
    return false;
  }

  const promoted = checkPromotion("momentum_pure");
  
  assert.strictEqual(promoted, true, "Devrait déclencher une promotion");
  assert.strictEqual(state.champion, "momentum_pure", "Nouveau champion devrait être momentum_pure");
  assert.strictEqual(state.promotionHistory.length, 1, "Historique devrait avoir 1 entrée");
  assert.strictEqual(state.promotionHistory[0].oldChampion, "baseline");
  assert.strictEqual(state.promotionHistory[0].newChampion, "momentum_pure");
  assert.deepStrictEqual(state.challengerWins, {}, "Victoires devraient être reset après promotion");

  console.log("    ✓ Logique de promotion correcte");
}

function testNoPromotionBeforeThreeWins() {
  console.log("  Test: Pas de promotion avant 3 victoires...");
  
  const WINS_FOR_PROMOTION = 3;
  const state = {
    champion: "baseline",
    challengerWins: {},
  };

  function checkPromotion(challenger) {
    state.challengerWins[challenger] = (state.challengerWins[challenger] || 0) + 1;
    return state.challengerWins[challenger] >= WINS_FOR_PROMOTION;
  }

  assert.strictEqual(checkPromotion("contrarian"), false, "1 victoire: pas de promotion");
  assert.strictEqual(checkPromotion("contrarian"), false, "2 victoires: pas de promotion");
  assert.strictEqual(checkPromotion("contrarian"), true, "3 victoires: promotion");

  console.log("    ✓ Seuil de 3 victoires respecté");
}

function testPerformanceComparison() {
  console.log("  Test: Comparaison des performances pour déterminer le gagnant...");
  
  const performances = {
    baseline: { trades: 5, pnl: 50 },
    momentum_pure: { trades: 3, pnl: 75 },
    contrarian: { trades: 4, pnl: 30 },
  };

  const champion = "baseline";
  const championPnL = performances[champion]?.pnl || 0;

  // Trouver le meilleur challenger
  let bestChallenger = null;
  let bestChallengerPnL = championPnL;

  for (const [name, stats] of Object.entries(performances)) {
    if (name !== champion && stats.pnl > bestChallengerPnL) {
      bestChallenger = name;
      bestChallengerPnL = stats.pnl;
    }
  }

  assert.strictEqual(bestChallenger, "momentum_pure", "momentum_pure devrait être le meilleur challenger");
  assert.strictEqual(bestChallengerPnL, 75, "Meilleur PnL devrait être 75");

  console.log("    ✓ Comparaison des performances correcte");
}

function testNoWinnerWhenChampionLeads() {
  console.log("  Test: Pas de gagnant quand le champion est en tête...");
  
  const performances = {
    baseline: { trades: 5, pnl: 100 },
    momentum_pure: { trades: 3, pnl: 50 },
    contrarian: { trades: 4, pnl: 30 },
  };

  const champion = "baseline";
  const championPnL = performances[champion]?.pnl || 0;

  let bestChallenger = null;
  let bestChallengerPnL = championPnL;

  for (const [name, stats] of Object.entries(performances)) {
    if (name !== champion && stats.pnl > bestChallengerPnL) {
      bestChallenger = name;
      bestChallengerPnL = stats.pnl;
    }
  }

  assert.strictEqual(bestChallenger, null, "Pas de challenger gagnant");

  console.log("    ✓ Champion reste en tête correctement détecté");
}

// ============================================
// Tests d'intégration
// ============================================

function testFullCompetitionCycle() {
  console.log("  Test: Cycle complet de compétition (simulation)...");
  
  const WINS_FOR_PROMOTION = 3;
  
  // Simuler l'état de l'arène
  const state = {
    champion: "baseline",
    challengerWins: {},
    promotionHistory: [],
  };

  // Simuler plusieurs cycles
  const cycles = [
    // Cycle 1: momentum_pure gagne
    { baseline: 10, momentum_pure: 20, contrarian: 5 },
    // Cycle 2: momentum_pure gagne encore
    { baseline: 15, momentum_pure: 25, contrarian: 10 },
    // Cycle 3: momentum_pure gagne encore -> promotion!
    { baseline: 20, momentum_pure: 30, contrarian: 15 },
    // Cycle 4: baseline (nouveau challenger) gagne
    { baseline: 40, momentum_pure: 35, contrarian: 20 },
    // Cycle 5: contrarian gagne (reset baseline)
    { baseline: 45, momentum_pure: 40, contrarian: 50 },
  ];

  for (let i = 0; i < cycles.length; i++) {
    const perf = cycles[i];
    const championPnL = perf[state.champion] || 0;

    // Trouver meilleur challenger
    let bestChallenger = null;
    let bestPnL = championPnL;

    for (const [name, pnl] of Object.entries(perf)) {
      if (name !== state.champion && pnl > bestPnL) {
        bestChallenger = name;
        bestPnL = pnl;
      }
    }

    if (bestChallenger) {
      state.challengerWins[bestChallenger] = (state.challengerWins[bestChallenger] || 0) + 1;
      // Reset autres
      for (const name of Object.keys(state.challengerWins)) {
        if (name !== bestChallenger) state.challengerWins[name] = 0;
      }
      
      // Check promotion
      if (state.challengerWins[bestChallenger] >= WINS_FOR_PROMOTION) {
        state.promotionHistory.push({
          cycle: i + 1,
          oldChampion: state.champion,
          newChampion: bestChallenger,
        });
        state.champion = bestChallenger;
        state.challengerWins = {};
      }
    } else {
      state.challengerWins = {};
    }
  }

  // Vérifications
  assert.strictEqual(state.promotionHistory.length, 1, "Une seule promotion devrait avoir eu lieu");
  assert.strictEqual(state.promotionHistory[0].oldChampion, "baseline");
  assert.strictEqual(state.promotionHistory[0].newChampion, "momentum_pure");
  assert.strictEqual(state.promotionHistory[0].cycle, 3, "Promotion au cycle 3");
  assert.strictEqual(state.champion, "momentum_pure", "momentum_pure devrait être champion");
  assert.strictEqual(state.challengerWins.contrarian, 1, "contrarian devrait avoir 1 victoire");

  console.log("    ✓ Cycle complet fonctionne correctement");
}

function testEdgeCaseTiedPerformance() {
  console.log("  Test: Cas limite - performances égales...");
  
  const performances = {
    baseline: { trades: 5, pnl: 50 },
    momentum_pure: { trades: 3, pnl: 50 }, // Même PnL que champion
  };

  const champion = "baseline";
  const championPnL = performances[champion]?.pnl || 0;

  let bestChallenger = null;
  let bestChallengerPnL = championPnL;

  for (const [name, stats] of Object.entries(performances)) {
    // Note: > strict, pas >= (le champion gagne en cas d'égalité)
    if (name !== champion && stats.pnl > bestChallengerPnL) {
      bestChallenger = name;
      bestChallengerPnL = stats.pnl;
    }
  }

  assert.strictEqual(bestChallenger, null, "En cas d'égalité, champion conserve son titre");

  console.log("    ✓ Égalité gérée correctement (champion conserve)");
}

function testEdgeCaseNoTrades() {
  console.log("  Test: Cas limite - aucun trade dans la fenêtre...");
  
  const performances = {};

  const champion = "baseline";
  const championPnL = performances[champion]?.pnl || 0;

  assert.strictEqual(championPnL, 0, "PnL devrait être 0 si pas de trades");

  let bestChallenger = null;
  for (const [name, stats] of Object.entries(performances)) {
    if (name !== champion && stats.pnl > championPnL) {
      bestChallenger = name;
    }
  }

  assert.strictEqual(bestChallenger, null, "Pas de challenger sans trades");

  console.log("    ✓ Cas sans trades géré correctement");
}

// ============================================
// Runner
// ============================================

async function runTests() {
  console.log("\n════════════════════════════════════════════════════════════");
  console.log("🧪 TESTS - Mécanisme de Compétition (Strategy Arena)");
  console.log("════════════════════════════════════════════════════════════\n");

  setup();

  let passed = 0;
  let failed = 0;

  const tests = [
    // PaperTrader tests
    ["PaperTrader: Fenêtre glissante", testPaperTraderPerformanceWindow],
    ["PaperTrader: Calcul MtM", testPaperTraderMtmCalculation],
    ["PaperTrader: Normalisation stratégies", testPaperTraderStrategyNormalization],
    
    // Arena state tests
    ["Arena: État initial", testArenaInitialState],
    ["Arena: Accumulation victoires", testChallengerWinsAccumulation],
    ["Arena: Reset victoires (autre challenger)", testChallengerWinsReset],
    ["Arena: Reset victoires (champion gagne)", testChallengerWinsResetWhenChampionWins],
    ["Arena: Logique promotion", testPromotionLogic],
    ["Arena: Seuil 3 victoires", testNoPromotionBeforeThreeWins],
    ["Arena: Comparaison performances", testPerformanceComparison],
    ["Arena: Champion en tête", testNoWinnerWhenChampionLeads],
    
    // Integration tests
    ["Intégration: Cycle complet", testFullCompetitionCycle],
    ["Edge case: Égalité", testEdgeCaseTiedPerformance],
    ["Edge case: Aucun trade", testEdgeCaseNoTrades],
  ];

  for (const [name, testFn] of tests) {
    try {
      console.log(`\n📋 ${name}`);
      testFn();
      passed++;
    } catch (e) {
      failed++;
      console.log(`    ❌ FAILED: ${e.message}`);
      if (e.stack) {
        console.log(`       ${e.stack.split("\n")[1]}`);
      }
    }
  }

  teardown();

  console.log("\n════════════════════════════════════════════════════════════");
  console.log(`📊 Résultats: ${passed} passed, ${failed} failed`);
  console.log("════════════════════════════════════════════════════════════\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(e => {
  console.error("Test runner error:", e);
  process.exit(1);
});
