import type { AppConfig } from "../../src/config.js";

export function createTestAppConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: "test",
    host: "127.0.0.1",
    port: 0,
    adminSecret: "test-secret",
    botKeyGuard: "terces-tset",
    integration: {
      dekantBackendUrl: "https://backend.example.com",
      priceServiceUrl: "https://prices.example.com",
      solanaRpcUrl: "https://rpc.example.com",
      dekantProgramId: "11111111111111111111111111111111",
      idlProgramId: "11111111111111111111111111111111",
      programIdSource: "idl"
    },
    vault: {
      secretKey: "vault-secret"
    },
    botFleet: {
      initialBotCount: 2
    },
    intervals: {
      marketRefreshMs: 3_600_000,
      tradeMs: 1_200_000,
      schedulerTickMs: 10_000,
      buyMs: 1_200_000,
      sellMs: 3_600_000,
      fundingMs: 3_600_000,
      initialFundingDelayMs: 30_000
    },
    runtime: {
      ignoredMarketIds: [],
      marketIntervals: {},
      trading: {
        buyChance: 90,
        sellChance: 35,
        maxAmount: 1000,
        prefundMultiplier: 10
      },
      funding: {
        emergencyTopupCooldownMs: 300_000,
        minBotSol: 0.01,
        vaultSupportedMints: ["USDT", "USDC"]
      },
      price: {
        stalePricePolicy: "skip"
      }
    },
    clients: {
      price: {
        requestTimeoutMs: 5_000,
        retryCount: 2,
        retryBackoffMs: 250
      },
      dekant: {
        requestTimeoutMs: 8_000,
        retryCount: 2,
        retryBackoffMs: 300
      },
      faucet: {
        requestTimeoutMs: 5_000,
        retryCount: 1,
        retryBackoffMs: 250
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
    DEKANT_BACKEND_URL: "https://backend.example.com",
    PRICESERVICE_URL: "https://prices.example.com",
    SOLANA_RPC_URL: "https://rpc.example.com",
    PROGRAM_ID: "11111111111111111111111111111111",
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
    VAULT_MINT_ALLOWLIST: "",
    STALE_PRICE_POLICY: "skip",
    PRICE_REQUEST_TIMEOUT_MS: "5000",
    PRICE_RETRY_COUNT: "2",
    PRICE_RETRY_BACKOFF_MS: "250",
    DEKANT_REQUEST_TIMEOUT_MS: "8000",
    DEKANT_RETRY_COUNT: "2",
    DEKANT_RETRY_BACKOFF_MS: "300",
    FAUCET_REQUEST_TIMEOUT_MS: "5000",
    FAUCET_RETRY_COUNT: "1",
    FAUCET_RETRY_BACKOFF_MS: "250",
    ...overrides
  };
}
