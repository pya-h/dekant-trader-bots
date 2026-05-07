import dotenv from "dotenv";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

dotenv.config();

async function start(): Promise<void> {
  const config = loadConfig();
  const app = buildApp(config);

  await app.listen({ host: config.host, port: config.port });
}

start().catch((error) => {
  console.error("failed_to_start", error);
  process.exit(1);
});
