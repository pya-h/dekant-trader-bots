import { describe, expect, it } from "vitest";
import { runClaimPass, type ClaimClient, type ClaimPositionMemory } from "../../src/trading/claim-engine.js";
import { MarketNotResolvedError, SimulationError } from "../../src/solana/transactions.js";

// Minimal in-memory stand-in for BotPositionMemory's claim surface.
function makeMemory(entries: Array<{ botPubkey: string; marketId: string }>): ClaimPositionMemory & {
  remaining: () => Array<{ botPubkey: string; marketId: string }>;
} {
  let rows = entries.slice();
  return {
    listMarketIds: () => [...new Set(rows.map((r) => r.marketId))],
    botPubkeysForMarket: (marketId) => rows.filter((r) => r.marketId === marketId).map((r) => r.botPubkey),
    delete: (botPubkey, marketId) => {
      rows = rows.filter((r) => !(r.botPubkey === botPubkey && r.marketId === marketId));
    },
    remaining: () => rows
  };
}

const BOTS = [
  { id: "bot-1", publicKey: "PubOne" },
  { id: "bot-2", publicKey: "PubTwo" }
];

function anchorSimError(code: string): SimulationError {
  return new SimulationError(`simulate_failed anchor=${code}`, ["log"], { code });
}

describe("runClaimPass", () => {
  it("claims resolved-market positions and prunes them", async () => {
    const memory = makeMemory([
      { botPubkey: "PubOne", marketId: "10" },
      { botPubkey: "PubTwo", marketId: "10" }
    ]);
    const calls: Array<{ botId: string; marketId: string }> = [];
    const client: ClaimClient = {
      submitClaimPayout: async (input) => {
        calls.push(input);
        return { txId: `tx-${input.botId}` };
      }
    };

    const result = await runClaimPass({
      client,
      positionMemory: memory,
      getBots: () => BOTS,
      activeMarketIds: new Set<string>()
    });

    expect(calls).toEqual([
      { botId: "bot-1", marketId: "10" },
      { botId: "bot-2", marketId: "10" }
    ]);
    expect(result.claimed).toBe(2);
    expect(result.pruned).toBe(2);
    expect(result.marketsResolved).toBe(1);
    expect(memory.remaining()).toEqual([]);
  });

  it("excludes still-active markets from claim candidates", async () => {
    const memory = makeMemory([{ botPubkey: "PubOne", marketId: "10" }]);
    let called = false;
    const client: ClaimClient = {
      submitClaimPayout: async () => {
        called = true;
        return { txId: "tx" };
      }
    };

    const result = await runClaimPass({
      client,
      positionMemory: memory,
      getBots: () => BOTS,
      activeMarketIds: new Set(["10"])
    });

    expect(called).toBe(false);
    expect(result.candidateMarkets).toBe(0);
    expect(memory.remaining()).toHaveLength(1);
  });

  it("keeps the whole market when it is not resolved yet", async () => {
    const memory = makeMemory([
      { botPubkey: "PubOne", marketId: "10" },
      { botPubkey: "PubTwo", marketId: "10" }
    ]);
    const calls: string[] = [];
    const client: ClaimClient = {
      submitClaimPayout: async (input) => {
        calls.push(input.botId);
        throw new MarketNotResolvedError(0);
      }
    };

    const result = await runClaimPass({
      client,
      positionMemory: memory,
      getBots: () => BOTS,
      activeMarketIds: new Set<string>()
    });

    // Stops at the first bot once the market reads as not resolved.
    expect(calls).toEqual(["bot-1"]);
    expect(result.marketsPending).toBe(1);
    expect(result.claimed).toBe(0);
    expect(memory.remaining()).toHaveLength(2);
  });

  it("prunes on terminal errors (AlreadyClaimed / NothingToClaim)", async () => {
    const memory = makeMemory([
      { botPubkey: "PubOne", marketId: "10" },
      { botPubkey: "PubTwo", marketId: "10" }
    ]);
    const client: ClaimClient = {
      submitClaimPayout: async (input) =>
        Promise.reject(anchorSimError(input.botId === "bot-1" ? "AlreadyClaimed" : "NothingToClaim"))
    };

    const result = await runClaimPass({
      client,
      positionMemory: memory,
      getBots: () => BOTS,
      activeMarketIds: new Set<string>()
    });

    expect(result.claimed).toBe(0);
    expect(result.pruned).toBe(2);
    expect(result.failed).toBe(0);
    expect(memory.remaining()).toEqual([]);
  });

  it("keeps the entry on transient errors for a later pass", async () => {
    const memory = makeMemory([{ botPubkey: "PubOne", marketId: "10" }]);
    const client: ClaimClient = {
      submitClaimPayout: async () => Promise.reject(new Error("rpc timeout"))
    };

    const result = await runClaimPass({
      client,
      positionMemory: memory,
      getBots: () => BOTS,
      activeMarketIds: new Set<string>()
    });

    expect(result.failed).toBe(1);
    expect(result.pruned).toBe(0);
    expect(memory.remaining()).toHaveLength(1);
  });

  it("drops stale entries for bots no longer in the fleet without calling claim", async () => {
    const memory = makeMemory([{ botPubkey: "GonePub", marketId: "10" }]);
    let called = false;
    const client: ClaimClient = {
      submitClaimPayout: async () => {
        called = true;
        return { txId: "tx" };
      }
    };

    const result = await runClaimPass({
      client,
      positionMemory: memory,
      getBots: () => BOTS,
      activeMarketIds: new Set<string>()
    });

    expect(called).toBe(false);
    expect(result.pruned).toBe(1);
    expect(memory.remaining()).toEqual([]);
  });
});
