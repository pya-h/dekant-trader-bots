import { describe, expect, it, vi } from "vitest";
import { DekantClient, DekantMarket } from "../../src/clients/dekant-client.js";
import { filterEligibleMarkets, MarketCache } from "../../src/markets/cache.js";

function makeDekantClient(fetchMarketsImpl: () => Promise<DekantMarket[]>): DekantClient {
  return {
    fetchMarkets: fetchMarketsImpl,
    fetchPositions: vi.fn(async () => []),
    submitBuyOrder: vi.fn(async () => ({ txId: "buy" })),
    submitSellOrder: vi.fn(async () => ({ txId: "sell" }))
  };
}

describe("filterEligibleMarkets", () => {
  it("keeps tradable crypto markets and excludes ignored/non-crypto/closed", () => {
    const markets: DekantMarket[] = [
      { id: "m1", subject: "BTC",
      collateralMint: "Mint11111111111111111111111111111111111111", category: "crypto", state: 0 },
      { id: "m2", subject: "ETH",
      collateralMint: "Mint11111111111111111111111111111111111111", category: "sports", state: 0 },
      { id: "m3", subject: "SOL",
      collateralMint: "Mint11111111111111111111111111111111111111", category: "crypto", state: 3 },
      { id: "m4", subject: "DOGE",
      collateralMint: "Mint11111111111111111111111111111111111111", category: "crypto", state: 0 }
    ];

    const result = filterEligibleMarkets({
      markets,
      ignoredMarketIds: new Set(["m4"])
    });

    expect(result.map((market) => market.id)).toEqual(["m1"]);
  });
});

describe("MarketCache", () => {
  it("updates active cache on refresh and keeps previous cache on refresh failure", async () => {
    let shouldFail = false;
    const client = makeDekantClient(async () => {
      if (shouldFail) {
        throw new Error("backend-down");
      }

      return [{ id: "m1", subject: "BTC",
      collateralMint: "Mint11111111111111111111111111111111111111", category: "crypto", state: 0 }];
    });

    const cache = new MarketCache({
      client,
      refreshIntervalMs: 1000,
      ignoredMarketIds: []
    });

    const first = await cache.refresh();
    expect(first.updated).toBe(true);
    expect(cache.getSnapshot().markets.map((market) => market.id)).toEqual(["m1"]);

    shouldFail = true;
    const second = await cache.refresh();
    expect(second.updated).toBe(false);

    const snapshot = cache.getSnapshot();
    expect(snapshot.markets.map((market) => market.id)).toEqual(["m1"]);
    expect(snapshot.lastError).toContain("backend-down");
  });
});
