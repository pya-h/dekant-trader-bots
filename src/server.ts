import { pathToFileURL } from "node:url";
import { Connection, PublicKey } from "@solana/web3.js";
import dotenv from "dotenv";
import { buildApp } from "./app.js";
import { bootstrapState } from "./bootstrap.js";
import { buildAppConfig, loadEnvConfig } from "./config.js";
import { scheduleInitialFundingIfNeeded, TimerProvider } from "./bots/initial-funding.js";
import { addBotsAndPersist, BotLifecycleDependencies, reconcileAndPersistBots } from "./bots/lifecycle.js";
import { FaucetClient, HttpFaucetClient } from "./clients/faucet-client.js";
import { DekantClient, HttpDekantClient } from "./clients/dekant-client.js";
import { SolanaDekantClient } from "./clients/solana-dekant-client.js";
import type { BotRecord } from "./state/types.js";
import { PriceClient } from "./clients/price-client.js";
import { loadKeypairFromSecret, SolanaVaultClient } from "./clients/solana-vault-client.js";
import { SolanaBalanceClient } from "./clients/solana-balance-client.js";
import { BalanceClient, FundingEngine, ManualFundRequest, VaultClient } from "./funding/engine.js";
import { MarketCache } from "./markets/cache.js";
import { MintRegistry } from "./clients/mint-registry.js";
import { runtimeConfigSchema } from "./state/types.js";
import type { StateStore } from "./storage/state-store.js";
import { TradeStatsStore } from "./metrics/trade-stats.js";
import { classifyError } from "./observability/errors.js";
import { createLogger, parseLogLevel, StructuredLogger } from "./observability/logger.js";
import { MonitoredJob, RuntimeMonitor } from "./observability/runtime-monitor.js";
import {
  BuyEngine,
  BuyEngineDekantTradingClient,
  BuyEngineCycleErrorContext,
  BuyEngineIntervalProvider,
  BuyEnginePriceClient
} from "./trading/buy-engine.js";
import {
  SellEngine,
  SellEngineDekantSellingClient,
  SellEngineCycleErrorContext,
  SellEngineIntervalProvider,
  SellEnginePriceClient
} from "./trading/sell-engine.js";

dotenv.config({ quiet: true });

type LoopIntervalProvider = {
  setInterval(handler: () => void, intervalMs: number): unknown;
  clearInterval(handle: unknown): void;
};

const defaultLoopIntervalProvider: LoopIntervalProvider = {
  setInterval: (handler, intervalMs) => setInterval(handler, intervalMs),
  clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout)
};

function safeInfo(logger: StructuredLogger, event: string, fields?: Record<string, unknown>) {
  logger.info?.(event, fields);
}

function safeDebug(logger: StructuredLogger, event: string, fields?: Record<string, unknown>) {
  logger.debug?.(event, fields);
}

function safeWarn(logger: StructuredLogger, event: string, fields?: Record<string, unknown>) {
  logger.warn?.(event, fields);
}

export type AppInitializationOptions = {
  store?: StateStore;
  onInitialFundingRequested?: (context: { createdBotIds: string[]; delayMs: number }) => void | Promise<void>;
  timer?: TimerProvider;
  botLifecycleDeps?: BotLifecycleDependencies;
  observability?: {
    now?: () => Date;
    logger?: StructuredLogger;
  };
  funding?: {
    vault: VaultClient;
    balances: BalanceClient;
    faucet: FaucetClient;
    vaultAddress: string;
    now?: () => Date;
    random?: () => number;
    timer?: LoopIntervalProvider;
  };
  marketCache?: {
    client: DekantClient;
    refreshIntervalMs?: number;
    timer?: LoopIntervalProvider;
    mintRegistry?: MintRegistry;
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
    vaultSupportedMints?: string[];
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

function trackAndLogFailure(input: {
  monitor: RuntimeMonitor;
  logger: StructuredLogger;
  job: MonitoredJob;
  error: unknown;
  event: string;
  context?: Record<string, unknown>;
}) {
  const classified = input.monitor.recordJobFailure(input.job, input.error);
  input.logger.error(input.event, {
    job: input.job,
    errorType: classified.type,
    known: classified.known,
    retryable: classified.retryable,
    message: classified.message,
    ...(classified.statusCode ? { statusCode: classified.statusCode } : {}),
    ...(input.context ?? {})
  });

  return classified;
}

function trackAndLogActionFailure(input: {
  monitor: RuntimeMonitor;
  logger: StructuredLogger;
  job: MonitoredJob;
  error: unknown;
  event: string;
  context?: Record<string, unknown>;
}) {
  const classified = input.monitor.recordActionFailure(input.job, input.error);
  input.logger.error(input.event, {
    job: input.job,
    errorType: classified.type,
    known: classified.known,
    retryable: classified.retryable,
    message: classified.message,
    ...(classified.statusCode ? { statusCode: classified.statusCode } : {}),
    ...(input.context ?? {})
  });

  return classified;
}

export async function createInitializedApp(
  env: NodeJS.ProcessEnv = process.env,
  options: AppInitializationOptions = {}
) {
  const now = options.observability?.now ?? (() => new Date());
  const logger =
    options.observability?.logger ??
    createLogger({
      level: parseLogLevel(env.LOG_LEVEL),
      now
    });
  const runtimeMonitor = new RuntimeMonitor({ now });

  safeInfo(logger, "app_initializing", { nodeEnv: env.NODE_ENV });

  const { envConfig, state } = await bootstrapState(env, options.store, logger);
  safeInfo(logger, "app_state_bootstrapped", {
    botCount: state.botsState.bots.length,
    runtimeConfigUpdatedAt: state.runtimeConfig.updatedAt
  });
  safeDebug(logger, "bot_reconciliation_starting", {
    targetCount: envConfig.botFleet.initialBotCount,
    currentCount: state.botsState.bots.length
  });
  const reconciliation = await reconcileAndPersistBots({
    store: state.store,
    botsState: state.botsState,
    targetCount: envConfig.botFleet.initialBotCount,
    deps: options.botLifecycleDeps
  });
  state.botsState = reconciliation.updatedState;
  safeInfo(logger, "bot_reconciliation_completed", {
    hadExistingBots: reconciliation.hadExistingBots,
    createdBots: reconciliation.createdBots.length,
    totalBots: state.botsState.bots.length
  });

  const config = buildAppConfig(envConfig, state.runtimeConfig);
  const marketCache = options.marketCache
    ? new MarketCache({
        client: options.marketCache.client,
        refreshIntervalMs: options.marketCache.refreshIntervalMs ?? config.intervals.marketRefreshMs,
        ignoredMarketIds: config.runtime.ignoredMarketIds,
        mintRegistry: options.marketCache.mintRegistry
      })
    : null;
  const fundingEngine = options.funding
    ? new FundingEngine({
        runtime: {
          maxAmount: config.runtime.trading.maxAmount,
          prefundMultiplier: config.runtime.trading.prefundMultiplier,
          minBotSol: config.runtime.funding.minBotSol,
          emergencyTopupCooldownMs: config.runtime.funding.emergencyTopupCooldownMs,
          vaultSupportedMints: config.runtime.funding.vaultSupportedMints
        },
        clients: {
          vault: options.funding.vault,
          balances: options.funding.balances,
          faucet: options.funding.faucet
        },
        vaultAddress: options.funding.vaultAddress,
        now: options.funding.now,
        random: options.funding.random,
        logger
      })
    : null;

  const handleBuyEngineCycleError = (error: unknown, context: BuyEngineCycleErrorContext) => {
    trackAndLogFailure({
      monitor: runtimeMonitor,
      logger,
      job: "buy_cycle",
      error,
      event: "buy_cycle_failed",
      context: {
        cycleType: "buy",
        source: context.source,
        stage: context.stage
      }
    });
  };

  const handleSellEngineCycleError = (error: unknown, context: SellEngineCycleErrorContext) => {
    trackAndLogFailure({
      monitor: runtimeMonitor,
      logger,
      job: "sell_cycle",
      error,
      event: "sell_cycle_failed",
      context: {
        cycleType: "sell",
        source: context.source,
        stage: context.stage
      }
    });
  };

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
          timer: options.buy.timer,
          onCycleError: handleBuyEngineCycleError
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
          timer: options.sell.timer,
          onCycleError: handleSellEngineCycleError
        })
      : null;
  const balanceClient = options.funding?.balances ?? null;
  const statsStore = new TradeStatsStore();

  const persistRuntimeConfig = async (nextConfig: (typeof state.runtimeConfig)["config"]) => {
    const validatedConfig = runtimeConfigSchema.parse(nextConfig);
    state.runtimeConfig = {
      ...state.runtimeConfig,
      updatedAt: now().toISOString(),
      config: validatedConfig
    };
    await state.store.saveRuntimeConfig(state.runtimeConfig);
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
    const nextIgnored = state.runtimeConfig.config.ignoredMarketIds.filter((id: string) => !normalizedSet.has(id));
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
        ...(patch.funding?.vaultSupportedMints
          ? {
              vaultSupportedMints: patch.funding.vaultSupportedMints
            }
          : {})
      },
      price: {
        ...current.price,
        ...(patch.price ?? {})
      }
    });

    await persistRuntimeConfig(nextConfig);
    safeInfo(logger, "runtime_config_updated", {
      patchedKeys: Object.keys(patch)
    });

    buyEngine?.updateRuntime({
      buyChance: nextConfig.trading.buyChance,
      maxAmount: nextConfig.trading.maxAmount
    });
    sellEngine?.updateRuntime({
      sellChance: nextConfig.trading.sellChance
    });
    fundingEngine?.updateRuntime({
      maxAmount: nextConfig.trading.maxAmount,
      prefundMultiplier: nextConfig.trading.prefundMultiplier,
      minBotSol: nextConfig.funding.minBotSol,
      emergencyTopupCooldownMs: nextConfig.funding.emergencyTopupCooldownMs,
      vaultSupportedMints: nextConfig.funding.vaultSupportedMints
    });

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
    const tokens = state.runtimeConfig.config.funding.vaultSupportedMints;

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

  const runBuyCycle = async (input: { marketIds?: string[]; source?: "manual" | "scheduled" } = {}) => {
    if (!buyEngine) {
      throw new Error("buy_engine_unavailable");
    }

    runtimeMonitor.recordJobStart("buy_cycle");
    safeDebug(logger, "buy_cycle_start", {
      source: input.source ?? "manual",
      marketIds: input.marketIds?.length ?? null
    });

    try {
      const cycle = await buyEngine.runCycle({
        source: input.source ?? "manual",
        marketIds: input.marketIds
      });
      statsStore.ingestBuyCycle(cycle);
      safeInfo(logger, "buy_cycle_completed", {
        source: cycle.source,
        actions: cycle.actions.length,
        succeeded: cycle.actions.filter((a) => a.status === "submitted").length,
        failed: cycle.actions.filter((a) => a.status === "failed_submit").length
      });

      for (const action of cycle.actions) {
        if (action.status !== "failed_submit") {
          continue;
        }

        trackAndLogActionFailure({
          monitor: runtimeMonitor,
          logger,
          job: "buy_cycle",
          error: action.error ?? "buy_submit_failed",
          event: "buy_action_failed",
          context: {
            cycleType: "buy",
            source: cycle.source,
            botId: action.botId,
            marketId: action.marketId,
            token: action.token
          }
        });
      }

      runtimeMonitor.recordJobSuccess("buy_cycle");
      return cycle;
    } catch (error) {
      trackAndLogFailure({
        monitor: runtimeMonitor,
        logger,
        job: "buy_cycle",
        error,
        event: "buy_cycle_failed",
        context: {
          cycleType: "buy",
          source: input.source ?? "manual"
        }
      });
      throw error;
    }
  };

  const runSellCycle = async (input: { marketIds?: string[]; source?: "manual" | "scheduled" } = {}) => {
    if (!sellEngine) {
      throw new Error("sell_engine_unavailable");
    }

    runtimeMonitor.recordJobStart("sell_cycle");
    safeDebug(logger, "sell_cycle_start", {
      source: input.source ?? "manual",
      marketIds: input.marketIds?.length ?? null
    });

    try {
      const cycle = await sellEngine.runCycle({
        source: input.source ?? "manual",
        marketIds: input.marketIds
      });
      statsStore.ingestSellCycle(cycle);
      safeInfo(logger, "sell_cycle_completed", {
        source: cycle.source,
        actions: cycle.actions.length,
        succeeded: cycle.actions.filter((a) => a.status === "sold_full" || a.status === "sold_partial").length,
        failed: cycle.actions.filter((a) => a.status === "failed_submit").length
      });

      for (const action of cycle.actions) {
        if (action.status !== "failed_submit") {
          continue;
        }

        trackAndLogActionFailure({
          monitor: runtimeMonitor,
          logger,
          job: "sell_cycle",
          error: action.error ?? "sell_submit_failed",
          event: "sell_action_failed",
          context: {
            cycleType: "sell",
            source: cycle.source,
            botId: action.botId,
            marketId: action.marketId,
            token: action.token
          }
        });
      }

      runtimeMonitor.recordJobSuccess("sell_cycle");
      return cycle;
    } catch (error) {
      trackAndLogFailure({
        monitor: runtimeMonitor,
        logger,
        job: "sell_cycle",
        error,
        event: "sell_cycle_failed",
        context: {
          cycleType: "sell",
          source: input.source ?? "manual"
        }
      });
      throw error;
    }
  };

  const syncVaultSupportedMintsFromMarkets = async (
    markets: { collateralMint?: string }[]
  ): Promise<void> => {
    const discovered = unique(
      markets.map((market) => market.collateralMint).filter((mint): mint is string => Boolean(mint))
    );
    const current = state.runtimeConfig.config.funding.vaultSupportedMints;
    if (discovered.length === current.length && discovered.every((mint) => current.includes(mint))) {
      return;
    }
    const nextConfig = {
      ...state.runtimeConfig.config,
      funding: {
        ...state.runtimeConfig.config.funding,
        vaultSupportedMints: discovered
      }
    };
    await persistRuntimeConfig(nextConfig);
    fundingEngine?.updateRuntime({ vaultSupportedMints: discovered });
    safeInfo(logger, "vault_supported_mints_updated", {
      mints: discovered,
      count: discovered.length
    });
  };

  const runMarketRefresh = async () => {
    if (!marketCache) {
      throw new Error("market_cache_unavailable");
    }

    runtimeMonitor.recordJobStart("market_refresh");
    safeDebug(logger, "market_refresh_start");
    const result = await marketCache.refresh();
    if (result.updated) {
      runtimeMonitor.recordJobSuccess("market_refresh");
      const snapshot = marketCache.getSnapshot();
      safeInfo(logger, "market_refresh_completed", {
        markets: snapshot.markets.length
      });
      await syncVaultSupportedMintsFromMarkets(snapshot.markets);
    } else {
      trackAndLogFailure({
        monitor: runtimeMonitor,
        logger,
        job: "market_refresh",
        error: result.error ?? "market_refresh_failed",
        event: "market_refresh_failed",
        context: {
          cycleType: "market_refresh"
        }
      });
    }

    return result;
  };

  const runManualFund = async (
    input: Omit<ManualFundRequest, "bots">,
    source: "admin" | "service_api" | "add_bots" | "initial_funding"
  ) => {
    if (!fundingEngine) {
      throw new Error("funding_unavailable");
    }

    runtimeMonitor.recordJobStart("manual_fund");
    safeDebug(logger, "manual_fund_start", {
      source,
      botIds: input.botIds?.length ?? null,
      addresses: input.addresses?.length ?? null,
      amount: input.amount ?? null,
      token: input.token ?? null
    });
    try {
      const result = await fundingEngine.manualFund({
        bots: state.botsState.bots,
        ...input
      });
      runtimeMonitor.recordJobSuccess("manual_fund");
      safeInfo(logger, "manual_fund_completed", { source });
      return result;
    } catch (error) {
      trackAndLogFailure({
        monitor: runtimeMonitor,
        logger,
        job: "manual_fund",
        error,
        event: "manual_fund_failed",
        context: {
          source
        }
      });
      throw error;
    }
  };

  const runPrefundCycle = async (source: "scheduled" | "service_api" = "scheduled") => {
    if (!fundingEngine) {
      throw new Error("funding_unavailable");
    }

    runtimeMonitor.recordJobStart("manual_fund");
    safeDebug(logger, "prefund_cycle_start", { source, botCount: state.botsState.bots.length });
    try {
      const result = await fundingEngine.prefundBots(state.botsState.bots);
      runtimeMonitor.recordJobSuccess("manual_fund");
      safeInfo(logger, "prefund_cycle_completed", { source });
      return result;
    } catch (error) {
      trackAndLogFailure({
        monitor: runtimeMonitor,
        logger,
        job: "manual_fund",
        error,
        event: "prefund_failed",
        context: {
          source
        }
      });
      throw error;
    }
  };

  const fundingSchedule = scheduleInitialFundingIfNeeded({
    hadExistingBots: reconciliation.hadExistingBots,
    createdBots: reconciliation.createdBots,
    delayMs: envConfig.intervals.initialFundingDelayMs,
    timer: options.timer,
    trigger: async (context) => {
      runtimeMonitor.recordJobStart("initial_funding");
      safeInfo(logger, "initial_funding_triggered", {
        createdBots: context.createdBots.length,
        delayMs: context.delayMs
      });
      try {
        if (options.onInitialFundingRequested) {
          await options.onInitialFundingRequested({
            createdBotIds: context.createdBots.map((bot) => bot.id),
            delayMs: context.delayMs
          });
        } else if (fundingEngine) {
          await runManualFund(
            {
              botIds: context.createdBots.map((bot) => bot.id)
            },
            "initial_funding"
          );
        }

        runtimeMonitor.recordJobSuccess("initial_funding");
        safeInfo(logger, "initial_funding_completed");
      } catch (error) {
        trackAndLogFailure({
          monitor: runtimeMonitor,
          logger,
          job: "initial_funding",
          error,
          event: "initial_funding_failed",
          context: {
            createdBots: context.createdBots.length
          }
        });
      }
    },
    onError: (error) => {
      trackAndLogFailure({
        monitor: runtimeMonitor,
        logger,
        job: "initial_funding",
        error,
        event: "initial_funding_unhandled_error"
      });
    }
  });

  if (fundingSchedule.scheduled) {
    safeInfo(logger, "initial_funding_scheduled", {
      delayMs: fundingSchedule.delayMs,
      createdBots: reconciliation.createdBots.length
    });
  } else {
    safeDebug(logger, "initial_funding_skipped", {
      hadExistingBots: reconciliation.hadExistingBots,
      createdBots: reconciliation.createdBots.length
    });
  }

  const marketLoopTimer = options.marketCache?.timer ?? defaultLoopIntervalProvider;
  const buyLoopTimer = options.buy?.timer ?? defaultLoopIntervalProvider;
  const sellLoopTimer = options.sell?.timer ?? defaultLoopIntervalProvider;
  const fundingLoopTimer = options.funding?.timer ?? defaultLoopIntervalProvider;

  let marketLoopHandle: unknown = null;
  let buyLoopHandle: unknown = null;
  let sellLoopHandle: unknown = null;
  let fundingLoopHandle: unknown = null;

  const startMarketLoop = async (options: { immediate?: boolean } = {}) => {
    if (!marketCache || marketLoopHandle !== null) {
      return;
    }

    safeInfo(logger, "market_loop_starting", {
      intervalMs: config.intervals.marketRefreshMs,
      immediate: options.immediate !== false
    });

    if (options.immediate !== false) {
      await runMarketRefresh().catch(() => {});
    }

    marketLoopHandle = marketLoopTimer.setInterval(() => {
      void runMarketRefresh().catch(() => {});
    }, config.intervals.marketRefreshMs);
  };

  const stopMarketLoop = () => {
    if (marketLoopHandle === null) {
      return;
    }
    marketLoopTimer.clearInterval(marketLoopHandle);
    marketLoopHandle = null;
    safeInfo(logger, "market_loop_stopped");
  };

  const startBuyLoop = async (options: { immediate?: boolean } = {}) => {
    if (!buyEngine || buyLoopHandle !== null) {
      return;
    }

    safeInfo(logger, "buy_loop_starting", {
      intervalMs: config.intervals.buyMs,
      immediate: options.immediate !== false
    });

    if (options.immediate !== false) {
      await runBuyCycle({ source: "scheduled" }).catch(() => {});
    }

    buyLoopHandle = buyLoopTimer.setInterval(() => {
      void runBuyCycle({ source: "scheduled" }).catch(() => {});
    }, config.intervals.buyMs);
  };

  const stopBuyLoop = () => {
    if (buyLoopHandle === null) {
      return;
    }
    buyLoopTimer.clearInterval(buyLoopHandle);
    buyLoopHandle = null;
    safeInfo(logger, "buy_loop_stopped");
  };

  const startSellLoop = async (options: { immediate?: boolean } = {}) => {
    if (!sellEngine || sellLoopHandle !== null) {
      return;
    }

    safeInfo(logger, "sell_loop_starting", {
      intervalMs: config.intervals.sellMs,
      immediate: options.immediate !== false
    });

    if (options.immediate !== false) {
      await runSellCycle({ source: "scheduled" }).catch(() => {});
    }

    sellLoopHandle = sellLoopTimer.setInterval(() => {
      void runSellCycle({ source: "scheduled" }).catch(() => {});
    }, config.intervals.sellMs);
  };

  const stopSellLoop = () => {
    if (sellLoopHandle === null) {
      return;
    }
    sellLoopTimer.clearInterval(sellLoopHandle);
    sellLoopHandle = null;
    safeInfo(logger, "sell_loop_stopped");
  };

  const startFundingLoop = async (options: { immediate?: boolean } = {}) => {
    if (!fundingEngine || fundingLoopHandle !== null) {
      return;
    }

    safeInfo(logger, "funding_loop_starting", {
      intervalMs: config.intervals.fundingMs,
      immediate: options.immediate === true
    });

    if (options.immediate === true) {
      await runPrefundCycle("scheduled").catch(() => {});
    }

    fundingLoopHandle = fundingLoopTimer.setInterval(() => {
      void runPrefundCycle("scheduled").catch(() => {});
    }, config.intervals.fundingMs);
  };

  const stopFundingLoop = () => {
    if (fundingLoopHandle === null) {
      return;
    }
    fundingLoopTimer.clearInterval(fundingLoopHandle);
    fundingLoopHandle = null;
    safeInfo(logger, "funding_loop_stopped");
  };

  const addBotsWithReadiness = async (count: number) => {
    runtimeMonitor.recordJobStart("add_bots");
    safeInfo(logger, "add_bots_start", { count });

    try {
      const result = await addBotsAndPersist({
        store: state.store,
        botsState: state.botsState,
        count,
        deps: options.botLifecycleDeps
      });

      state.botsState = result.updatedState;

      let funding = null;
      let fundingError: { type: string; message: string } | null = null;

      if (fundingEngine && result.addedBots.length > 0) {
        try {
          funding = await runManualFund(
            {
              botIds: result.addedBots.map((bot) => bot.id)
            },
            "add_bots"
          );
        } catch (error) {
          const classified = classifyError(error);
          fundingError = {
            type: classified.type,
            message: classified.message
          };
        }
      }

      runtimeMonitor.recordJobSuccess("add_bots");
      safeInfo(logger, "add_bots_completed", {
        added: result.addedBots.length,
        totalBots: result.updatedState.bots.length,
        funded: funding !== null,
        fundingError: fundingError?.type ?? null
      });
      return {
        addedBots: result.addedBots,
        totalBotCount: result.updatedState.bots.length,
        funding,
        ...(fundingError ? { fundingError } : {})
      };
    } catch (error) {
      trackAndLogFailure({
        monitor: runtimeMonitor,
        logger,
        job: "add_bots",
        error,
        event: "add_bots_failed"
      });
      throw error;
    }
  };

  const app = buildApp(
    config,
    () => ({
      botCount: state.botsState.bots.length,
      buyChance: state.runtimeConfig.config.trading.buyChance,
      sellChance: state.runtimeConfig.config.trading.sellChance,
      maxAmount: state.runtimeConfig.config.trading.maxAmount,
      createdBotsOnStartup: reconciliation.createdBots.length,
      initialFundingScheduled: fundingSchedule.scheduled,
      observability: runtimeMonitor.getSnapshot()
    }),
    {
      forceBuy: buyEngine
        ? async (input: { marketIds?: string[] }) =>
            runBuyCycle({
              source: "manual",
              marketIds: input.marketIds
            })
        : undefined,
      forceSell: sellEngine
        ? async (input: { marketIds?: string[] }) =>
            runSellCycle({
              source: "manual",
              marketIds: input.marketIds
            })
        : undefined,
      getStats: async (input: { page: number; pageSize: number }) =>
        statsStore.getSummary({
          page: input.page,
          pageSize: input.pageSize,
          bots: state.botsState.bots
        }),
      addBots: async (input: { count: number }) => addBotsWithReadiness(input.count),
      manualFund: fundingEngine
        ? async (input: { botIds?: string[]; addresses?: string[]; amount?: number; token?: string }) =>
            runManualFund(
              {
                botIds: input.botIds,
                addresses: input.addresses,
                amount: input.amount,
                token: input.token
              },
              "admin"
            )
        : undefined,
      addIgnoredMarkets: async (input: { marketIds: string[] }) => addIgnoredMarketIds(input.marketIds),
      removeIgnoredMarkets: async (input: { marketIds: string[] }) => removeIgnoredMarketIds(input.marketIds),
      getBotBalances: balanceClient
        ? async (input: { page: number; pageSize: number }) => getBotBalances(input)
        : undefined,
      updateRuntimeConfig: async (patch: RuntimeConfigPatchInput) => updateRuntimeConfig(patch)
    },
    logger
  );

  app.addHook("onClose", async () => {
    stopBuyLoop();
    stopSellLoop();
    stopMarketLoop();
    stopFundingLoop();
    fundingSchedule.cancel();
    await state.store.close();
  });

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
        const result = await addBotsWithReadiness(count);
        return {
          addedBots: result.addedBots,
          totalBotCount: result.totalBotCount
        };
      }
    },
    funding: fundingEngine
      ? {
          manualFund: async (request: Omit<ManualFundRequest, "bots"> = {}) =>
            runManualFund(request, "service_api"),
          prefund: async () => runPrefundCycle("service_api"),
          start: async (options: { immediate?: boolean } = {}) => startFundingLoop(options),
          stop: () => stopFundingLoop(),
          getSnapshot: () => ({
            isRunning: fundingLoopHandle !== null,
            intervalMs: config.intervals.fundingMs
          }),
          emergencyTopup: async (input: { botId: string; token: string; amount?: number }) => {
            const bot = state.botsState.bots.find((candidate) => candidate.id === input.botId);
            if (!bot) {
              throw new Error("bot_not_found");
            }

            runtimeMonitor.recordJobStart("manual_fund");
            try {
              const result = await fundingEngine.requestEmergencyTopup({
                bot,
                token: input.token,
                amount: input.amount
              });
              runtimeMonitor.recordJobSuccess("manual_fund");
              return result;
            } catch (error) {
              trackAndLogFailure({
                monitor: runtimeMonitor,
                logger,
                job: "manual_fund",
                error,
                event: "emergency_topup_failed",
                context: {
                  botId: input.botId,
                  token: input.token
                }
              });
              throw error;
            }
          }
        }
      : null,
    markets: marketCache
      ? {
          refresh: async () => runMarketRefresh(),
          start: async (options: { immediate?: boolean } = {}) => startMarketLoop(options),
          stop: () => stopMarketLoop(),
          getSnapshot: () => ({
            ...marketCache.getSnapshot(),
            isRunning: marketLoopHandle !== null
          }),
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
            runBuyCycle({
              source: "manual",
              marketIds
            }),
          start: async (options: { immediate?: boolean } = {}) => startBuyLoop(options),
          stop: () => stopBuyLoop(),
          getSnapshot: () => ({
            ...buyEngine.getSnapshot(),
            isRunning: buyLoopHandle !== null
          })
        }
      : null,
    sell: sellEngine
      ? {
          runCycle: async (marketIds?: string[]) =>
            runSellCycle({
              source: "manual",
              marketIds
            }),
          start: async (options: { immediate?: boolean } = {}) => startSellLoop(options),
          stop: () => stopSellLoop(),
          getSnapshot: () => ({
            ...sellEngine.getSnapshot(),
            isRunning: sellLoopHandle !== null
          })
        }
      : null
  };
}

async function start(): Promise<void> {
  const startupLogger = createLogger({ level: parseLogLevel(process.env.LOG_LEVEL) });
  startupLogger.info?.("server_starting");

  const envConfig = loadEnvConfig(process.env);

  const httpDekantClient = new HttpDekantClient({
    baseUrl: envConfig.integration.dekantBackendUrl,
    timeoutMs: envConfig.clientDefaults.dekant.requestTimeoutMs,
    retryCount: envConfig.clientDefaults.dekant.retryCount,
    retryBackoffMs: envConfig.clientDefaults.dekant.retryBackoffMs
  });

  // Late-bound bot lookup: createInitializedApp owns the bot state, but we
  // need the SolanaDekantClient before it runs. After bootstrap returns we
  // point this at the live bot list so trade calls find each bot's keypair.
  const botRegistry: { getBots: () => BotRecord[] } = { getBots: () => [] };

  const programId = new PublicKey(envConfig.integration.dekantProgramId);

  const faucetClient = new HttpFaucetClient({
    baseUrl: envConfig.integration.dekantBackendUrl,
    timeoutMs: envConfig.clientDefaults.faucet.requestTimeoutMs,
    retryCount: envConfig.clientDefaults.faucet.retryCount,
    retryBackoffMs: envConfig.clientDefaults.faucet.retryBackoffMs
  });

  const priceClient = new PriceClient({
    baseUrl: envConfig.integration.priceServiceUrl,
    timeoutMs: envConfig.clientDefaults.price.requestTimeoutMs,
    retryCount: envConfig.clientDefaults.price.retryCount,
    retryBackoffMs: envConfig.clientDefaults.price.retryBackoffMs,
    stalePolicy: envConfig.runtimeDefaults.stalePricePolicy
  });

  const connection = new Connection(envConfig.integration.solanaRpcUrl, "confirmed");
  const mintRegistry = new MintRegistry({ connection });

  const dekantClient: DekantClient = new SolanaDekantClient({
    connection,
    programId,
    mintRegistry,
    httpDelegate: httpDekantClient,
    getBotKeypair: (botId) => {
      const bot = botRegistry.getBots().find((candidate) => candidate.id === botId);
      if (!bot) return null;
      return loadKeypairFromSecret(bot.secretKey);
    }
  });

  const vaultKeypair = loadKeypairFromSecret(envConfig.vault.secretKey);
  const vaultAddress = vaultKeypair.publicKey.toBase58();
  startupLogger.info?.("vault_loaded", {
    publicKey: vaultAddress,
    rpcUrl: envConfig.integration.solanaRpcUrl
  });

  const vaultClient = new SolanaVaultClient({
    connection,
    vaultKeypair,
    mintRegistry
  });

  const balanceClient = new SolanaBalanceClient({
    connection
  });

  const appCtx = await createInitializedApp(process.env, {
    marketCache: { client: dekantClient, mintRegistry },
    funding: {
      vault: vaultClient,
      balances: balanceClient,
      faucet: faucetClient,
      vaultAddress
    },
    buy: { dekant: dekantClient, price: priceClient },
    sell: { dekant: dekantClient, price: priceClient }
  });
  const { app, config } = appCtx;

  botRegistry.getBots = () => appCtx.state.botsState.bots;

  await app.listen({ host: config.host, port: config.port });
  startupLogger.info?.("server_listening", { host: config.host, port: config.port });

  await appCtx.markets?.start({ immediate: true });
  await appCtx.funding?.start({ immediate: false });

  // Hold buy/sell loops until initial funding has had time to land on-chain.
  // Without this, the first cycle fires before bots have any collateral.
  const initialFundingDelayMs = appCtx.startup.initialFundingScheduled
    ? (appCtx.startup.initialFundingDelayMs ?? 0)
    : 0;
  const tradingStartDelayMs = initialFundingDelayMs + 5_000;
  if (tradingStartDelayMs > 0) {
    startupLogger.info?.("trading_loops_deferred", { delayMs: tradingStartDelayMs });
    setTimeout(() => {
      void appCtx.buy?.start({ immediate: true });
      void appCtx.sell?.start({ immediate: true });
      startupLogger.info?.("trading_loops_started");
    }, tradingStartDelayMs).unref();
  } else {
    await appCtx.buy?.start({ immediate: true });
    await appCtx.sell?.start({ immediate: true });
  }
  startupLogger.info?.("server_ready", {
    market: appCtx.markets !== null,
    buy: appCtx.buy !== null,
    sell: appCtx.sell !== null,
    funding: appCtx.funding !== null
  });
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
