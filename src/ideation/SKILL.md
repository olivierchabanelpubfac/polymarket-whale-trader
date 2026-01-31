# Strategy Implementation Skill

Implémente une idée de stratégie de trading en fichier JavaScript exécutable.

## Déclencheurs

Utilise cette skill quand :
- On te demande d'implémenter une idée de `data/ideas.json`
- Tu reçois un JSON d'idée avec `name`, `description`, `params`, `dataSources`, `code`
- La commande `npm run idea-next` retourne une idée à implémenter

## Workflow

### 1. Analyser l'idée

L'idée JSON contient :
```json
{
  "id": "abc123",
  "name": "strategy_name",
  "description": "Description technique...",
  "params": {
    "entry": "Conditions d'entrée",
    "exit": "Conditions de sortie",
    "riskSizing": "Règles de sizing"
  },
  "dataSources": ["polymarket_sdk", "whale_positions", ...],
  "code": "Pseudo-code JS...",
  "alphaScore": 8,
  "complexity": "medium"
}
```

### 2. Vérifier les dépendances

Lire `data/dependencies.json` et vérifier chaque `dataSource` de l'idée :

```javascript
// Exemple de vérification
const deps = require("../../data/dependencies.json");
for (const source of idea.dataSources) {
  const dep = deps.dataSources[source];
  if (!dep) {
    console.warn(`Unknown dataSource: ${source}`);
    continue;
  }
  if (dep.package && !dep.installed) {
    // Installer le package
    // npm install <package>
  }
  if (dep.envKeys.length > 0) {
    // Log warning - la stratégie doit gérer gracieusement
  }
}
```

**Actions requises :**
- Si `package` non installé → `npm install <package>` puis mettre `installed: true`
- Si `envKeys` manquantes → la stratégie doit vérifier au runtime et HOLD si absent

### 3. Créer le fichier stratégie

**Chemin** : `src/strategies/{idea.name}.js` (remplacer `_` par `-`)

**Template** : Utiliser `src/strategies/TEMPLATE.js` comme base

**Exemples de référence par complexité** :
- `low` : `baseline.js` (simple aggregation)
- `medium` : `sentiment-divergence.js` (API calls + logic)
- `high` : `cross-exchange-arb.js` (multi-source + state management)

### 4. Implémenter la logique

#### Header obligatoire
```javascript
/**
 * STRATEGY: {NAME en majuscules}
 * 
 * Generated from idea: {id}
 * AlphaScore: {alphaScore}/10 | Complexity: {complexity}
 * 
 * {description}
 * 
 * Entry: {params.entry}
 * Exit: {params.exit}
 * Risk: {params.riskSizing}
 */
```

#### Classe obligatoire
```javascript
class {ClassName}Strategy {
  constructor() {
    this.name = "{snake_case_name}";  // DOIT matcher idea.name
    this.description = "{description courte}";
  }

  async analyze(marketSlug) {
    // Vérifier dépendances
    if (!this.checkDependencies()) {
      return this.holdResponse("Missing dependencies");
    }
    
    // Implémenter la logique de l'idée
    // ...
    
    return {
      strategy: `creative:${this.name}`,
      score,        // -1 to 1
      confidence,   // 0 to 1
      recommendation: { action, reason },
      reason,
    };
  }
}

module.exports = {ClassName}Strategy;
```

#### Gestion des dépendances manquantes
```javascript
checkDependencies() {
  const required = ["API_KEY_1", "API_KEY_2"];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.warn(`  ${this.name}: Missing env vars: ${missing.join(", ")}`);
    return false;
  }
  return true;
}

holdResponse(reason) {
  return {
    strategy: `creative:${this.name}`,
    score: 0,
    confidence: 0,
    recommendation: { action: "HOLD", reason },
    reason,
  };
}
```

### 5. Tester le require

```bash
node -e "const S = require('./src/strategies/{name}.js'); const s = new S(); console.log(s.name, s.description);"
```

Doit afficher le nom et la description sans erreur.

### 6. Marquer comme implémentée

```javascript
const IdeationAgent = require("./src/ideation/agent");
const agent = new IdeationAgent();
agent.markImplemented("{idea.id}", "src/strategies/{name}.js");
```

Ou via CLI : `node src/ideation/agent.js mark-implemented {idea.id}`

### 7. Commit

```bash
git add src/strategies/{name}.js data/dependencies.json
git commit -m "feat(strategy): implement {name} from idea {id}"
```

## Actions valides

- `BUY_UP` : Acheter le outcome "Yes" / "Up"
- `BUY_DOWN` : Acheter le outcome "No" / "Down"  
- `HOLD` : Ne pas trader

## Conventions

- **Nommage fichier** : `{idea.name}.js` avec `_` → `-` (ex: `cross_exchange_arb` → `cross-exchange-arb.js`)
- **Nommage classe** : PascalCase + `Strategy` (ex: `CrossExchangeArbStrategy`)
- **Nommage this.name** : snake_case exact de l'idée (ex: `cross_exchange_arb`)
- **State file** : `data/{name}-state.json` si persistence nécessaire
- **Logs** : Préfixer avec `${this.name}:` pour debug

## Checklist finale

- [ ] Fichier créé dans `src/strategies/`
- [ ] Header avec metadata de l'idée
- [ ] `this.name` matche `idea.name`
- [ ] `async analyze(marketSlug)` implémenté
- [ ] Retourne le format correct `{ strategy, score, confidence, recommendation, reason }`
- [ ] Gère les deps manquantes (return HOLD)
- [ ] `module.exports` exporte la classe
- [ ] Test `node -e "require('./src/strategies/{name}.js')"` passe
- [ ] Idée marquée `implemented` dans `ideas.json`
- [ ] Commit effectué
