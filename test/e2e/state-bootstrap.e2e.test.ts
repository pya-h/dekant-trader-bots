import request from "supertest";
import { describe, expect, it } from "vitest";
import { createInitializedApp } from "../../src/server.js";
import { createBaseEnv } from "../helpers/config.js";
import { InMemoryStateStore } from "../helpers/memory-state-store.js";

describe("state bootstrap", () => {
  it("creates state, creates startup bots, and schedules initial funding on first startup", async () => {
    const env = createBaseEnv({
      BOT_COUNTS: "3",
      INITIAL_FUNDING_DELAY_MS: "7777"
    });

    let scheduledDelay = -1;
    let scheduledHandler: (() => void) | null = null;
    const fundingTriggerCalls: string[][] = [];

    const { app, startup } = await createInitializedApp(env, {
      store: new InMemoryStateStore(),
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
    const store = new InMemoryStateStore();

    const firstEnv = createBaseEnv({ BUY_CHANCE: "90" });
    const first = await createInitializedApp(firstEnv, {
      store,
      timer: {
        setTimeout: () => "handle",
        clearTimeout: () => {}
      }
    });
    await first.app.ready();

    const patchResponse = await request(first.app.server)
      .patch("/admin/config")
      .set("x-security", firstEnv.ADMIN_SECRET as string)
      .send({ trading: { buyChance: 41 } });

    expect(patchResponse.status).toBe(200);
    await first.app.close();

    const secondEnv = createBaseEnv({ BUY_CHANCE: "12" });
    const second = await createInitializedApp(secondEnv, {
      store,
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
    const store = new InMemoryStateStore();

    const env = createBaseEnv({ BOT_COUNTS: "2" });
    const first = await createInitializedApp(env, {
      store,
      timer: {
        setTimeout: () => "handle",
        clearTimeout: () => {}
      }
    });
    await first.app.ready();
    await first.app.close();

    const second = await createInitializedApp(env, {
      store,
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

    const persisted = await store.loadBotsState();
    expect(persisted!.bots).toHaveLength(4);

    await second.app.close();
  });
});
