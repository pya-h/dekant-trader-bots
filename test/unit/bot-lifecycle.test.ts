import { describe, expect, it } from "vitest";
import { addBotsAndPersist, reconcileBotsToTarget } from "../../src/bots/lifecycle.js";
import { BotsStateFile } from "../../src/state/types.js";
import { InMemoryStateStore } from "../helpers/memory-state-store.js";

function makeBaseState(botCount = 0): BotsStateFile {
  return {
    version: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    bots: Array.from({ length: botCount }, (_, index) => ({
      id: `bot-${index + 1}`,
      publicKey: `pub-${index + 1}`,
      secretKey: `sec-${index + 1}`,
      createdAt: "2026-01-01T00:00:00.000Z",
      lastActiveAt: null
    }))
  };
}

describe("reconcileBotsToTarget", () => {
  it("creates only missing bots to reach target", () => {
    const result = reconcileBotsToTarget(makeBaseState(1), 3, {
      now: () => new Date("2026-01-02T00:00:00.000Z"),
      generateBotId: (() => {
        let i = 0;
        return () => `new-${++i}`;
      })(),
      generateKeypair: (() => {
        let i = 0;
        return () => {
          i += 1;
          return { publicKey: `new-pub-${i}`, secretKey: `new-sec-${i}` };
        };
      })()
    });

    expect(result.createdBots).toHaveLength(2);
    expect(result.updatedState.bots).toHaveLength(3);
    expect(result.updatedState.bots[0].id).toBe("bot-1");
    expect(result.updatedState.bots[1].id).toBe("new-1");
    expect(result.updatedState.bots[2].id).toBe("new-2");
  });

  it("reuses existing bots on restart when target already met", () => {
    const initial = makeBaseState(2);

    const result = reconcileBotsToTarget(initial, 2);

    expect(result.createdBots).toHaveLength(0);
    expect(result.updatedState.bots).toHaveLength(2);
    expect(result.updatedState.bots[0].publicKey).toBe(initial.bots[0].publicKey);
  });
});

describe("addBotsAndPersist", () => {
  it("adds requested bots and persists updated state", async () => {
    const store = new InMemoryStateStore();

    const result = await addBotsAndPersist({
      store,
      botsState: makeBaseState(1),
      count: 2,
      deps: {
        now: () => new Date("2026-01-03T00:00:00.000Z"),
        generateBotId: (() => {
          let i = 10;
          return () => `bot-${++i}`;
        })(),
        generateKeypair: (() => {
          let i = 10;
          return () => {
            i += 1;
            return { publicKey: `pub-${i}`, secretKey: `sec-${i}` };
          };
        })()
      }
    });

    expect(result.addedBots).toHaveLength(2);
    expect(result.updatedState.bots).toHaveLength(3);

    const persisted = await store.loadBotsState();
    expect(persisted!.bots).toHaveLength(3);
  });
});
