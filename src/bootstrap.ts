import { PublicKey } from "@solana/web3.js";
import { EnvConfig, loadEnvConfig } from "./config.js";
import type { StructuredLogger } from "./observability/logger.js";
import { BotRecord, BotsStateFile, RuntimeConfigFile } from "./state/types.js";
import type { StateStore } from "./storage/state-store.js";

function isValidSolanaAddress(address: string): boolean {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

function pruneInvalidBots(
  state: BotsStateFile,
  logger?: StructuredLogger
): { state: BotsStateFile; pruned: BotRecord[] } {
  const valid: BotRecord[] = [];
  const pruned: BotRecord[] = [];
  for (const bot of state.bots) {
    if (isValidSolanaAddress(bot.publicKey)) {
      valid.push(bot);
    } else {
      pruned.push(bot);
    }
  }
  if (pruned.length > 0) {
    logger?.warn?.("bots_state_pruned_invalid", {
      pruned: pruned.length,
      remaining: valid.length,
      botIds: pruned.map((bot) => bot.id)
    });
  }
  return {
    state: pruned.length === 0 ? state : { ...state, bots: valid },
    pruned
  };
}

export function makeInitialRuntimeConfig(envConfig: EnvConfig): RuntimeConfigFile {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    config: {
      ignoredMarketIds: [],
      trading: {
        buyChance: envConfig.runtimeDefaults.buyChance,
        sellChance: envConfig.runtimeDefaults.sellChance,
        maxAmount: envConfig.runtimeDefaults.maxAmount,
        prefundMultiplier: envConfig.runtimeDefaults.prefundMultiplier
      },
      funding: {
        emergencyTopupCooldownMs: envConfig.runtimeDefaults.emergencyTopupCooldownMs,
        minBotSol: envConfig.runtimeDefaults.minBotSol,
        vaultSupportedMints: envConfig.runtimeDefaults.vaultSupportedMints
      },
      price: {
        stalePricePolicy: envConfig.runtimeDefaults.stalePricePolicy
      }
    }
  };
}

export type BootstrapState = {
  runtimeConfig: RuntimeConfigFile;
  botsState: BotsStateFile;
  store: StateStore;
};

export async function bootstrapState(
  env: NodeJS.ProcessEnv = process.env,
  store?: StateStore,
  logger?: StructuredLogger
): Promise<{
  envConfig: ReturnType<typeof loadEnvConfig>;
  state: BootstrapState;
}> {
  const envConfig = loadEnvConfig(env);
  logger?.debug?.("env_config_loaded", {
    nodeEnv: envConfig.nodeEnv,
    logLevel: envConfig.logLevel,
    host: envConfig.host,
    port: envConfig.port,
    initialBotCount: envConfig.botFleet.initialBotCount
  });

  if (!store) {
    if (!envConfig.databaseUrl) {
      throw new Error("DATABASE_URL is required when no store is provided");
    }

    logger?.info?.("state_store_initializing", { driver: "postgres" });
    const { PgStateStore } = await import("./storage/pg-state-store.js");
    store = new PgStateStore(envConfig.databaseUrl, logger);
  }

  await store.initialize();
  logger?.debug?.("state_store_ready");

  const existingRuntime = await store.loadRuntimeConfig();
  const runtimeConfig = existingRuntime ?? makeInitialRuntimeConfig(envConfig);
  if (!existingRuntime) {
    logger?.info?.("runtime_config_seeded");
    await store.saveRuntimeConfig(runtimeConfig);
  } else {
    logger?.debug?.("runtime_config_loaded", { updatedAt: existingRuntime.updatedAt });
  }

  const existingBots = await store.loadBotsState();
  let botsState: BotsStateFile = existingBots ?? {
    version: 1,
    updatedAt: new Date().toISOString(),
    bots: []
  };
  if (!existingBots) {
    logger?.info?.("bots_state_seeded");
    await store.saveBotsState(botsState);
  } else {
    logger?.debug?.("bots_state_loaded", { botCount: existingBots.bots.length });
  }

  const pruneResult = pruneInvalidBots(botsState, logger);
  botsState = pruneResult.state;
  if (pruneResult.pruned.length > 0) {
    botsState = {
      ...botsState,
      updatedAt: new Date().toISOString()
    };
    await store.saveBotsState(botsState);
  }

  return {
    envConfig,
    state: {
      runtimeConfig,
      botsState,
      store
    }
  };
}
