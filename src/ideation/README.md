# 🧠 Strategy Ideation Agent

Ce module génère des idées de nouvelles stratégies de trading.

## Usage

```bash
# Générer de nouvelles idées
npm run ideate

# Voir les idées en attente
npm run ideas
```

## Output Format

Les idées sont stockées dans `data/ideas.json` :

```json
{
  "ideas": [
    {
      "id": "abc123",
      "timestamp": 1234567890,
      "name": "sentiment_divergence",
      "description": "Trade when social sentiment diverges from price action",
      "logic": [
        "Fetch Twitter/Reddit sentiment for BTC",
        "Compare to 1h price momentum",
        "If sentiment bullish but price falling → contrarian buy",
        "If sentiment bearish but price rising → contrarian sell"
      ],
      "dataSources": ["twitter", "reddit", "coingecko"],
      "expectedEdge": "5-10%",
      "complexity": "medium",
      "status": "pending",  // pending | implementing | testing | live | rejected
      "implementedAt": null,
      "testResults": null
    }
  ]
}
```

## Ideation Prompts

L'agent peut utiliser ces angles pour générer des idées :
- Nouvelles sources de données (social, on-chain, macro)
- Combinaisons de signaux existants
- Timing strategies (time of day, day of week)
- Event-driven (earnings, announcements)
- Cross-market correlations
- Contrarian angles
- Machine learning approaches

## Integration avec Tars

Tars lit ce fichier via un cron et :
1. Sélectionne les idées "pending" les plus prometteuses
2. Implémente la stratégie dans `strategies/`
3. L'ajoute au Strategy Lab pour paper testing
4. Met à jour le status → "testing"
5. Après N trades, évalue les résultats
