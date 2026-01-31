/**
 * Configuration for Whale Trader
 */

module.exports = {
  // Bot version - increment on significant changes
  VERSION: "1.4.0",
  
  // Changelog:
  // 1.0.0 - Initial release (whale consensus + momentum + technicals + sentiment)
  // 1.1.0 - Paper trading, strategy lab, TP/SL 30%, max 3 positions, 5min cron
  // 1.2.0 - Insider Tracker: new wallet cluster detection, Bayesian aggregation, delayed entry
  // 1.3.0 - Cross-Exchange Arb: Polymarket/Kalshi/Limitless spread detection, delta-neutral, risk mgmt
  // 1.4.0 - Grok Ideation Agent + Sentiment Divergence strategy (AI-generated)

  // Polymarket APIs
  CLOB_HOST: "https://clob.polymarket.com",
  GAMMA_HOST: "https://gamma-api.polymarket.com",
  DATA_HOST: "https://data-api.polymarket.com",
  CHAIN_ID: 137,

  // Trading params
  MAX_POSITION_SIZE: 50,      // Max $ per trade
  MIN_EDGE: 0.08,             // 8% minimum edge to trade
  MIN_CONFIDENCE: 0.6,        // 60% confidence threshold
  
  // Execution params
  PRICE_SLIPPAGE: 0.02,       // Accept 2% slippage for faster fills
  USE_AGGRESSIVE_PRICING: true, // Buy at ask + slippage, sell at bid - slippage
  MAX_OPEN_POSITIONS: 3,      // Max 3 positions simultanées
  
  // Signal weights (must sum to 1.0)
  WEIGHTS: {
    WHALE_CONSENSUS: 0.50,    // 50% whale signals
    MOMENTUM: 0.20,           // 20% price momentum
    TECHNICALS: 0.15,         // 15% RSI, etc.
    SENTIMENT: 0.15,          // 15% fear/greed
  },

  // Whales to track (address -> config)
  WHALES: {
    "0x0b9cae2b0dfe7a71c413e0604eaac1c352f87e44": {
      name: "MCgenius",
      weight: 1.2,  // Higher weight = more trusted
      minPosition: 10000,
    },
    "0x6a72f61820b26b1fe4d956e17b6dc2a1ea3033ee": {
      name: "kch123",
      weight: 1.0,
      minPosition: 5000,
    },
    "0xe90bec87d9ef430f27f9dcfe72c34b76967d5da2": {
      name: "gmanas",
      weight: 1.1,
      minPosition: 5000,
    },
    "0xdc876e6873772d38716fda7f2452a78d426d7ab6": {
      name: "432614799197",
      weight: 0.9,
      minPosition: 5000,
    },
    "0xd218e474776403a330142299f7796e8ba32eb5c9": {
      name: "sharp_1",
      weight: 1.3,  // 65% win rate - highest trust
      minPosition: 1000,
    },
    "0xe20a1538293903b746ffe6c4ce2d5c3c0300e469": {
      name: "gopatriots",
      weight: 0.8,
      minPosition: 5000,
    },
    "0x006cc834cc092684f1b56626e23bedb3835c16ea": {
      name: "unnamed_3",
      weight: 0.7,
      minPosition: 2000,
    },
  },

  // Kelly Criterion settings
  KELLY_FRACTION: 0.25,  // Use 25% of Kelly for safety
  MAX_KELLY_BET: 0.1,    // Never bet more than 10% of bankroll

  // Exit targets (relative to entry)
  TAKE_PROFIT_PCT: 0.30,   // Exit when up 30% from entry price
  STOP_LOSS_PCT: 0.30,     // Exit when down 30% from entry price
  
  // Or absolute targets
  TAKE_PROFIT_PRICE: null, // Set specific price target (overrides PCT)
  STOP_LOSS_PRICE: null,   // Set specific stop price (overrides PCT)
};
