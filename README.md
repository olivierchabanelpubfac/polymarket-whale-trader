# 🐋 Polymarket Whale Trader

Automated trading bot for Polymarket that combines whale tracking with technical analysis.

## Strategy

The bot uses a multi-signal approach with weighted scoring:

| Signal | Weight | Description |
|--------|--------|-------------|
| **Whale Consensus** | 50% | Tracks 7 top traders, weighted by portfolio size and win rate |
| **Momentum** | 20% | Multi-timeframe momentum (5m, 15m, 1h, 4h) |
| **Technicals** | 15% | RSI and MA crossovers |
| **Sentiment** | 15% | Fear & Greed Index (contrarian) |

### Position Sizing

Uses Kelly Criterion with safety factor:
- Kelly fraction: 25% (conservative)
- Max bet: 10% of bankroll
- Hard cap: $50 per trade

### Whales Tracked

| Name | Address | Weight | Notes |
|------|---------|--------|-------|
| sharp_1 | 0xd218... | 1.3x | 65% win rate ⭐ |
| MCgenius | 0x0b9c... | 1.2x | $4.5M portfolio |
| gmanas | 0xe90b... | 1.1x | Diversified |
| kch123 | 0x6a72... | 1.0x | Big bets |
| 432614799197 | 0xdc87... | 0.9x | $1.8M |
| gopatriots | 0xe20a... | 0.8x | Sports focus |
| unnamed_3 | 0x006c... | 0.7x | Smaller positions |

## Usage

```bash
# Install dependencies
npm install

# Scan signals only (no trading)
npm run scan

# Run trading cycle
npm run trade

# Or directly
node src/index.js scan
node src/index.js trade
```

## Configuration

Edit `src/config.js` to adjust:
- Signal weights
- Position sizing parameters
- Minimum edge threshold
- Whale list and trust weights

## Requirements

- Node.js 18+
- Polymarket wallet with USDC.e on Polygon
- Private key in `~/.config/clawd/secrets.env`

## Approvals Required

Before trading, approve USDC.e for these contracts:
- CTF Exchange: `0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E`
- Neg Risk CTF: `0xC5d563A36AE78145C45a50134d48A1215220f80a`
- Neg Risk Adapter: `0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296`

And setApprovalForAll on CT contract `0x4D97DCd97eC945f40cF65F87097ACe5EA0476045`.

## License

MIT
