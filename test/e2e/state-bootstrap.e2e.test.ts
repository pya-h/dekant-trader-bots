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
  it("creates state files on first startup", async () => {
    const tempRoot = await createTempDir();
    const stateDir = path.join(tempRoot, "state");
    const env = createBaseEnv({ STATE_DIR: stateDir });

    const { app, state } = await createInitializedApp(env);
    await app.ready();

    await fs.access(state.files.runtimeConfigPath);
    await fs.access(state.files.botsStatePath);

    const response = await request(app.server)
      .get("/admin/status")
      .set("x-security", env.ADMIN_SECRET as string);

    expect(response.status).toBe(200);
    expect(response.body.runtime.botCount).toBe(0);

    await app.close();
  });

  it("loads persisted mutable config on restart", async () => {
    const tempRoot = await createTempDir();
    const stateDir = path.join(tempRoot, "state");

    const firstEnv = createBaseEnv({ STATE_DIR: stateDir, BUY_CHANCE: "90" });
    const first = await createInitializedApp(firstEnv);
    await first.app.ready();
    await first.app.close();

    const runtimeRaw = JSON.parse(await fs.readFile(first.state.files.runtimeConfigPath, "utf8"));
    runtimeRaw.config.trading.buyChance = 41;
    await fs.writeFile(first.state.files.runtimeConfigPath, `${JSON.stringify(runtimeRaw, null, 2)}\n`);

    const secondEnv = createBaseEnv({ STATE_DIR: stateDir, BUY_CHANCE: "12" });
    const second = await createInitializedApp(secondEnv);
    await second.app.ready();

    const response = await request(second.app.server)
      .get("/admin/status")
      .set("x-security", secondEnv.ADMIN_SECRET as string);

    expect(response.status).toBe(200);
    expect(response.body.runtime.buyChance).toBe(41);

    await second.app.close();
  });
});
