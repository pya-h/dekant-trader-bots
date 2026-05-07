import { buildAppConfig, EnvConfig, loadEnvConfig } from "./config.js";
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
  store?: StateStore
): Promise<{
  envConfig: ReturnType<typeof loadEnvConfig>;
  state: BootstrapState;
}> {
  const envConfig = loadEnvConfig(env);

  if (!store) {
    if (!envConfig.databaseUrl) {
      throw new Error("DATABASE_URL is required when no store is provided");
    }

    const { PgStateStore } = await import("./storage/pg-state-store.js");
    store = new PgStateStore(envConfig.databaseUrl);
  }

  await store.initialize();

  const existingRuntime = await store.loadRuntimeConfig();
  const runtimeConfig = existingRuntime ?? makeInitialRuntimeConfig(envConfig);
  if (!existingRuntime) {
    await store.saveRuntimeConfig(runtimeConfig);
  }

  const existingBots = await store.loadBotsState();
  const botsState: BotsStateFile = existingBots ?? {
    version: 1,
    updatedAt: new Date().toISOString(),
    bots: []
  };
  if (!existingBots) {
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

export async function bootstrapConfig(env: NodeJS.ProcessEnv = process.env, store?: StateStore) {
  const { envConfig, state } = await bootstrapState(env, store);
  const appConfig = buildAppConfig(envConfig, state.runtimeConfig);

  return {
    config: appConfig,
    state
  };
}
