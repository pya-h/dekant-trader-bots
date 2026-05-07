import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBaseEnv } from "../helpers/config.js";
import { loadEnvConfig } from "../../src/config.js";
import {
  ensureRuntimeConfig,
  makeInitialRuntimeConfig,
  saveRuntimeConfig
} from "../../src/storage/runtime-config-store.js";

const tempRoots: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dtb-runtime-"));
  tempRoots.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempRoots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tempRoots.length = 0;
});

describe("runtime-config-store", () => {
  it("bootstraps runtime config on first run", async () => {
    const dir = await createTempDir();
    const filePath = path.join(dir, "runtime-config.json");
    const envConfig = loadEnvConfig(createBaseEnv());

    const config = await ensureRuntimeConfig(filePath, makeInitialRuntimeConfig(envConfig));

    expect(config.config.trading.buyChance).toBe(90);

    const saved = JSON.parse(await fs.readFile(filePath, "utf8"));
    expect(saved.version).toBe(1);
  });

  it("reloads persisted config instead of overriding with env defaults", async () => {
    const dir = await createTempDir();
    const filePath = path.join(dir, "runtime-config.json");

    const firstEnv = loadEnvConfig(createBaseEnv({ BUY_CHANCE: "90" }));
    const first = await ensureRuntimeConfig(filePath, makeInitialRuntimeConfig(firstEnv));

    const modified = {
      ...first,
      updatedAt: new Date().toISOString(),
      config: {
        ...first.config,
        trading: {
          ...first.config.trading,
          buyChance: 42
        }
      }
    };
    await saveRuntimeConfig(filePath, modified);

    const secondEnv = loadEnvConfig(createBaseEnv({ BUY_CHANCE: "12" }));
    const second = await ensureRuntimeConfig(filePath, makeInitialRuntimeConfig(secondEnv));

    expect(second.config.trading.buyChance).toBe(42);
  });

  it("fails when persisted file has invalid schema", async () => {
    const dir = await createTempDir();
    const filePath = path.join(dir, "runtime-config.json");

    await fs.writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        updatedAt: new Date().toISOString(),
        config: {
          ignoredMarketIds: [],
          trading: {
            buyChance: 90
          }
        }
      })
    );

    const env = loadEnvConfig(createBaseEnv());
    await expect(ensureRuntimeConfig(filePath, makeInitialRuntimeConfig(env))).rejects.toThrow();
  });
});
