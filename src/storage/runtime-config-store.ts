import { EnvConfig } from "../config.js";
import { RuntimeConfigFile, runtimeConfigFileSchema } from "../state/types.js";
import { readJsonFile, writeJsonFileAtomic } from "./json-file.js";

function nowIso(): string {
  return new Date().toISOString();
}

export function makeInitialRuntimeConfig(envConfig: EnvConfig): RuntimeConfigFile {
  return {
    version: 1,
    updatedAt: nowIso(),
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

export async function ensureRuntimeConfig(
  filePath: string,
  initialConfig: RuntimeConfigFile
): Promise<RuntimeConfigFile> {
  const existing = await readJsonFile<unknown>(filePath);

  if (existing === null) {
    await writeJsonFileAtomic(filePath, initialConfig);
    return initialConfig;
  }

  return runtimeConfigFileSchema.parse(existing);
}

export async function saveRuntimeConfig(
  filePath: string,
  runtimeConfig: RuntimeConfigFile
): Promise<void> {
  const validated = runtimeConfigFileSchema.parse(runtimeConfig);
  await writeJsonFileAtomic(filePath, validated);
}
