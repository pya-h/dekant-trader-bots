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
import {
  BuyEngine,
  BuyEngineDekantTradingClient,
  BuyEngineIntervalProvider,
  BuyEnginePriceClient
} from "./trading/buy-engine.js";

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
};

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

  const app = buildApp(
    config,
    () => ({
      stateDir: config.stateDir,
      botCount: state.botsState.bots.length,
      buyChance: config.runtime.trading.buyChance,
      sellChance: config.runtime.trading.sellChance,
      maxAmount: config.runtime.trading.maxAmount,
      createdBotsOnStartup: reconciliation.createdBots.length,
      initialFundingScheduled: fundingSchedule.scheduled
    }),
    buyEngine
      ? {
          forceBuy: async (input: { marketIds?: string[] }) =>
            buyEngine.runCycle({
              source: "manual",
              marketIds: input.marketIds
            })
        }
      : {}
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
          setIgnoredMarketIds: (ids: string[]) => marketCache.setIgnoredMarketIds(ids),
          addIgnoredMarketIds: (ids: string[]) => marketCache.addIgnoredMarketIds(ids),
          removeIgnoredMarketIds: (ids: string[]) => marketCache.removeIgnoredMarketIds(ids)
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
