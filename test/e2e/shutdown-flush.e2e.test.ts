import { describe, expect, it } from "vitest";
import { createInitializedApp } from "../../src/server.js";
import { createBaseEnv } from "../helpers/config.js";
import { InMemoryStateStore } from "../helpers/memory-state-store.js";
import type { StateStore } from "../../src/storage/state-store.js";
import type { BotPositionMemoryFile } from "../../src/state/types.js";

const timer = { setTimeout: () => "handle", clearTimeout: () => {} };

// Wraps InMemoryStateStore but delays the position-memory save, so a shutdown
// that does NOT await positionMemory.flush() would tear down before the write
// lands. With the flush in onClose, the data is guaranteed persisted on close.
function delayedStore(inner: InMemoryStateStore, delayMs: number): StateStore {
  return {
    initialize: () => inner.initialize(),
    close: () => inner.close(),
    loadRuntimeConfig: () => inner.loadRuntimeConfig(),
    saveRuntimeConfig: (c) => inner.saveRuntimeConfig(c),
    loadBotsState: () => inner.loadBotsState(),
    saveBotsState: (s) => inner.saveBotsState(s),
    loadBotPositionMemory: () => inner.loadBotPositionMemory(),
    saveBotPositionMemory: async (m: BotPositionMemoryFile) => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      await inner.saveBotPositionMemory(m);
    }
  };
}

describe("shutdown flushes position memory", () => {
  it("persists a recorded position before the store is closed", async () => {
    const inner = new InMemoryStateStore();
    const store = delayedStore(inner, 40);

    const appCtx = await createInitializedApp(createBaseEnv({ BOT_COUNTS: "1" }), { store, timer });
    await appCtx.app.ready();

    const bot = appCtx.state.botsState.bots[0];
    // Fire-and-forget record, exactly as the buy engine's onSubmitted does.
    appCtx.positionMemory.record({ botPubkey: bot.publicKey, marketId: "555", center: 100, spread: 1 });

    // Close immediately — onClose must await the queued (delayed) save.
    await appCtx.app.close();

    // The entry is in the store right after close resolved (no extra waiting).
    const persisted = await inner.loadBotPositionMemory();
    const entry = persisted?.entries.find((e) => e.botPubkey === bot.publicKey && e.marketId === "555");
    expect(entry).toBeDefined();
    expect(entry?.center).toBe(100);
  });
});
