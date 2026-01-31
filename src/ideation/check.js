#!/usr/bin/env node
/**
 * IDEATION CHECK
 * 
 * Vérifie les idées pending et prépare le prompt pour Claude Code.
 * 
 * Usage:
 *   node src/ideation/check.js           - Affiche la prochaine idée à implémenter
 *   node src/ideation/check.js --all     - Liste toutes les idées pending
 *   node src/ideation/check.js --prompt  - Génère le prompt complet pour Claude Code
 *   node src/ideation/check.js --deps    - Vérifie uniquement les dépendances
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");

const IDEAS_FILE = path.join(__dirname, "../../data/ideas.json");
const DEPS_FILE = path.join(__dirname, "../../data/dependencies.json");
const TEMPLATE_FILE = path.join(__dirname, "../strategies/TEMPLATE.js");
const SKILL_FILE = path.join(__dirname, "SKILL.md");

class IdeationCheck {
  constructor() {
    this.ideas = this.loadIdeas();
    this.deps = this.loadDeps();
  }

  loadIdeas() {
    try {
      if (fs.existsSync(IDEAS_FILE)) {
        return JSON.parse(fs.readFileSync(IDEAS_FILE, "utf8"));
      }
    } catch (e) {
      console.error(`Failed to load ideas: ${e.message}`);
    }
    return { ideas: [] };
  }

  loadDeps() {
    try {
      if (fs.existsSync(DEPS_FILE)) {
        return JSON.parse(fs.readFileSync(DEPS_FILE, "utf8"));
      }
    } catch (e) {
      console.error(`Failed to load dependencies: ${e.message}`);
    }
    return { dataSources: {} };
  }

  /**
   * Get pending ideas sorted by alphaScore
   */
  getPendingIdeas() {
    return this.ideas.ideas
      .filter(i => i.status === "pending")
      .sort((a, b) => (b.alphaScore || 0) - (a.alphaScore || 0));
  }

  /**
   * Check dependencies for an idea
   * @returns {{ ok: boolean, missing: { packages: string[], envKeys: string[] }, available: string[] }}
   */
  checkDependencies(idea) {
    const result = {
      ok: true,
      missing: { packages: [], envKeys: [] },
      available: [],
      unknown: [],
    };

    for (const source of idea.dataSources || []) {
      const dep = this.deps.dataSources[source];
      
      if (!dep) {
        result.unknown.push(source);
        continue;
      }

      // Check package
      if (dep.package && !dep.installed) {
        result.missing.packages.push({ source, package: dep.package });
        result.ok = false;
      }

      // Check env keys
      for (const key of dep.envKeys || []) {
        if (!process.env[key]) {
          result.missing.envKeys.push({ source, key });
          // Don't set ok=false for env keys - strategy should handle gracefully
        }
      }

      if (dep.installed || !dep.package) {
        result.available.push(source);
      }
    }

    return result;
  }

  /**
   * Format dependency check result
   */
  formatDepsCheck(idea, depsResult) {
    let output = `\n📦 Dependencies for ${idea.name}:\n`;
    
    if (depsResult.available.length > 0) {
      output += `   ✅ Available: ${depsResult.available.join(", ")}\n`;
    }
    
    if (depsResult.missing.packages.length > 0) {
      output += `   ❌ Missing packages:\n`;
      for (const { source, package: pkg } of depsResult.missing.packages) {
        output += `      - ${source}: npm install ${pkg}\n`;
      }
    }
    
    if (depsResult.missing.envKeys.length > 0) {
      output += `   ⚠️  Missing env keys (optional - strategy should handle):\n`;
      for (const { source, key } of depsResult.missing.envKeys) {
        output += `      - ${source}: ${key}\n`;
      }
    }
    
    if (depsResult.unknown.length > 0) {
      output += `   ❓ Unknown sources: ${depsResult.unknown.join(", ")}\n`;
    }
    
    return output;
  }

  /**
   * Get the next idea to implement
   */
  getNextIdea() {
    const pending = this.getPendingIdeas();
    if (pending.length === 0) {
      return null;
    }

    // Find the first idea that can be implemented (deps available or installable)
    for (const idea of pending) {
      const depsCheck = this.checkDependencies(idea);
      // We allow ideas even with missing env keys - strategy handles gracefully
      if (depsCheck.missing.packages.length === 0) {
        return { idea, depsCheck };
      }
    }

    // Return highest score even if it needs packages installed
    return { idea: pending[0], depsCheck: this.checkDependencies(pending[0]) };
  }

  /**
   * Generate the full prompt for Claude Code
   */
  generatePrompt(idea, depsCheck) {
    const template = fs.existsSync(TEMPLATE_FILE) 
      ? fs.readFileSync(TEMPLATE_FILE, "utf8")
      : "// Template not found";
    
    const skill = fs.existsSync(SKILL_FILE)
      ? fs.readFileSync(SKILL_FILE, "utf8")
      : "// Skill not found";

    // Determine example files based on complexity
    let exampleFile = "baseline.js";
    if (idea.complexity === "medium") exampleFile = "sentiment-divergence.js";
    if (idea.complexity === "high") exampleFile = "cross-exchange-arb.js";

    const prompt = `# Implement Strategy: ${idea.name}

## Idea JSON

\`\`\`json
${JSON.stringify(idea, null, 2)}
\`\`\`

## Dependencies Status

${this.formatDepsCheck(idea, depsCheck)}

${depsCheck.missing.packages.length > 0 ? `
**Action required:** Install missing packages first:
\`\`\`bash
${depsCheck.missing.packages.map(p => `npm install ${p.package}`).join("\n")}
\`\`\`
` : ""}

## Instructions

1. Read the SKILL.md file: \`src/ideation/SKILL.md\`
2. Use the template: \`src/strategies/TEMPLATE.js\`
3. Reference example (${idea.complexity} complexity): \`src/strategies/${exampleFile}\`
4. Create: \`src/strategies/${idea.name.replace(/_/g, "-")}.js\`
5. Test: \`node -e "require('./src/strategies/${idea.name.replace(/_/g, "-")}.js')"\`
6. Mark implemented: \`node src/ideation/agent.js mark-implemented ${idea.id}\`

## Key Points

- **Entry rules:** ${idea.params?.entry || "See description"}
- **Exit rules:** ${idea.params?.exit || "See description"}
- **Risk sizing:** ${idea.params?.riskSizing || idea.params?.risk_sizing || "Kelly criterion"}
- **Data sources:** ${(idea.dataSources || []).join(", ")}

## Pseudo-code Reference

\`\`\`javascript
${idea.code || "// No pseudo-code provided"}
\`\`\`
`;

    return prompt;
  }

  /**
   * Display next idea info
   */
  showNext() {
    const result = this.getNextIdea();
    
    if (!result) {
      console.log("No pending ideas. Run 'npm run ideate' to generate some.");
      return;
    }

    const { idea, depsCheck } = result;
    
    console.log("\n" + "═".repeat(60));
    console.log("🧠 NEXT IDEA TO IMPLEMENT");
    console.log("═".repeat(60));
    console.log(`\nID: ${idea.id}`);
    console.log(`Name: ${idea.name}`);
    console.log(`AlphaScore: ${idea.alphaScore}/10`);
    console.log(`Complexity: ${idea.complexity}`);
    console.log(`\nDescription:\n${idea.description}`);
    console.log(this.formatDepsCheck(idea, depsCheck));
    
    if (depsCheck.ok || depsCheck.missing.packages.length === 0) {
      console.log("✅ Ready to implement!");
      console.log("\nRun with --prompt to get the full Claude Code prompt.");
    } else {
      console.log("⚠️  Install packages first, then implement.");
    }
    
    console.log("\n" + "═".repeat(60));
  }

  /**
   * List all pending ideas
   */
  showAll() {
    const pending = this.getPendingIdeas();
    
    console.log("\n" + "═".repeat(60));
    console.log(`🧠 PENDING IDEAS (${pending.length})`);
    console.log("═".repeat(60));
    
    if (pending.length === 0) {
      console.log("\nNo pending ideas.");
      return;
    }

    for (const idea of pending) {
      const depsCheck = this.checkDependencies(idea);
      const depsStatus = depsCheck.missing.packages.length === 0 ? "✅" : "⚠️";
      
      console.log(`\n${depsStatus} [${idea.alphaScore}/10] ${idea.name} (${idea.complexity})`);
      console.log(`   ${idea.description.slice(0, 80)}...`);
      console.log(`   Sources: ${(idea.dataSources || []).join(", ")}`);
    }
    
    console.log("\n" + "═".repeat(60));
  }

  /**
   * Show full prompt for Claude Code
   */
  showPrompt() {
    const result = this.getNextIdea();
    
    if (!result) {
      console.log("No pending ideas.");
      return;
    }

    const prompt = this.generatePrompt(result.idea, result.depsCheck);
    console.log(prompt);
  }

  /**
   * Check all dependencies
   */
  showDeps() {
    console.log("\n" + "═".repeat(60));
    console.log("📦 DEPENDENCY REGISTRY");
    console.log("═".repeat(60));
    
    for (const [name, dep] of Object.entries(this.deps.dataSources)) {
      const status = dep.installed ? "✅" : "❌";
      const pkg = dep.package ? `(${dep.package})` : "(REST API)";
      const keys = dep.envKeys?.length > 0 ? `[${dep.envKeys.join(", ")}]` : "";
      
      console.log(`${status} ${name} ${pkg} ${keys}`);
      if (dep.note) console.log(`   ${dep.note}`);
    }
    
    console.log("\n" + "═".repeat(60));
  }
}

// CLI
const check = new IdeationCheck();
const arg = process.argv[2];

switch (arg) {
  case "--all":
    check.showAll();
    break;
  case "--prompt":
    check.showPrompt();
    break;
  case "--deps":
    check.showDeps();
    break;
  default:
    check.showNext();
}

module.exports = IdeationCheck;
