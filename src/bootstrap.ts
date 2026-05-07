import path from "node:path";
import { buildAppConfig, loadEnvConfig } from "./config.js";
import { BotsStateFile, RuntimeConfigFile } from "./state/types.js";
import { ensureBotsState } from "./storage/bots-state-store.js";
import { ensureRuntimeConfig, makeInitialRuntimeConfig } from "./storage/runtime-config-store.js";

export type BootstrapState = {
  runtimeConfig: RuntimeConfigFile;
  botsState: BotsStateFile;
  files: {
    runtimeConfigPath: string;
    botsStatePath: string;
  };
};

export async function bootstrapState(env: NodeJS.ProcessEnv = process.env): Promise<{
  envConfig: ReturnType<typeof loadEnvConfig>;
  state: BootstrapState;
}> {
  const envConfig = loadEnvConfig(env);

  const runtimeConfigPath = path.join(envConfig.stateDir, "runtime-config.json");
  const botsStatePath = path.join(envConfig.stateDir, "bots.json");

  const runtimeConfig = await ensureRuntimeConfig(
    runtimeConfigPath,
    makeInitialRuntimeConfig(envConfig)
  );
  const botsState = await ensureBotsState(botsStatePath);

  return {
    envConfig,
    state: {
      runtimeConfig,
      botsState,
      files: {
        runtimeConfigPath,
        botsStatePath
      }
    }
  };
}

export async function bootstrapConfig(env: NodeJS.ProcessEnv = process.env) {
  const { envConfig, state } = await bootstrapState(env);
  const appConfig = buildAppConfig(envConfig, state.runtimeConfig);

  return {
    config: appConfig,
    state
  };
}
