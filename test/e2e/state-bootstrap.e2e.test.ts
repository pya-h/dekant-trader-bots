import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createInitializedApp } from "../../src/server.js";
import { createBaseEnv } from "../helpers/config.js";

const tempRoots: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dtb-e2e-"));
  tempRoots.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempRoots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tempRoots.length = 0;
});

describe("state bootstrap", () => {
  it("creates state files, creates startup bots, and schedules initial funding on first startup", async () => {
    const tempRoot = await createTempDir();
    const stateDir = path.join(tempRoot, "state");
    const env = createBaseEnv({
      STATE_DIR: stateDir,
      BOT_COUNTS: "3",
      INITIAL_FUNDING_DELAY_MS: "7777"
    });

    let scheduledDelay = -1;
    let scheduledHandler: (() => void) | null = null;
    const fundingTriggerCalls: string[][] = [];

    const { app, state, startup } = await createInitializedApp(env, {
      timer: {
        setTimeout: (handler, timeoutMs) => {
          scheduledDelay = timeoutMs;
          scheduledHandler = handler;
          return "fake-handle";
        },
        clearTimeout: () => {}
      },
      onInitialFundingRequested: async (context) => {
        fundingTriggerCalls.push(context.createdBotIds);
      }
    });
    await app.ready();

    await fs.access(state.files.runtimeConfigPath);
    await fs.access(state.files.botsStatePath);
    expect(startup.createdBots).toHaveLength(3);
    expect(startup.initialFundingScheduled).toBe(true);
    expect(scheduledDelay).toBe(7777);

    const response = await request(app.server)
      .get("/admin/status")
      .set("x-security", env.ADMIN_SECRET as string);

    expect(response.status).toBe(200);
    expect(response.body.runtime.botCount).toBe(3);
    expect(response.body.runtime.initialFundingScheduled).toBe(true);

    expect(scheduledHandler).toBeTypeOf("function");
    (scheduledHandler as unknown as () => void)();
    expect(fundingTriggerCalls).toHaveLength(1);
    expect(fundingTriggerCalls[0]).toHaveLength(3);

    await app.close();
  });

  it("loads persisted mutable config on restart", async () => {
    const tempRoot = await createTempDir();
    const stateDir = path.join(tempRoot, "state");

    const firstEnv = createBaseEnv({ STATE_DIR: stateDir, BUY_CHANCE: "90" });
    const first = await createInitializedApp(firstEnv, {
      timer: {
        setTimeout: () => "handle",
        clearTimeout: () => {}
      }
    });
    await first.app.ready();
    await first.app.close();

    const runtimeRaw = JSON.parse(await fs.readFile(first.state.files.runtimeConfigPath, "utf8"));
    runtimeRaw.config.trading.buyChance = 41;
    await fs.writeFile(first.state.files.runtimeConfigPath, `${JSON.stringify(runtimeRaw, null, 2)}\n`);

    const secondEnv = createBaseEnv({ STATE_DIR: stateDir, BUY_CHANCE: "12" });
    const second = await createInitializedApp(secondEnv, {
      timer: {
        setTimeout: () => "handle",
        clearTimeout: () => {}
      }
    });
    await second.app.ready();

    const response = await request(second.app.server)
      .get("/admin/status")
      .set("x-security", secondEnv.ADMIN_SECRET as string);

    expect(response.status).toBe(200);
    expect(response.body.runtime.buyChance).toBe(41);

    await second.app.close();
  });

  it("does not duplicate bots on restart and supports add-bots internal workflow", async () => {
    const tempRoot = await createTempDir();
    const stateDir = path.join(tempRoot, "state");

    const firstEnv = createBaseEnv({ STATE_DIR: stateDir, BOT_COUNTS: "2" });
    const first = await createInitializedApp(firstEnv, {
      timer: {
        setTimeout: () => "handle",
        clearTimeout: () => {}
      }
    });
    await first.app.ready();
    await first.app.close();

    const second = await createInitializedApp(firstEnv, {
      timer: {
        setTimeout: () => "handle",
        clearTimeout: () => {}
      }
    });
    await second.app.ready();

    expect(second.startup.createdBots).toHaveLength(0);
    expect(second.state.botsState.bots).toHaveLength(2);
    expect(second.startup.initialFundingScheduled).toBe(false);

    const added = await second.botLifecycle.addBots(2);
    expect(added.addedBots).toHaveLength(2);
    expect(added.totalBotCount).toBe(4);

    const persisted = JSON.parse(await fs.readFile(second.state.files.botsStatePath, "utf8"));
    expect(persisted.bots).toHaveLength(4);

    await second.app.close();
  });
});
