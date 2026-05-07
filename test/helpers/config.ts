import type { AppConfig } from "../../src/config.js";

export function createTestAppConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: "test",
    host: "127.0.0.1",
    port: 0,
    stateDir: "state",
    adminSecret: "test-secret",
    integration: {
      dekantBackendUrl: "https://backend.example.com",
      priceServiceUrl: "https://prices.example.com"
    },
    vault: {
      secretKey: "vault-secret"
    },
    botFleet: {
      initialBotCount: 2
    },
    intervals: {
      marketRefreshMs: 3_600_000,
      buyMs: 1_200_000,
      sellMs: 3_600_000,
      fundingMs: 3_600_000,
      initialFundingDelayMs: 30_000
    },
    runtime: {
      ignoredMarketIds: [],
      trading: {
        buyChance: 90,
        sellChance: 35,
        maxAmount: 1000,
        prefundMultiplier: 10
      },
      funding: {
        emergencyTopupCooldownMs: 300_000,
        minBotSol: 0.01,
        vaultSupportedTokens: ["USDT", "USDC"]
      },
      price: {
        stalePricePolicy: "skip"
      }
    },
    ...overrides
  };
}

export function createBaseEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: "3000",
    ADMIN_SECRET: "test-secret",
    STATE_DIR: "state",
    DEKANT_BACKEND_URL: "https://backend.example.com",
    PRICESERVICE_URL: "https://prices.example.com",
    VAULT_SECRET_KEY: "vault-secret",
    BOT_COUNTS: "2",
    MARKET_REFRESH_INTERVAL_MS: "3600000",
    BUY_INTERVAL_MS: "1200000",
    SELL_INTERVAL_MS: "3600000",
    FUNDING_INTERVAL_MS: "3600000",
    INITIAL_FUNDING_DELAY_MS: "30000",
    BUY_CHANCE: "90",
    SELL_CHANCE: "35",
    MAX_AMOUNT: "1000",
    PREFUND_MULTIPLIER: "10",
    EMERGENCY_TOPUP_COOLDOWN_MS: "300000",
    MIN_BOT_SOL: "0.01",
    VAULT_SUPPORTED_TOKENS: "USDT,USDC",
    STALE_PRICE_POLICY: "skip",
    ...overrides
  };
}
