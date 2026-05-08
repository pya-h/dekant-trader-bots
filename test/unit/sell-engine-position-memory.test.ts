import { describe, expect, it } from "vitest";
import { SellEngine } from "../../src/trading/sell-engine.js";

const now = new Date("2026-05-07T00:00:00.000Z");

describe("SellEngine with stored position center", () => {
  it("uses persisted center to decide far-from-range and submits a sell", async () => {
    const bots = [
      {
        id: "bot-1",
        publicKey: "pub-1",
        secretKey: "sec-1",
        createdAt: now.toISOString(),
        lastActiveAt: null
      }
    ];

    const markets = [
      {
        id: "m1",
        subject: "BTC",
        collateralMint: "Mint11111111111111111111111111111111111111",
        deadline: "2026-07-01T00:00:00.000Z"
      }
    ];

    // Position carries a stored center far from current market price (90k vs 60k),
    // simulating PgStateStore-backed memory replayed into SolanaDekantClient.
    const positions = [
      {
        id: "p1",
        marketId: "m1",
        token: "BTC",
        amount: 5,
        center: 90_000
      }
    ];

    let sellCalls = 0;
    const engine = new SellEngine({
      runtime: {
        sellChance: 100,
        intervalMs: 1_000,
        partialBiasPercent: 0
      },
      clients: {
        price: {
          resolveMarketPrices: async () => {
            const byMarketId = new Map();
            byMarketId.set("m1", {
              marketId: "m1",
              token: "BTC",
              status: "ok",
              quote: {
                tokenId: "BTC",
                price: 60_000,
                emaPrice: 60_100,
                confidence: 0.001,
                timestamp: now.toISOString(),
                stale: false
              }
            });
            return {
              byMarketId,
              quotesByToken: new Map(),
              missingTokens: [],
              staleTokens: []
            };
          }
        },
        dekant: {
          fetchPositions: async () => positions,
          submitSellOrder: async () => {
            sellCalls += 1;
            return { txId: "tx-sell-1" };
          }
        }
      },
      getBots: () => bots,
      getMarkets: () => markets,
      now: () => now,
      random: () => 0.5
    });

    const result = await engine.runCycle({ source: "manual" });

    expect(result.actions).toHaveLength(1);
    expect(result.skippedNoReferenceCount).toBe(0);
    expect(result.soldFullCount).toBe(1);
    expect(sellCalls).toBe(1);
  });

  it("skips with skipped_no_reference when stored center is missing", async () => {
    const bots = [
      {
        id: "bot-1",
        publicKey: "pub-1",
        secretKey: "sec-1",
        createdAt: now.toISOString(),
        lastActiveAt: null
      }
    ];
    const markets = [
      {
        id: "m1",
        subject: "BTC",
        collateralMint: "Mint11111111111111111111111111111111111111",
        deadline: "2026-07-01T00:00:00.000Z"
      }
    ];
    const positions = [
      // No center on the position (the on-chain client could not find one in memory).
      { id: "p1", marketId: "m1", token: "BTC", amount: 5 }
    ];

    let sellCalls = 0;
    const engine = new SellEngine({
      runtime: { sellChance: 100, intervalMs: 1_000 },
      clients: {
        price: {
          resolveMarketPrices: async () => {
            const byMarketId = new Map();
            byMarketId.set("m1", {
              marketId: "m1",
              token: "BTC",
              status: "ok",
              quote: {
                tokenId: "BTC",
                price: 60_000,
                emaPrice: 60_100,
                confidence: 0.001,
                timestamp: now.toISOString(),
                stale: false
              }
            });
            return {
              byMarketId,
              quotesByToken: new Map(),
              missingTokens: [],
              staleTokens: []
            };
          }
        },
        dekant: {
          fetchPositions: async () => positions,
          submitSellOrder: async () => {
            sellCalls += 1;
            return { txId: "tx-sell-1" };
          }
        }
      },
      getBots: () => bots,
      getMarkets: () => markets,
      now: () => now,
      random: () => 0.5
    });

    const result = await engine.runCycle({ source: "manual" });
    expect(result.skippedNoReferenceCount).toBe(1);
    expect(result.actions[0]?.status).toBe("skipped_no_reference");
    expect(sellCalls).toBe(0);
  });
});
