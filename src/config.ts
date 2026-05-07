import { z } from "zod";

import { RuntimeConfigFile } from "./state/types.js";

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  ADMIN_SECRET: z.string().min(1),
  STATE_DIR: z.string().min(1).default("state"),
  DEKANT_BACKEND_URL: z.string().url(),
  PRICESERVICE_URL: z.string().url(),
  VAULT_SECRET_KEY: z.string().min(1),
  BOT_COUNTS: z.coerce.number().int().positive().default(5),
  MARKET_REFRESH_INTERVAL_MS: z.coerce.number().int().positive().default(3_600_000),
  BUY_INTERVAL_MS: z.coerce.number().int().positive().default(1_200_000),
  SELL_INTERVAL_MS: z.coerce.number().int().positive().default(3_600_000),
  FUNDING_INTERVAL_MS: z.coerce.number().int().positive().default(3_600_000),
  INITIAL_FUNDING_DELAY_MS: z.coerce.number().int().nonnegative().default(30_000),
  BUY_CHANCE: z.coerce.number().min(0).max(100).default(90),
  SELL_CHANCE: z.coerce.number().min(0).max(100).default(35),
  MAX_AMOUNT: z.coerce.number().positive().default(1_000),
  PREFUND_MULTIPLIER: z.coerce.number().positive().default(10),
  EMERGENCY_TOPUP_COOLDOWN_MS: z.coerce.number().int().positive().default(300_000),
  MIN_BOT_SOL: z.coerce.number().positive().default(0.01),
  VAULT_SUPPORTED_TOKENS: z.string().default("USDT,USDC"),
  STALE_PRICE_POLICY: z.enum(["skip", "allow"]).default("skip")
});

export type EnvConfig = {
  nodeEnv: string;
  host: string;
  port: number;
  adminSecret: string;
  stateDir: string;
  integration: {
    dekantBackendUrl: string;
    priceServiceUrl: string;
  };
  vault: {
    secretKey: string;
  };
  botFleet: {
    initialBotCount: number;
  };
  intervals: {
    marketRefreshMs: number;
    buyMs: number;
    sellMs: number;
    fundingMs: number;
    initialFundingDelayMs: number;
  };
  runtimeDefaults: {
    buyChance: number;
    sellChance: number;
    maxAmount: number;
    prefundMultiplier: number;
    emergencyTopupCooldownMs: number;
    minBotSol: number;
    vaultSupportedTokens: string[];
    stalePricePolicy: "skip" | "allow";
  };
};

export type AppConfig = {
  nodeEnv: string;
  host: string;
  port: number;
  adminSecret: string;
  stateDir: string;
  integration: {
    dekantBackendUrl: string;
    priceServiceUrl: string;
  };
  vault: {
    secretKey: string;
  };
  botFleet: {
    initialBotCount: number;
  };
  intervals: {
    marketRefreshMs: number;
    buyMs: number;
    sellMs: number;
    fundingMs: number;
    initialFundingDelayMs: number;
  };
  runtime: RuntimeConfigFile["config"];
};

function parseTokenList(raw: string): string[] {
  return raw
    .split(",")
    .map((token) => token.trim().toUpperCase())
    .filter((token) => token.length > 0);
}

export function loadEnvConfig(env: NodeJS.ProcessEnv = process.env): EnvConfig {
  const parsed = envSchema.parse(env);

  return {
    nodeEnv: parsed.NODE_ENV,
    host: parsed.HOST,
    port: parsed.PORT,
    adminSecret: parsed.ADMIN_SECRET,
    stateDir: parsed.STATE_DIR,
    integration: {
      dekantBackendUrl: parsed.DEKANT_BACKEND_URL,
      priceServiceUrl: parsed.PRICESERVICE_URL
    },
    vault: {
      secretKey: parsed.VAULT_SECRET_KEY
    },
    botFleet: {
      initialBotCount: parsed.BOT_COUNTS
    },
    intervals: {
      marketRefreshMs: parsed.MARKET_REFRESH_INTERVAL_MS,
      buyMs: parsed.BUY_INTERVAL_MS,
      sellMs: parsed.SELL_INTERVAL_MS,
      fundingMs: parsed.FUNDING_INTERVAL_MS,
      initialFundingDelayMs: parsed.INITIAL_FUNDING_DELAY_MS
    },
    runtimeDefaults: {
      buyChance: parsed.BUY_CHANCE,
      sellChance: parsed.SELL_CHANCE,
      maxAmount: parsed.MAX_AMOUNT,
      prefundMultiplier: parsed.PREFUND_MULTIPLIER,
      emergencyTopupCooldownMs: parsed.EMERGENCY_TOPUP_COOLDOWN_MS,
      minBotSol: parsed.MIN_BOT_SOL,
      vaultSupportedTokens: parseTokenList(parsed.VAULT_SUPPORTED_TOKENS),
      stalePricePolicy: parsed.STALE_PRICE_POLICY
    }
  };
}

export function buildAppConfig(env: EnvConfig, runtimeConfig: RuntimeConfigFile): AppConfig {
  return {
    nodeEnv: env.nodeEnv,
    host: env.host,
    port: env.port,
    adminSecret: env.adminSecret,
    stateDir: env.stateDir,
    integration: env.integration,
    vault: env.vault,
    botFleet: env.botFleet,
    intervals: env.intervals,
    runtime: runtimeConfig.config
  };
}
