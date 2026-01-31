#!/usr/bin/env node
/**
 * 🧠 STRATEGY IDEATION AGENT
 * 
 * Génère des idées de nouvelles stratégies de trading.
 * Les idées sont auto-implémentées par Tars (pas de validation manuelle).
 * 
 * Usage:
 *   node src/ideation/agent.js generate  - Génère de nouvelles idées
 *   node src/ideation/agent.js list      - Liste les idées
 *   node src/ideation/agent.js context   - Affiche le contexte (stratégies existantes)
 */

const fs = require("fs");
const path = require("path");

const IDEAS_FILE = path.join(__dirname, "../../data/ideas.json");

class IdeationAgent {
  constructor() {
    this.ideas = this.loadIdeas();
    this.existingStrategies = this.loadExistingStrategies();
  }

  loadIdeas() {
    try {
      if (fs.existsSync(IDEAS_FILE)) {
        return JSON.parse(fs.readFileSync(IDEAS_FILE, "utf8"));
      }
    } catch (e) {}
    return { ideas: [], lastGenerated: null };
  }

  /**
   * Charge les stratégies existantes pour éviter les doublons
   */
  loadExistingStrategies() {
    const strategiesDir = path.join(__dirname, "../strategies");
    const strategies = [];
    
    try {
      const files = fs.readdirSync(strategiesDir);
      for (const file of files) {
        if (file.endsWith(".js")) {
          const content = fs.readFileSync(path.join(strategiesDir, file), "utf8");
          
          // Extract strategy info from comments/code
          const nameMatch = content.match(/class\s+(\w+)/);
          const descMatch = content.match(/\*\s*([A-Z][^*\n]+)/);
          
          strategies.push({
            file,
            name: nameMatch ? nameMatch[1] : file.replace(".js", ""),
            description: descMatch ? descMatch[1].trim() : "",
            // Extract key features
            features: this.extractFeatures(content),
          });
        }
      }
    } catch (e) {
      console.error("Error loading strategies:", e.message);
    }
    
    return strategies;
  }

  extractFeatures(code) {
    const features = [];
    if (code.includes("momentum")) features.push("momentum");
    if (code.includes("whale")) features.push("whale-tracking");
    if (code.includes("sentiment")) features.push("sentiment");
    if (code.includes("RSI") || code.includes("rsi")) features.push("RSI");
    if (code.includes("arb")) features.push("arbitrage");
    if (code.includes("contrarian")) features.push("contrarian");
    if (code.includes("cluster")) features.push("cluster-detection");
    if (code.includes("Bayesian")) features.push("bayesian");
    return features;
  }

  /**
   * Retourne le contexte des stratégies existantes (pour le LLM)
   */
  getContext() {
    return {
      existingStrategies: this.existingStrategies,
      existingIdeas: this.ideas.ideas.map(i => ({
        name: i.name,
        description: i.description,
        status: i.status,
      })),
      suggestions: [
        "Nouvelles sources de données (social, on-chain, macro)",
        "Combinaisons de signaux non explorées",
        "Timing strategies (time of day, volatility regimes)",
        "Event-driven (news, announcements)",
        "Cross-market correlations",
        "Machine learning approaches",
        "Options/derivatives signals",
      ],
    };
  }

  saveIdeas() {
    const dir = path.dirname(IDEAS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(IDEAS_FILE, JSON.stringify(this.ideas, null, 2));
  }

  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /**
   * Génère de nouvelles idées de stratégies
   * 
   * À customiser dans Cursor pour utiliser:
   * - Un appel LLM (Claude, GPT, etc.)
   * - Analyse de données de marché
   * - Scraping de sources d'alpha
   * 
   * Le contexte des stratégies existantes est disponible via this.getContext()
   */
  async generate() {
    console.log("🧠 Generating new strategy ideas...\n");
    
    // Affiche le contexte pour le générateur
    const context = this.getContext();
    console.log("📚 Stratégies existantes:");
    for (const s of context.existingStrategies) {
      console.log(`   - ${s.name}: ${s.features.join(", ") || "no features detected"}`);
    }
    console.log("");

    // ========================================
    // 🎯 CUSTOMISE ICI DANS CURSOR
    // ========================================
    // 
    // Remplace cette logique par ton propre générateur.
    // Exemple avec Claude API:
    //
    // const response = await anthropic.messages.create({
    //   model: "claude-3-sonnet",
    //   messages: [{
    //     role: "user",
    //     content: `Given these existing strategies: ${JSON.stringify(context.existingStrategies)}
    //               Generate a new unique trading strategy idea...`
    //   }]
    // });
    // const newIdea = parseResponse(response);
    //
    // ========================================

    const newIdeas = [
      // PLACEHOLDER - ton générateur remplace ceci
      {
        id: this.generateId(),
        timestamp: Date.now(),
        name: "placeholder_strategy",
        description: "Customize generate() in Cursor to create real ideas",
        logic: [
          "This is a placeholder",
          "Implement your LLM-based ideation here",
        ],
        dataSources: [],
        expectedEdge: "unknown",
        complexity: "low",
        status: "ready",  // "ready" = auto-implémenté par Tars
        implementedAt: null,
        testResults: null,
      }
    ];

    // Add new ideas (avoid duplicates)
    let added = 0;
    for (const idea of newIdeas) {
      const existsByName = this.ideas.ideas.some(i => i.name === idea.name);
      const existsInStrategies = this.existingStrategies.some(
        s => s.name.toLowerCase().includes(idea.name.toLowerCase())
      );
      
      if (!existsByName && !existsInStrategies) {
        this.ideas.ideas.push(idea);
        added++;
        console.log(`✅ New idea: ${idea.name}`);
        console.log(`   ${idea.description}`);
        console.log(`   Status: ${idea.status} (will be auto-implemented)\n`);
      } else {
        console.log(`⏭️ Skipped (already exists): ${idea.name}\n`);
      }
    }

    this.ideas.lastGenerated = Date.now();
    this.saveIdeas();

    console.log(`\n📊 Total: ${added} new idea(s) added`);
    return newIdeas.filter(i => !this.ideas.ideas.some(existing => existing.name === i.name && existing.id !== i.id));
  }

  /**
   * Liste les idées en attente d'implémentation
   */
  listPending() {
    const pending = this.ideas.ideas.filter(i => i.status === "pending");
    
    console.log("📋 Pending Strategy Ideas:\n");
    
    if (pending.length === 0) {
      console.log("   No pending ideas. Run 'generate' to create some.");
      return [];
    }

    for (const idea of pending) {
      console.log(`🔹 ${idea.name} (${idea.id})`);
      console.log(`   ${idea.description}`);
      console.log(`   Complexity: ${idea.complexity} | Expected edge: ${idea.expectedEdge}`);
      console.log(`   Created: ${new Date(idea.timestamp).toLocaleString()}`);
      console.log("");
    }

    return pending;
  }

  /**
   * Marque une idée comme implémentée
   */
  markImplemented(ideaId, strategyFile) {
    const idea = this.ideas.ideas.find(i => i.id === ideaId);
    if (idea) {
      idea.status = "testing";
      idea.implementedAt = Date.now();
      idea.strategyFile = strategyFile;
      this.saveIdeas();
    }
    return idea;
  }

  /**
   * Récupère la prochaine idée à implémenter (status = "ready")
   */
  getNextToImplement() {
    return this.ideas.ideas.find(i => i.status === "ready");
  }

  /**
   * Affiche le contexte complet
   */
  showContext() {
    const context = this.getContext();
    
    console.log("═".repeat(60));
    console.log("📚 CONTEXT FOR IDEATION");
    console.log("═".repeat(60));
    
    console.log("\n🔧 EXISTING STRATEGIES:\n");
    for (const s of context.existingStrategies) {
      console.log(`   ${s.name}`);
      console.log(`   └─ ${s.description || '(no description)'}`);
      console.log(`   └─ Features: ${s.features.join(", ") || "none detected"}`);
      console.log("");
    }
    
    console.log("💡 EXISTING IDEAS:\n");
    if (context.existingIdeas.length === 0) {
      console.log("   (none yet)");
    } else {
      for (const i of context.existingIdeas) {
        console.log(`   ${i.name} [${i.status}]`);
        console.log(`   └─ ${i.description}`);
        console.log("");
      }
    }
    
    console.log("🎯 SUGGESTIONS FOR NEW STRATEGIES:\n");
    for (const s of context.suggestions) {
      console.log(`   • ${s}`);
    }
    
    console.log("\n" + "═".repeat(60));
    
    return context;
  }
}

// CLI
async function main() {
  const agent = new IdeationAgent();
  const cmd = process.argv[2] || "list";

  switch (cmd) {
    case "generate":
      await agent.generate();
      break;
    case "list":
      agent.listPending();
      break;
    case "context":
      agent.showContext();
      break;
    case "next":
      const next = agent.getNextToImplement();
      if (next) {
        console.log(JSON.stringify(next, null, 2));
      } else {
        console.log("No ideas ready to implement.");
      }
      break;
    default:
      console.log("Commands: generate, list, context, next");
  }
}

main().catch(console.error);

module.exports = IdeationAgent;
