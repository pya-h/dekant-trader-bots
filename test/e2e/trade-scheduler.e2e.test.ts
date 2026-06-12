import request from "supertest";
import { describe, expect, it } from "vitest";
import { createInitializedApp } from "../../src/server.js";
import { DekantClient, DekantMarket } from "../../src/clients/dekant-client.js";
import { MarketPriceResolution, PriceQuote } from "../../src/clients/price-client.js";
import { createBaseEnv } from "../helpers/config.js";
import { InMemoryStateStore } from "../helpers/memory-state-store.js";

const MINT = "Mint11111111111111111111111111111111111111";

function makeMarkets(): DekantMarket[] {
  return [
    { id: "m1", subject: "BTC", collateralMint: MINT, marketType: 2, category: "crypto", state: 0 },
    { id: "m2", subject: "ETH", collateralMint: MINT, marketType: 2, category: "crypto", state: 0 }
  ];
}

function makePriceClient() {
  return {
    resolveMarketPrices: async (
      markets: Array<{ id: string; subject: string }>
    ): Promise<MarketPriceResolution> => {
      const byMarketId: MarketPriceResolution["byMarketId"] = new Map();
      const quotesByToken: MarketPriceResolution["quotesByToken"] = new Map();
      for (const market of markets) {
        const token = market.subject.toUpperCase();
        const quote: PriceQuote = {
          tokenId: token,
          price: 100,
          emaPrice: 100,
          confidence: 0.001,
          timestamp: "2026-01-01T00:00:00.000Z",
          stale: false
        };
        byMarketId.set(market.id, { marketId: market.id, token, status: "ok", quote });
        quotesByToken.set(token, quote);
      }
      return { byMarketId, quotesByToken, missingTokens: [], staleTokens: [] };
    }
  };
}

async function setup(extraEnv: NodeJS.ProcessEnv = {}) {
  const env = createBaseEnv({
    BOT_COUNTS: "1",
    BUY_CHANCE: "100",
    SELL_CHANCE: "0",
    // Large default so only an explicitly-shortened market becomes due in tests.
    TRADE_INTERVAL_MS: "100000",
    ...extraEnv
  });

  const buyCalls: string[] = [];
  const dekantClient: DekantClient = {
    fetchMarkets: async () => makeMarkets(),
    fetchPositions: async () => [],
    submitBuyOrder: async (payload) => {
      buyCalls.push(payload.marketId);
      return { txId: `buy-${buyCalls.length}` };
    },
    submitSellOrder: async () => ({ txId: "sell" })
  };

  let nowMs = Date.parse("2026-01-01T00:00:00.000Z");
  const appCtx = await createInitializedApp(env, {
    store: new InMemoryStateStore(),
    timer: { setTimeout: () => "timeout", clearTimeout: () => {} },
    observability: { now: () => new Date(nowMs) },
    marketCache: { client: dekantClient },
    buy: { dekant: dekantClient, price: makePriceClient(), random: () => 0.5 }
  });

  await appCtx.app.ready();
  await appCtx.markets!.refresh();

  return {
    env,
    appCtx,
    buyCalls,
    advance: (ms: number) => {
      nowMs += ms;
    }
  };
}

describe("per-market trade scheduler", () => {
  it("only fires a market once its own interval has elapsed", async () => {
    const { env, appCtx, buyCalls, advance } = await setup();

    // Shorten m1; m2 keeps the (large) default.
    const set = await request(appCtx.app.server)
      .post("/admin/markets/intervals")
      .set("x-security", env.ADMIN_SECRET as string)
      .send({ intervals: [{ market_id: "m1", interval_ms: 1000 }] });
    expect(set.status).toBe(200);
    expect(set.body.result.marketIntervals).toEqual({ m1: 1000 });

    // First tick stamps both markets "now" — nothing is due yet.
    await appCtx.trading!.tick();
    expect(buyCalls).toEqual([]);

    // Advance past m1's override but not the default: only m1 is due.
    advance(2000);
    await appCtx.trading!.tick();
    expect(buyCalls).toEqual(["m1"]);

    // The scheduler snapshot reflects the override and the persisted config map.
    const status = await request(appCtx.app.server)
      .get("/admin/status")
      .set("x-security", env.ADMIN_SECRET as string);
    expect(status.status).toBe(200);
    const schedule = status.body.runtime.tradeSchedule;
    const m1 = schedule.markets.find((m: { marketId: string }) => m.marketId === "m1");
    const m2 = schedule.markets.find((m: { marketId: string }) => m.marketId === "m2");
    expect(m1).toMatchObject({ intervalMs: 1000, isOverride: true });
    expect(m2).toMatchObject({ intervalMs: 100000, isOverride: false });
    expect(status.body.runtime.config.marketIntervals).toEqual({ m1: 1000 });

    await appCtx.app.close();
  });

  it("clears an override with a null interval and reverts to the default", async () => {
    const { env, appCtx, advance } = await setup();

    await request(appCtx.app.server)
      .post("/admin/markets/intervals")
      .set("x-security", env.ADMIN_SECRET as string)
      .send({ intervals: [{ market_id: "m1", interval_ms: 1000 }] });

    const clear = await request(appCtx.app.server)
      .post("/admin/markets/intervals")
      .set("x-security", env.ADMIN_SECRET as string)
      .send({ intervals: [{ market_id: "m1", interval_ms: null }] });
    expect(clear.status).toBe(200);
    expect(clear.body.result.marketIntervals).toEqual({});

    // With the override gone, m1 now uses the large default and is NOT due 2s later.
    await appCtx.trading!.tick();
    advance(2000);
    await appCtx.trading!.tick();

    const status = await request(appCtx.app.server)
      .get("/admin/status")
      .set("x-security", env.ADMIN_SECRET as string);
    const m1 = status.body.runtime.tradeSchedule.markets.find(
      (m: { marketId: string }) => m.marketId === "m1"
    );
    expect(m1).toMatchObject({ intervalMs: 100000, isOverride: false });
    expect(status.body.runtime.config.marketIntervals).toEqual({});

    await appCtx.app.close();
  });

  it("rejects malformed interval payloads", async () => {
    const { env, appCtx } = await setup();
    const secret = env.ADMIN_SECRET as string;

    const empty = await request(appCtx.app.server)
      .post("/admin/markets/intervals")
      .set("x-security", secret)
      .send({});
    expect(empty.status).toBe(400);

    const emptyList = await request(appCtx.app.server)
      .post("/admin/markets/intervals")
      .set("x-security", secret)
      .send({ intervals: [] });
    expect(emptyList.status).toBe(400);

    const nonPositive = await request(appCtx.app.server)
      .post("/admin/markets/intervals")
      .set("x-security", secret)
      .send({ intervals: [{ market_id: "m1", interval_ms: 0 }] });
    expect(nonPositive.status).toBe(400);

    await appCtx.app.close();
  });

  it("manually refreshes the market list via the admin endpoint", async () => {
    const { env, appCtx } = await setup();

    const res = await request(appCtx.app.server)
      .post("/admin/markets/refresh")
      .set("x-security", env.ADMIN_SECRET as string);

    expect(res.status).toBe(200);
    expect(res.body.result.updated).toBe(true);
    expect(res.body.result.count).toBe(2);

    await appCtx.app.close();
  });

  it("never exposes the Solana RPC URL in the status integration", async () => {
    const { env, appCtx } = await setup();

    const status = await request(appCtx.app.server)
      .get("/admin/status")
      .set("x-security", env.ADMIN_SECRET as string);

    expect(status.status).toBe(200);
    const integration = status.body.runtime.integration;
    expect(integration.dekantBackendUrl).toBeTruthy();
    expect(integration.priceServiceUrl).toBeTruthy();
    expect(integration.solanaRpcUrl).toBeUndefined();
    // Defensive: the raw RPC URL must not leak anywhere in the response body.
    expect(JSON.stringify(status.body)).not.toContain("rpc.example.com");

    await appCtx.app.close();
  });

  it("serves the admin panel HTML at / (same-origin, no auth)", async () => {
    const { appCtx } = await setup();

    const res = await request(appCtx.app.server).get("/");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain("Market Intervals");

    await appCtx.app.close();
  });
});
