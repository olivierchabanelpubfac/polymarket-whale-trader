#!/usr/bin/env node
/**
 * STRATEGY IDEATION AGENT
 * 
 * Génère des idées de nouvelles stratégies de trading via l'API Grok.
 * Prend en compte les stratégies existantes pour éviter les doublons.
 * Les idées sont auto-implémentées par Tars (pas de validation manuelle).
 * 
 * Usage:
 *   node src/ideation/agent.js generate  - Génère de nouvelles idées via Grok
 *   node src/ideation/agent.js list      - Liste les idées pending
 *   node src/ideation/agent.js next      - Récupère la prochaine idée à implémenter
 *   node src/ideation/agent.js context   - Affiche le contexte (stratégies existantes)
 * 
 * Requires: XAI_API_KEY in .env or environment
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");

const IDEAS_FILE = path.join(__dirname, "../../data/ideas.json");
const STRATEGIES_DIR = path.join(__dirname, "../strategies");

// Polymarket API pour récupérer les top events
const GAMMA_API = "https://gamma-api.polymarket.com";

class IdeationAgent {
  constructor() {
    this.ideas = this.loadIdeas();
  }

  /**
   * Fetch les top events actifs sur Polymarket pour contexte
   */
  async fetchTopEvents() {
    try {
      const resp = await fetch(
        `${GAMMA_API}/events?active=true&closed=false&order=volume&ascending=false&limit=10`
      );
      if (!resp.ok) return [];
      
      const events = await resp.json();
      return events.map(e => ({
        title: e.title,
        volume: e.volume,
        liquidity: e.liquidity,
        endDate: e.endDate,
      }));
    } catch (e) {
      console.error(`Failed to fetch events: ${e.message}`);
      return [];
    }
  }

  loadIdeas() {
    try {
      if (fs.existsSync(IDEAS_FILE)) {
        return JSON.parse(fs.readFileSync(IDEAS_FILE, "utf8"));
      }
    } catch (e) {}
    return { ideas: [], lastGenerated: null };
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
   * Parse les stratégies existantes dans src/strategies/
   * pour fournir le contexte à Grok
   */
  getExistingStrategies() {
    const strategies = [];
    
    try {
      const files = fs.readdirSync(STRATEGIES_DIR).filter(f => f.endsWith(".js"));
      
      for (const file of files) {
        const filePath = path.join(STRATEGIES_DIR, file);
        const content = fs.readFileSync(filePath, "utf8");
        
        // Extraire le nom de la stratégie
        const name = file.replace(".js", "");
        
        // Extraire la description du commentaire en-tête
        const headerMatch = content.match(/\/\*\*[\s\S]*?\*\//);
        let description = "";
        if (headerMatch) {
          description = headerMatch[0]
            .replace(/\/\*\*|\*\/|\*/g, "")
            .split("\n")
            .map(l => l.trim())
            .filter(l => l && !l.startsWith("@"))
            .join(" ")
            .trim();
        }
        
        // Extraire les variantes si c'est creative.js
        const variants = [];
        const variantsMatch = content.match(/variants\s*=\s*\[([\s\S]*?)\]/);
        if (variantsMatch) {
          const variantsList = variantsMatch[1].match(/"([^"]+)"/g);
          if (variantsList) {
            variants.push(...variantsList.map(v => v.replace(/"/g, "")));
          }
        }
        
        // Extraire les méthodes analyze*
        const methods = [];
        const methodMatches = content.matchAll(/analyze(\w+)\s*\(/g);
        for (const m of methodMatches) {
          methods.push(m[1].toLowerCase());
        }
        
        strategies.push({
          name,
          description: description.slice(0, 300),
          variants: variants.length > 0 ? variants : undefined,
          methods: methods.length > 0 ? methods : undefined,
        });
      }
    } catch (e) {
      console.error(`Error reading strategies: ${e.message}`);
    }
    
    // Ajouter aussi les idées déjà générées (pending ou implémentées)
    for (const idea of this.ideas.ideas) {
      strategies.push({
        name: idea.name,
        description: idea.description,
        status: idea.status,
      });
    }
    
    return strategies;
  }

  /**
   * Construit le prompt système pour Grok
   */
  buildSystemPrompt() {
    return `Tu es un AI trader expert en prediction markets sur Polymarket.

Génère des stratégies de trading innovantes basées sur:
- Arbitrage cross-exchange (Polymarket vs Kalshi vs Limitless)
- Sentiment analysis (X/Twitter, Fear & Greed, news flow)
- On-chain signals (whale movements, nouveau wallets, gas patterns)
- ML edges (momentum anomalies, mean-reversion timing, volatility clustering)

Focus sur les marchés à haute liquidité: US elections, crypto events, macro (Fed, inflation).

Pour chaque stratégie, fournis:
- name: snake_case identifier
- description: 2-3 phrases ultra-techniques (e.g., "Arb delta-neutral via Kalman filter sur odds drift")
- params: Entry/exit rules, risk sizing (Kelly criterion avec vol adj, max drawdown 2%)
- dataSources: APIs requises (polymarket_sdk, polygon_scan, x_sentiment, gamma_api, etc.)
- code: Pseudo-code JS pour implémentation
- alphaScore: 1-10 sur alpha potentiel (basé sur Sharpe hypothétique >1.5 = score 8+)
- complexity: low | medium | high

ÉVITE les strats overused:
- Simple mean-reversion sans edge timing
- Pure whale copy sans filtrage
- Basic momentum sans confirmation

Format STRICT - JSON array uniquement, pas de markdown:
[{"name":"...", "description":"...", "params":{...}, "dataSources":[...], "code":"...", "alphaScore":N, "complexity":"..."}]

IMPORTANT pour le champ "code":
- Utilise des guillemets doubles "..." PAS des backticks
- Écris le code sur UNE SEULE LIGNE
- Utilise ; pour séparer les statements
- Exemple: "code": "async function trade() { const odds = await getOdds(); if (odds.diff > 0.02) await buy(); }"`;
  }

  /**
   * Construit le prompt utilisateur avec le contexte des stratégies existantes
   */
  buildUserPrompt(existingStrategies, topEvents) {
    const currentDate = new Date().toISOString().split("T")[0];
    
    const strategiesList = existingStrategies
      .map(s => {
        let line = `- ${s.name}: ${s.description || "pas de description"}`;
        if (s.variants) line += ` (variantes: ${s.variants.join(", ")})`;
        if (s.status) line += ` [${s.status}]`;
        return line;
      })
      .join("\n");

    const eventsList = topEvents.length > 0
      ? topEvents.map(e => `- "${e.title}" (vol: $${Math.round(e.volume/1000)}k)`).join("\n")
      : "- Aucun event récupéré";

    return `Date: ${currentDate}

TOP EVENTS POLYMARKET (high volume):
${eventsList}

STRATÉGIES EXISTANTES (NE PAS reproduire):
${strategiesList}

SOURCES DE DONNÉES DISPONIBLES:
- polymarket_sdk: CLOB API, orderbook, positions, trades history
- gamma_api: Events, markets metadata, historical odds
- whale_positions: 7 tracked whales (positions, PnL, direction)
- polygon_scan: On-chain activity, wallet tracking, gas prices
- x_sentiment: Twitter/X sentiment via scraping ou API
- fear_greed: Crypto Fear & Greed Index
- cross_exchange: Kalshi, Limitless odds (arb detection)
- coingecko: Crypto prices, market cap, volume

Génère 3-5 stratégies ORIGINALES avec edge quantifiable.
Capital: ~$500, donc privilégie risk-adjusted returns.`;
  }

  /**
   * Appelle l'API Grok pour générer des idées
   */
  async callGrokAPI(systemPrompt, userPrompt) {
    const apiKey = process.env.XAI_API_KEY;
    
    if (!apiKey) {
      throw new Error("XAI_API_KEY environment variable is required");
    }

    const response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-4-1-fast-reasoning",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.85, // Créativité
        max_tokens: 4000, // Plus de tokens pour le pseudo-code
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Grok API error (${response.status}): ${error}`);
    }

    const data = await response.json();
    return data.choices[0]?.message?.content || "";
  }

  /**
   * Parse la réponse JSON de Grok
   */
  parseGrokResponse(response) {
    // Nettoyer la réponse (enlever markdown si présent)
    let cleaned = response.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/```json?\n?/g, "").replace(/```$/g, "").trim();
    }

    // Fix 1: Grok utilise parfois des backticks au lieu de guillemets pour code
    // Remplacer "code": `...` par "code": "..."
    cleaned = cleaned.replace(/"code":\s*`([^`]*)`/g, (match, code) => {
      const escaped = code
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\r?\n/g, " ")
        .replace(/\t/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return `"code": "${escaped}"`;
    });

    // Fix 2: Grok met parfois des newlines dans les strings "code" avec guillemets
    cleaned = cleaned.replace(/"code":\s*"([\s\S]*?)(?<!\\)"\s*,\s*"alphaScore"/g, (match, code) => {
      const escaped = code
        .replace(/\r?\n/g, " ")
        .replace(/\t/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return `"code": "${escaped}", "alphaScore"`;
    });

    try {
      const ideas = JSON.parse(cleaned);
      if (!Array.isArray(ideas)) {
        throw new Error("Response is not an array");
      }
      return ideas;
    } catch (e) {
      console.error("Failed to parse Grok response:", e.message);
      console.error("Raw response (first 500 chars):", response.slice(0, 500));
      return [];
    }
  }

  /**
   * Génère de nouvelles idées de stratégies via Grok
   */
  async generate() {
    console.log("Generating new strategy ideas via Grok...\n");

    // Charger les stratégies existantes
    const existingStrategies = this.getExistingStrategies();
    console.log(`Found ${existingStrategies.length} existing strategies/ideas`);

    // Fetch top events pour contexte real-time
    console.log("Fetching top Polymarket events...");
    const topEvents = await this.fetchTopEvents();
    console.log(`Found ${topEvents.length} active events\n`);

    // Construire les prompts
    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(existingStrategies, topEvents);

    // Appeler Grok
    console.log("Calling Grok API...\n");
    const response = await this.callGrokAPI(systemPrompt, userPrompt);

    // Parser la réponse
    const rawIdeas = this.parseGrokResponse(response);
    
    if (rawIdeas.length === 0) {
      console.log("No ideas generated. Check the API response.");
      return [];
    }

    // Transformer en format interne et ajouter
    const newIdeas = [];
    const existingNames = new Set(this.ideas.ideas.map(i => i.name));

    for (const raw of rawIdeas) {
      // Vérifier les doublons par nom
      if (existingNames.has(raw.name)) {
        console.log(`Skipping duplicate: ${raw.name}`);
        continue;
      }

      const idea = {
        id: this.generateId(),
        timestamp: Date.now(),
        name: raw.name,
        description: raw.description,
        params: raw.params || {},
        dataSources: raw.dataSources || [],
        code: raw.code || "",
        alphaScore: raw.alphaScore || 5,
        complexity: raw.complexity || "medium",
        status: "pending",
        implementedAt: null,
        testResults: null,
      };

      this.ideas.ideas.push(idea);
      newIdeas.push(idea);
      existingNames.add(idea.name);

      console.log(`[${idea.alphaScore}/10] ${idea.name}`);
      console.log(`   ${idea.description}`);
      console.log(`   Complexity: ${idea.complexity}`);
      console.log(`   Sources: ${idea.dataSources.join(", ")}`);
      if (idea.params.entry) console.log(`   Entry: ${idea.params.entry}`);
      if (idea.params.exit) console.log(`   Exit: ${idea.params.exit}`);
      console.log("");
    }

    this.ideas.lastGenerated = Date.now();
    this.saveIdeas();

    console.log(`Generated ${newIdeas.length} new ideas.`);
    return newIdeas;
  }

  /**
   * Liste les idées en attente d'implémentation
   */
  listPending() {
    const pending = this.ideas.ideas.filter(i => i.status === "pending");
    
    console.log("Pending Strategy Ideas:\n");
    
    if (pending.length === 0) {
      console.log("   No pending ideas. Run 'generate' to create some.");
      return [];
    }

    // Trier par alphaScore décroissant
    pending.sort((a, b) => (b.alphaScore || 0) - (a.alphaScore || 0));

    for (const idea of pending) {
      const score = idea.alphaScore || "?";
      console.log(`[${score}/10] ${idea.name} (${idea.id})`);
      console.log(`   ${idea.description}`);
      console.log(`   Complexity: ${idea.complexity}`);
      console.log(`   Sources: ${(idea.dataSources || []).join(", ")}`);
      
      if (idea.params) {
        if (idea.params.entry) console.log(`   Entry: ${idea.params.entry}`);
        if (idea.params.exit) console.log(`   Exit: ${idea.params.exit}`);
        if (idea.params.riskSizing) console.log(`   Risk: ${idea.params.riskSizing}`);
      }
      
      if (idea.code) {
        console.log(`   Code preview: ${idea.code.slice(0, 80)}...`);
      }
      
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
      idea.status = "implemented";
      idea.implementedAt = Date.now();
      idea.strategyFile = strategyFile;
      this.saveIdeas();
      console.log(`Marked ${idea.name} as implemented (${strategyFile})`);
    } else {
      console.error(`Idea not found: ${ideaId}`);
    }
    return idea;
  }

  /**
   * Marque une idée comme en cours d'implémentation
   */
  markImplementing(ideaId) {
    const idea = this.ideas.ideas.find(i => i.id === ideaId);
    if (idea) {
      idea.status = "implementing";
      idea.implementingStartedAt = Date.now();
      this.saveIdeas();
      console.log(`Marked ${idea.name} as implementing`);
    } else {
      console.error(`Idea not found: ${ideaId}`);
    }
    return idea;
  }

  /**
   * Marque une idée comme bloquée (dépendances manquantes)
   */
  markBlocked(ideaId, reason) {
    const idea = this.ideas.ideas.find(i => i.id === ideaId);
    if (idea) {
      idea.status = "blocked";
      idea.blockedAt = Date.now();
      idea.blockedReason = reason;
      this.saveIdeas();
      console.log(`Marked ${idea.name} as blocked: ${reason}`);
    } else {
      console.error(`Idea not found: ${ideaId}`);
    }
    return idea;
  }

  /**
   * Marque une idée comme échouée
   */
  markFailed(ideaId, error) {
    const idea = this.ideas.ideas.find(i => i.id === ideaId);
    if (idea) {
      idea.status = "failed";
      idea.failedAt = Date.now();
      idea.failedError = error;
      this.saveIdeas();
      console.log(`Marked ${idea.name} as failed: ${error}`);
    } else {
      console.error(`Idea not found: ${ideaId}`);
    }
    return idea;
  }

  /**
   * Remet une idée en pending (reset)
   */
  markPending(ideaId) {
    const idea = this.ideas.ideas.find(i => i.id === ideaId);
    if (idea) {
      idea.status = "pending";
      delete idea.implementingStartedAt;
      delete idea.blockedAt;
      delete idea.blockedReason;
      delete idea.failedAt;
      delete idea.failedError;
      this.saveIdeas();
      console.log(`Reset ${idea.name} to pending`);
    } else {
      console.error(`Idea not found: ${ideaId}`);
    }
    return idea;
  }

  /**
   * Récupère la prochaine idée à implémenter (la plus ancienne pending avec le meilleur score)
   */
  getNextToImplement() {
    return this.ideas.ideas
      .filter(i => i.status === "pending")
      .sort((a, b) => (b.alphaScore || 0) - (a.alphaScore || 0))[0];
  }

  /**
   * Affiche le contexte complet (pour debug)
   */
  showContext() {
    const strategies = this.getExistingStrategies();
    
    console.log("=".repeat(60));
    console.log("CONTEXT FOR IDEATION");
    console.log("=".repeat(60));
    
    console.log("\nEXISTING STRATEGIES:\n");
    for (const s of strategies.filter(s => !s.status)) {
      console.log(`   ${s.name}`);
      console.log(`   └─ ${s.description || '(no description)'}`);
      if (s.variants) console.log(`   └─ Variants: ${s.variants.join(", ")}`);
      console.log("");
    }
    
    console.log("EXISTING IDEAS:\n");
    const ideas = strategies.filter(s => s.status);
    if (ideas.length === 0) {
      console.log("   (none yet)");
    } else {
      for (const i of ideas) {
        console.log(`   ${i.name} [${i.status}]`);
        console.log(`   └─ ${i.description}`);
        console.log("");
      }
    }
    
    console.log("=".repeat(60));
  }
}

// CLI
async function main() {
  const agent = new IdeationAgent();
  const cmd = process.argv[2] || "list";
  const arg1 = process.argv[3];
  const arg2 = process.argv[4];

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
        console.log("No pending ideas to implement.");
      }
      break;
      
    case "mark-implemented":
      if (!arg1) {
        console.log("Usage: node agent.js mark-implemented <ideaId> [strategyFile]");
        process.exit(1);
      }
      agent.markImplemented(arg1, arg2 || `src/strategies/${arg1}.js`);
      break;
      
    case "mark-implementing":
      if (!arg1) {
        console.log("Usage: node agent.js mark-implementing <ideaId>");
        process.exit(1);
      }
      agent.markImplementing(arg1);
      break;
      
    case "mark-blocked":
      if (!arg1 || !arg2) {
        console.log("Usage: node agent.js mark-blocked <ideaId> <reason>");
        process.exit(1);
      }
      agent.markBlocked(arg1, arg2);
      break;
      
    case "mark-failed":
      if (!arg1 || !arg2) {
        console.log("Usage: node agent.js mark-failed <ideaId> <error>");
        process.exit(1);
      }
      agent.markFailed(arg1, arg2);
      break;
      
    case "mark-pending":
      if (!arg1) {
        console.log("Usage: node agent.js mark-pending <ideaId>");
        process.exit(1);
      }
      agent.markPending(arg1);
      break;
      
    default:
      console.log(`
Strategy Ideation Agent

Commands:
  generate          Generate new strategy ideas via Grok
  list              List pending ideas
  next              Get next idea to implement (JSON)
  context           Show existing strategies context
  
Status management:
  mark-implementing <id>           Mark idea as being implemented
  mark-implemented <id> [file]     Mark idea as implemented
  mark-blocked <id> <reason>       Mark idea as blocked (deps missing)
  mark-failed <id> <error>         Mark idea as failed
  mark-pending <id>                Reset idea to pending
      `);
  }
}

main().catch(console.error);

module.exports = IdeationAgent;
