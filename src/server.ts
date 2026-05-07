import { pathToFileURL } from "node:url";
import dotenv from "dotenv";
import { buildApp } from "./app.js";
import { bootstrapState } from "./bootstrap.js";
import { buildAppConfig } from "./config.js";
import { scheduleInitialFundingIfNeeded, TimerProvider } from "./bots/initial-funding.js";
import { addBotsAndPersist, BotLifecycleDependencies, reconcileAndPersistBots } from "./bots/lifecycle.js";
import { FaucetClient } from "./clients/faucet-client.js";
import { DekantClient } from "./clients/dekant-client.js";
import { BalanceClient, FundingEngine, ManualFundRequest, VaultClient } from "./funding/engine.js";
import { MarketCache } from "./markets/cache.js";
import { runtimeConfigSchema } from "./state/types.js";
import { saveRuntimeConfig } from "./storage/runtime-config-store.js";
import {
  BuyEngine,
  BuyEngineDekantTradingClient,
  BuyEngineIntervalProvider,
  BuyEnginePriceClient
} from "./trading/buy-engine.js";
import {
  SellEngine,
  SellEngineDekantSellingClient,
  SellEngineIntervalProvider,
  SellEnginePriceClient
} from "./trading/sell-engine.js";

dotenv.config({ quiet: true });

export type AppInitializationOptions = {
  onInitialFundingRequested?: (context: { createdBotIds: string[]; delayMs: number }) => void | Promise<void>;
  timer?: TimerProvider;
  botLifecycleDeps?: BotLifecycleDependencies;
  funding?: {
    vault: VaultClient;
    balances: BalanceClient;
    faucet: FaucetClient;
    now?: () => Date;
    random?: () => number;
  };
  marketCache?: {
    client: DekantClient;
    refreshIntervalMs?: number;
  };
  buy?: {
    dekant: BuyEngineDekantTradingClient;
    price: BuyEnginePriceClient;
    now?: () => Date;
    random?: () => number;
    timer?: BuyEngineIntervalProvider;
  };
  sell?: {
    dekant: SellEngineDekantSellingClient;
    price: SellEnginePriceClient;
    now?: () => Date;
    random?: () => number;
    timer?: SellEngineIntervalProvider;
  };
};

type RuntimeConfigPatchInput = {
  trading?: {
    buyChance?: number;
    sellChance?: number;
    maxAmount?: number;
    prefundMultiplier?: number;
  };
  funding?: {
    emergencyTopupCooldownMs?: number;
    minBotSol?: number;
    vaultSupportedTokens?: string[];
  };
  price?: {
    stalePricePolicy?: "skip" | "allow";
  };
};

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function normalizeMarketIds(ids: string[]): string[] {
  return unique(ids.map((id) => id.trim()).filter((id) => id.length > 0));
}

function normalizeTokens(tokens: string[]): string[] {
  return unique(tokens.map((token) => token.trim().toUpperCase()).filter((token) => token.length > 0));
}

export async function createInitializedApp(
  env: NodeJS.ProcessEnv = process.env,
  options: AppInitializationOptions = {}
) {
  const { envConfig, state } = await bootstrapState(env);
  const reconciliation = await reconcileAndPersistBots({
    botsStatePath: state.files.botsStatePath,
    botsState: state.botsState,
    targetCount: envConfig.botFleet.initialBotCount,
    deps: options.botLifecycleDeps
  });
  state.botsState = reconciliation.updatedState;

  const fundingSchedule = scheduleInitialFundingIfNeeded({
    hadExistingBots: reconciliation.hadExistingBots,
    createdBots: reconciliation.createdBots,
    delayMs: envConfig.intervals.initialFundingDelayMs,
    timer: options.timer,
    trigger: async (context) => {
      await options.onInitialFundingRequested?.({
        createdBotIds: context.createdBots.map((bot) => bot.id),
        delayMs: context.delayMs
      });
    }
  });

  const config = buildAppConfig(envConfig, state.runtimeConfig);
  const marketCache = options.marketCache
    ? new MarketCache({
        client: options.marketCache.client,
        refreshIntervalMs: options.marketCache.refreshIntervalMs ?? config.intervals.marketRefreshMs,
        ignoredMarketIds: config.runtime.ignoredMarketIds
      })
    : null;
  const fundingEngine = options.funding
    ? new FundingEngine({
        runtime: {
          maxAmount: config.runtime.trading.maxAmount,
          prefundMultiplier: config.runtime.trading.prefundMultiplier,
          minBotSol: config.runtime.funding.minBotSol,
          emergencyTopupCooldownMs: config.runtime.funding.emergencyTopupCooldownMs,
          vaultSupportedTokens: config.runtime.funding.vaultSupportedTokens
        },
        clients: {
          vault: options.funding.vault,
          balances: options.funding.balances,
          faucet: options.funding.faucet
        },
        now: options.funding.now,
        random: options.funding.random
      })
    : null;
  const buyEngine =
    options.buy && marketCache
      ? new BuyEngine({
          runtime: {
            buyChance: config.runtime.trading.buyChance,
            maxAmount: config.runtime.trading.maxAmount,
            intervalMs: config.intervals.buyMs
          },
          clients: {
            dekant: options.buy.dekant,
            price: options.buy.price
          },
          getBots: () => state.botsState.bots,
          getMarkets: () => marketCache.getSnapshot().markets,
          now: options.buy.now,
          random: options.buy.random,
          timer: options.buy.timer
        })
      : null;
  const sellEngine =
    options.sell && marketCache
      ? new SellEngine({
          runtime: {
            sellChance: config.runtime.trading.sellChance,
            intervalMs: config.intervals.sellMs
          },
          clients: {
            dekant: options.sell.dekant,
            price: options.sell.price
          },
          getBots: () => state.botsState.bots,
          getMarkets: () => marketCache.getSnapshot().markets,
          now: options.sell.now,
          random: options.sell.random,
          timer: options.sell.timer
        })
      : null;
  const balanceClient = options.funding?.balances ?? null;

  const persistRuntimeConfig = async (nextConfig: (typeof state.runtimeConfig)["config"]) => {
    const validatedConfig = runtimeConfigSchema.parse(nextConfig);
    state.runtimeConfig = {
      ...state.runtimeConfig,
      updatedAt: new Date().toISOString(),
      config: validatedConfig
    };
    await saveRuntimeConfig(state.files.runtimeConfigPath, state.runtimeConfig);
  };

  const addIgnoredMarketIds = async (ids: string[]) => {
    const normalized = normalizeMarketIds(ids);
    const nextIgnored = unique([...state.runtimeConfig.config.ignoredMarketIds, ...normalized]);
    const nextConfig = {
      ...state.runtimeConfig.config,
      ignoredMarketIds: nextIgnored
    };
    await persistRuntimeConfig(nextConfig);
    marketCache?.setIgnoredMarketIds(nextIgnored);
    return { ignoredMarketIds: nextIgnored };
  };

  const removeIgnoredMarketIds = async (ids: string[]) => {
    const normalizedSet = new Set(normalizeMarketIds(ids));
    const nextIgnored = state.runtimeConfig.config.ignoredMarketIds.filter((id) => !normalizedSet.has(id));
    const nextConfig = {
      ...state.runtimeConfig.config,
      ignoredMarketIds: nextIgnored
    };
    await persistRuntimeConfig(nextConfig);
    marketCache?.setIgnoredMarketIds(nextIgnored);
    return { ignoredMarketIds: nextIgnored };
  };

  const updateRuntimeConfig = async (patch: RuntimeConfigPatchInput) => {
    const current = state.runtimeConfig.config;
    const nextConfig = runtimeConfigSchema.parse({
      ...current,
      trading: {
        ...current.trading,
        ...(patch.trading ?? {})
      },
      funding: {
        ...current.funding,
        ...(patch.funding ?? {}),
        ...(patch.funding?.vaultSupportedTokens
          ? {
              vaultSupportedTokens: normalizeTokens(patch.funding.vaultSupportedTokens)
            }
          : {})
      },
      price: {
        ...current.price,
        ...(patch.price ?? {})
      }
    });

    await persistRuntimeConfig(nextConfig);
    return state.runtimeConfig.config;
  };

  const getBotBalances = async (input: { page: number; pageSize: number }) => {
    if (!balanceClient) {
      throw new Error("balances_unavailable");
    }

    const bots = state.botsState.bots;
    const total = bots.length;
    const offset = (input.page - 1) * input.pageSize;
    const selected = bots.slice(offset, offset + input.pageSize);
    const tokens = state.runtimeConfig.config.funding.vaultSupportedTokens;

    const items = await Promise.all(
      selected.map(async (bot) => {
        const balance = await balanceClient.getBotBalance(bot.publicKey, tokens);
        return {
          botId: bot.id,
          address: bot.publicKey,
          sol: balance.sol,
          tokens: balance.tokens
        };
      })
    );

    return {
      page: input.page,
      pageSize: input.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / input.pageSize)),
      items
    };
  };

  const app = buildApp(
    config,
    () => ({
      stateDir: config.stateDir,
      botCount: state.botsState.bots.length,
      buyChance: state.runtimeConfig.config.trading.buyChance,
      sellChance: state.runtimeConfig.config.trading.sellChance,
      maxAmount: state.runtimeConfig.config.trading.maxAmount,
      createdBotsOnStartup: reconciliation.createdBots.length,
      initialFundingScheduled: fundingSchedule.scheduled
    }),
    {
      forceBuy: buyEngine
        ? async (input: { marketIds?: string[] }) =>
            buyEngine.runCycle({
              source: "manual",
              marketIds: input.marketIds
            })
        : undefined,
      forceSell: sellEngine
        ? async (input: { marketIds?: string[] }) =>
            sellEngine.runCycle({
              source: "manual",
              marketIds: input.marketIds
            })
        : undefined,
      addIgnoredMarkets: async (input: { marketIds: string[] }) => addIgnoredMarketIds(input.marketIds),
      removeIgnoredMarkets: async (input: { marketIds: string[] }) => removeIgnoredMarketIds(input.marketIds),
      getBotBalances: balanceClient
        ? async (input: { page: number; pageSize: number }) => getBotBalances(input)
        : undefined,
      updateRuntimeConfig: async (patch: RuntimeConfigPatchInput) => updateRuntimeConfig(patch)
    }
  );

  return {
    app,
    config,
    state,
    startup: {
      createdBots: reconciliation.createdBots,
      hadExistingBots: reconciliation.hadExistingBots,
      initialFundingScheduled: fundingSchedule.scheduled,
      initialFundingDelayMs: fundingSchedule.delayMs
    },
    botLifecycle: {
      addBots: async (count: number) => {
        const result = await addBotsAndPersist({
          botsStatePath: state.files.botsStatePath,
          botsState: state.botsState,
          count,
          deps: options.botLifecycleDeps
        });

        state.botsState = result.updatedState;
        return {
          addedBots: result.addedBots,
          totalBotCount: result.updatedState.bots.length
        };
      }
    },
    funding: fundingEngine
      ? {
          manualFund: async (request: Omit<ManualFundRequest, "bots"> = {}) =>
            fundingEngine.manualFund({
              bots: state.botsState.bots,
              ...request
            }),
          prefund: async () => fundingEngine.prefundBots(state.botsState.bots),
          emergencyTopup: async (input: { botId: string; token: string; amount?: number }) => {
            const bot = state.botsState.bots.find((candidate) => candidate.id === input.botId);
            if (!bot) {
              throw new Error("bot_not_found");
            }
            return fundingEngine.requestEmergencyTopup({
              bot,
              token: input.token,
              amount: input.amount
            });
          }
        }
      : null,
    markets: marketCache
      ? {
          refresh: async () => marketCache.refresh(),
          start: async () => marketCache.start({ immediate: true }),
          stop: () => marketCache.stop(),
          getSnapshot: () => marketCache.getSnapshot(),
          setIgnoredMarketIds: async (ids: string[]) => {
            const normalized = normalizeMarketIds(ids);
            const nextConfig = {
              ...state.runtimeConfig.config,
              ignoredMarketIds: normalized
            };
            await persistRuntimeConfig(nextConfig);
            marketCache.setIgnoredMarketIds(normalized);
            return {
              ignoredMarketIds: normalized
            };
          },
          addIgnoredMarketIds: async (ids: string[]) => addIgnoredMarketIds(ids),
          removeIgnoredMarketIds: async (ids: string[]) => removeIgnoredMarketIds(ids)
        }
      : null,
    buy: buyEngine
      ? {
          runCycle: async (marketIds?: string[]) =>
            buyEngine.runCycle({
              source: "manual",
              marketIds
            }),
          start: async () => buyEngine.start({ immediate: true }),
          stop: () => buyEngine.stop(),
          getSnapshot: () => buyEngine.getSnapshot()
        }
      : null,
    sell: sellEngine
      ? {
          runCycle: async (marketIds?: string[]) =>
            sellEngine.runCycle({
              source: "manual",
              marketIds
            }),
          start: async () => sellEngine.start({ immediate: true }),
          stop: () => sellEngine.stop(),
          getSnapshot: () => sellEngine.getSnapshot()
        }
      : null
  };
}

async function start(): Promise<void> {
  const { app, config } = await createInitializedApp(process.env);

  await app.listen({ host: config.host, port: config.port });
}

function isMainModule(): boolean {
  if (!process.argv[1]) {
    return false;
  }

  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  start().catch((error) => {
    console.error("failed_to_start", error);
    process.exit(1);
  });
}
