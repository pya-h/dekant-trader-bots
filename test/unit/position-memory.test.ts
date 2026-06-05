import { describe, expect, it } from "vitest";
import { BotPositionMemory } from "../../src/state/position-memory.js";
import { InMemoryStateStore } from "../helpers/memory-state-store.js";

function makeMemory() {
  return new BotPositionMemory({ store: new InMemoryStateStore() });
}

describe("BotPositionMemory claim accessors", () => {
  it("lists distinct participated market ids", () => {
    const memory = makeMemory();
    memory.record({ botPubkey: "A", marketId: "10", center: 1, spread: 1 });
    memory.record({ botPubkey: "B", marketId: "10", center: 1, spread: 1 });
    memory.record({ botPubkey: "A", marketId: "20", center: 1, spread: 1 });

    expect(memory.listMarketIds().sort()).toEqual(["10", "20"]);
  });

  it("returns the participant pubkeys for a market", () => {
    const memory = makeMemory();
    memory.record({ botPubkey: "A", marketId: "10", center: 1, spread: 1 });
    memory.record({ botPubkey: "B", marketId: "10", center: 1, spread: 1 });
    memory.record({ botPubkey: "C", marketId: "20", center: 1, spread: 1 });

    expect(memory.botPubkeysForMarket("10").sort()).toEqual(["A", "B"]);
    expect(memory.botPubkeysForMarket("20")).toEqual(["C"]);
    expect(memory.botPubkeysForMarket("99")).toEqual([]);
  });

  it("delete removes a single (bot, market) entry and persists", async () => {
    const store = new InMemoryStateStore();
    const memory = new BotPositionMemory({ store });
    memory.record({ botPubkey: "A", marketId: "10", center: 1, spread: 1 });
    memory.record({ botPubkey: "B", marketId: "10", center: 1, spread: 1 });

    memory.delete("A", "10");
    await memory.flush();

    expect(memory.botPubkeysForMarket("10")).toEqual(["B"]);
    expect(memory.lookup("A", "10")).toBeNull();

    // Persisted: a fresh instance loading the same store sees only B's entry.
    const reloaded = new BotPositionMemory({ store });
    await reloaded.load();
    expect(reloaded.botPubkeysForMarket("10")).toEqual(["B"]);
  });

  it("delete is a no-op for an absent entry", async () => {
    const memory = makeMemory();
    memory.record({ botPubkey: "A", marketId: "10", center: 1, spread: 1 });

    expect(() => memory.delete("Z", "10")).not.toThrow();
    await memory.flush();
    expect(memory.botPubkeysForMarket("10")).toEqual(["A"]);
  });
});
