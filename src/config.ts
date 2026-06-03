import { z } from "zod";

import { RuntimeConfigFile } from "./state/types.js";
import type { LogLevel } from "./observability/logger.js";
import idl from "./solana/program/dekant_pm.json" with { type: "json" };

const IDL_PROGRAM_ID: string | undefined =
  typeof (idl as { address?: unknown }).address === "string"
    ? ((idl as { address: string }).address)
    : undefined;

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  LOG_LEVEL: z
    .preprocess(
      (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
      z.enum(["debug", "info", "warn", "error", "silent"]).catch("info")
    )
    .default("info"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  ADMIN_SECRET: z.string().min(1),
  DATABASE_URL: z.string().min(1).optional(),
  DEKANT_BACKEND_URL: z.string().url(),
  PRICESERVICE_URL: z.string().url(),
  SOLANA_RPC_URL: z.string().url(),
  PROGRAM_ID: z.string().min(32).optional(),
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
  MIN_BOT_SOL: z.coerce.number().positive().default(0.1),
  VAULT_MINT_ALLOWLIST: z.string().default(""),
  STALE_PRICE_POLICY: z.enum(["skip", "allow"]).default("skip"),
  PRICE_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  PRICE_RETRY_COUNT: z.coerce.number().int().nonnegative().default(2),
  PRICE_RETRY_BACKOFF_MS: z.coerce.number().int().nonnegative().default(250),
  DEKANT_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(8_000),
  DEKANT_RETRY_COUNT: z.coerce.number().int().nonnegative().default(2),
  DEKANT_RETRY_BACKOFF_MS: z.coerce.number().int().nonnegative().default(300),
  FAUCET_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  FAUCET_RETRY_COUNT: z.coerce.number().int().nonnegative().default(1),
  FAUCET_RETRY_BACKOFF_MS: z.coerce.number().int().nonnegative().default(250)
});

export type EnvConfig = {
  nodeEnv: string;
  logLevel: LogLevel;
  host: string;
  port: number;
  adminSecret: string;
  databaseUrl: string | undefined;
  integration: {
    dekantBackendUrl: string;
    priceServiceUrl: string;
    solanaRpcUrl: string;
    dekantProgramId: string;
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
    vaultMintAllowlist: string[];
    stalePricePolicy: "skip" | "allow";
  };
  clientDefaults: {
    price: {
      requestTimeoutMs: number;
      retryCount: number;
      retryBackoffMs: number;
    };
    dekant: {
      requestTimeoutMs: number;
      retryCount: number;
      retryBackoffMs: number;
    };
    faucet: {
      requestTimeoutMs: number;
      retryCount: number;
      retryBackoffMs: number;
    };
  };
};

export type AppConfig = {
  nodeEnv: string;
  host: string;
  port: number;
  adminSecret: string;
  integration: {
    dekantBackendUrl: string;
    priceServiceUrl: string;
    solanaRpcUrl: string;
    dekantProgramId: string;
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
  clients: EnvConfig["clientDefaults"];
};

function parseMintList(raw: string): string[] {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}


export function loadEnvConfig(env: NodeJS.ProcessEnv = process.env): EnvConfig {
  const parsed = envSchema.parse(env);

  const dekantProgramId = parsed.PROGRAM_ID ?? IDL_PROGRAM_ID;
  if (!dekantProgramId) {
    throw new Error(
      "PROGRAM_ID is not set and IDL has no address — cannot resolve program id"
    );
  }

  return {
    nodeEnv: parsed.NODE_ENV,
    logLevel: parsed.LOG_LEVEL,
    host: parsed.HOST,
    port: parsed.PORT,
    adminSecret: parsed.ADMIN_SECRET,
    databaseUrl: parsed.DATABASE_URL,
    integration: {
      dekantBackendUrl: parsed.DEKANT_BACKEND_URL,
      priceServiceUrl: parsed.PRICESERVICE_URL,
      solanaRpcUrl: parsed.SOLANA_RPC_URL,
      dekantProgramId
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
      vaultMintAllowlist: parseMintList(parsed.VAULT_MINT_ALLOWLIST),
      stalePricePolicy: parsed.STALE_PRICE_POLICY
    },
    clientDefaults: {
      price: {
        requestTimeoutMs: parsed.PRICE_REQUEST_TIMEOUT_MS,
        retryCount: parsed.PRICE_RETRY_COUNT,
        retryBackoffMs: parsed.PRICE_RETRY_BACKOFF_MS
      },
      dekant: {
        requestTimeoutMs: parsed.DEKANT_REQUEST_TIMEOUT_MS,
        retryCount: parsed.DEKANT_RETRY_COUNT,
        retryBackoffMs: parsed.DEKANT_RETRY_BACKOFF_MS
      },
      faucet: {
        requestTimeoutMs: parsed.FAUCET_REQUEST_TIMEOUT_MS,
        retryCount: parsed.FAUCET_RETRY_COUNT,
        retryBackoffMs: parsed.FAUCET_RETRY_BACKOFF_MS
      }
    }
  };
}

export function buildAppConfig(env: EnvConfig, runtimeConfig: RuntimeConfigFile): AppConfig {
  return {
    nodeEnv: env.nodeEnv,
    host: env.host,
    port: env.port,
    adminSecret: env.adminSecret,
    integration: env.integration,
    vault: env.vault,
    botFleet: env.botFleet,
    intervals: env.intervals,
    runtime: runtimeConfig.config,
    clients: env.clientDefaults
  };
}
