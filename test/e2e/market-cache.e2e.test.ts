import { describe, expect, it, vi } from "vitest";
import { DekantClient, DekantMarket } from "../../src/clients/dekant-client.js";
import { MarketCache } from "../../src/markets/cache.js";

function makeDekantClient(fetchMarketsImpl: () => Promise<DekantMarket[]>): DekantClient {
  return {
    fetchMarkets: fetchMarketsImpl,
    fetchPositions: vi.fn(async () => []),
    submitBuyOrder: vi.fn(async () => ({ txId: "buy" })),
    submitSellOrder: vi.fn(async () => ({ txId: "sell" }))
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(
  predicate: () => boolean,
  options: {
    timeoutMs?: number;
    stepMs?: number;
  } = {}
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 700;
  const stepMs = options.stepMs ?? 15;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (predicate()) {
      return;
    }

    await sleep(stepMs);
  }

  throw new Error("wait_timeout");
}

describe("market cache integration", () => {
  it("scheduler refresh updates active market set over time", async () => {
    const sequence: DekantMarket[][] = [
      [{ id: "m1", subject: "BTC",
      collateralMint: "Mint11111111111111111111111111111111111111", category: "crypto", state: 0 }],
      [{ id: "m2", subject: "ETH",
      collateralMint: "Mint11111111111111111111111111111111111111", category: "crypto", state: 0 }]
    ];
    let call = 0;

    const client = makeDekantClient(async () => {
      const index = Math.min(call, sequence.length - 1);
      call += 1;
      return sequence[index];
    });

    const cache = new MarketCache({
      client,
      refreshIntervalMs: 30
    });

    await cache.start({ immediate: true });

    await waitFor(() => cache.getSnapshot().markets.map((market) => market.id).includes("m1"));
    await waitFor(() => cache.getSnapshot().markets.map((market) => market.id).includes("m2"));

    expect(cache.getSnapshot().markets.map((market) => market.id)).toEqual(["m2"]);

    cache.stop();
  });

  it("ignored market updates affect subsequent refresh results", async () => {
    const client = makeDekantClient(async () => [
      { id: "m1", subject: "BTC",
      collateralMint: "Mint11111111111111111111111111111111111111", category: "crypto", state: 0 },
      { id: "m2", subject: "SOL",
      collateralMint: "Mint11111111111111111111111111111111111111", category: "crypto", state: 0 }
    ]);

    const cache = new MarketCache({
      client,
      refreshIntervalMs: 1000
    });

    await cache.refresh();
    expect(cache.getSnapshot().markets.map((market) => market.id).sort()).toEqual(["m1", "m2"]);

    cache.addIgnoredMarketIds(["m2"]);
    await cache.refresh();
    expect(cache.getSnapshot().markets.map((market) => market.id)).toEqual(["m1"]);

    cache.removeIgnoredMarketIds(["m2"]);
    await cache.refresh();
    expect(cache.getSnapshot().markets.map((market) => market.id).sort()).toEqual(["m1", "m2"]);
  });
});
