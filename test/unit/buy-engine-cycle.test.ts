import { describe, expect, it, vi } from "vitest";
import { BuyEngine } from "../../src/trading/buy-engine.js";

const now = new Date("2026-05-07T00:00:00.000Z");

describe("BuyEngine cycle isolation", () => {
  it("keeps processing other bot/market actions when one trade submit fails", async () => {
    const bots = [
      {
        id: "bot-1",
        publicKey: "pub-1",
        secretKey: "sec-1",
        createdAt: now.toISOString(),
        lastActiveAt: null
      },
      {
        id: "bot-2",
        publicKey: "pub-2",
        secretKey: "sec-2",
        createdAt: now.toISOString(),
        lastActiveAt: null
      }
    ];

    const markets = [
      { id: "m1", subject: "BTC", deadline: "2026-07-01T00:00:00.000Z", liquidity: 100_000 },
      { id: "m2", subject: "ETH", deadline: "2026-07-01T00:00:00.000Z", liquidity: 90_000 }
    ];

    let submitCalls = 0;
    const engine = new BuyEngine({
      runtime: {
        buyChance: 100,
        maxAmount: 50,
        intervalMs: 1_000
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
                price: 90_000,
                emaPrice: 90_100,
                confidence: 0.001,
                timestamp: now.toISOString(),
                stale: false
              }
            });
            byMarketId.set("m2", {
              marketId: "m2",
              token: "ETH",
              status: "ok",
              quote: {
                tokenId: "ETH",
                price: 3_000,
                emaPrice: 3_010,
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
          submitBuyOrder: async () => {
            submitCalls += 1;
            if (submitCalls === 1) {
              throw new Error("tx_failed_once");
            }
            return { txId: `tx-${submitCalls}` };
          }
        }
      },
      getBots: () => bots,
      getMarkets: () => markets,
      now: () => now,
      random: () => 0.5
    });

    const result = await engine.runCycle({ source: "manual" });

    expect(result.actions).toHaveLength(4);
    expect(result.failedSubmitCount).toBe(1);
    expect(result.submittedCount).toBe(3);
    expect(submitCalls).toBe(4);
  });

  it("keeps scheduler alive by catching interval errors", async () => {
    let intervalHandler: () => void = () => {};
    const onCycleError = vi.fn();

    const engine = new BuyEngine({
      runtime: {
        buyChance: 100,
        maxAmount: 10,
        intervalMs: 1_000
      },
      clients: {
        price: {
          resolveMarketPrices: async () => {
            throw new TypeError("price_down");
          }
        },
        dekant: {
          submitBuyOrder: async () => ({ txId: "tx-ok" })
        }
      },
      getBots: () => [
        {
          id: "bot-1",
          publicKey: "pub-1",
          secretKey: "sec-1",
          createdAt: now.toISOString(),
          lastActiveAt: null
        }
      ],
      getMarkets: () => [{ id: "m1", subject: "BTC", liquidity: 100_000, deadline: "2026-07-01T00:00:00.000Z" }],
      now: () => now,
      onCycleError,
      timer: {
        setInterval: (handler) => {
          intervalHandler = handler;
          return "interval-id";
        },
        clearInterval: () => {}
      }
    });

    await expect(engine.start({ immediate: false })).resolves.toBeUndefined();
    expect(onCycleError).toHaveBeenCalledTimes(0);

    intervalHandler();
    await Promise.resolve();
    await Promise.resolve();

    expect(onCycleError).toHaveBeenCalledTimes(1);
  });
});
