import { buildAppConfig, EnvConfig, loadEnvConfig } from "./config.js";
import type { StructuredLogger } from "./observability/logger.js";
import { BotsStateFile, RuntimeConfigFile } from "./state/types.js";
import type { StateStore } from "./storage/state-store.js";

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
        vaultSupportedTokens: envConfig.runtimeDefaults.vaultSupportedTokens
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
  const botsState: BotsStateFile = existingBots ?? {
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

  return {
    envConfig,
    state: {
      runtimeConfig,
      botsState,
      store
    }
  };
}

export async function bootstrapConfig(env: NodeJS.ProcessEnv = process.env, store?: StateStore) {
  const { envConfig, state } = await bootstrapState(env, store);
  const appConfig = buildAppConfig(envConfig, state.runtimeConfig);

  return {
    config: appConfig,
    state
  };
}
