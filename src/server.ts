import { pathToFileURL } from "node:url";
import dotenv from "dotenv";
import { buildApp } from "./app.js";
import { bootstrapConfig } from "./bootstrap.js";

dotenv.config({ quiet: true });

export async function createInitializedApp(env: NodeJS.ProcessEnv = process.env) {
  const { config, state } = await bootstrapConfig(env);
  const app = buildApp(config, {
    stateDir: config.stateDir,
    botCount: state.botsState.bots.length,
    buyChance: config.runtime.trading.buyChance,
    sellChance: config.runtime.trading.sellChance,
    maxAmount: config.runtime.trading.maxAmount
  });

  return { app, config, state };
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
