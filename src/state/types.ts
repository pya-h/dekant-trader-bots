import { z } from "zod";

export const runtimeTradingConfigSchema = z.object({
  buyChance: z.number().min(0).max(100),
  sellChance: z.number().min(0).max(100),
  maxAmount: z.number().positive(),
  prefundMultiplier: z.number().positive()
});

export const runtimeFundingConfigSchema = z.preprocess(
  (value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      if ("vaultSupportedTokens" in record && !("vaultSupportedMints" in record)) {
        const { vaultSupportedTokens, ...rest } = record;
        return { ...rest, vaultSupportedMints: vaultSupportedTokens };
      }
    }
    return value;
  },
  z.object({
    emergencyTopupCooldownMs: z.number().int().positive(),
    minBotSol: z.number().positive(),
    vaultSupportedMints: z.array(z.string().min(1))
  })
);

export const runtimePriceConfigSchema = z.object({
  stalePricePolicy: z.enum(["skip", "allow"])
});

export const runtimeConfigSchema = z.object({
  ignoredMarketIds: z.array(z.string()),
  trading: runtimeTradingConfigSchema,
  funding: runtimeFundingConfigSchema,
  price: runtimePriceConfigSchema
});

export const runtimeConfigFileSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string().datetime(),
  config: runtimeConfigSchema
});

export type RuntimeConfigFile = z.infer<typeof runtimeConfigFileSchema>;

export const botRecordSchema = z.object({
  id: z.string().min(1),
  publicKey: z.string().min(1),
  secretKey: z.string().min(1),
  createdAt: z.string().datetime(),
  lastActiveAt: z.string().datetime().nullable().optional()
});
export type BotRecord = z.infer<typeof botRecordSchema>;

export const botsStateFileSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string().datetime(),
  bots: z.array(botRecordSchema)
});

export type BotsStateFile = z.infer<typeof botsStateFileSchema>;
