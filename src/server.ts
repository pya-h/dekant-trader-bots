import { pathToFileURL } from "node:url";
import dotenv from "dotenv";
import { buildApp } from "./app.js";
import { bootstrapState } from "./bootstrap.js";
import { buildAppConfig } from "./config.js";
import { scheduleInitialFundingIfNeeded, TimerProvider } from "./bots/initial-funding.js";
import { addBotsAndPersist, BotLifecycleDependencies, reconcileAndPersistBots } from "./bots/lifecycle.js";

dotenv.config({ quiet: true });

type AppInitializationOptions = {
  onInitialFundingRequested?: (context: { createdBotIds: string[]; delayMs: number }) => void | Promise<void>;
  timer?: TimerProvider;
  botLifecycleDeps?: BotLifecycleDependencies;
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
  const app = buildApp(config, {
    stateDir: config.stateDir,
    botCount: state.botsState.bots.length,
    buyChance: config.runtime.trading.buyChance,
    sellChance: config.runtime.trading.sellChance,
    maxAmount: config.runtime.trading.maxAmount,
    createdBotsOnStartup: reconciliation.createdBots.length,
    initialFundingScheduled: fundingSchedule.scheduled
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
    }
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
