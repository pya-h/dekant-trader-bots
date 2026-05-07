import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { DekantClient, DekantMarket, SubmitTradeRequest } from "../../src/clients/dekant-client.js";
import { MarketPriceResolution, PriceQuote } from "../../src/clients/price-client.js";
import { createInitializedApp } from "../../src/server.js";
import { createBaseEnv } from "../helpers/config.js";

const tempRoots: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dtb-buy-e2e-"));
  tempRoots.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempRoots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tempRoots.length = 0;
});

function createBuyHarness(markets: DekantMarket[]) {
  const submitBuyCalls: SubmitTradeRequest[] = [];
  let priceResolveCalls = 0;
  let lastResolvedMarkets: Array<{ id: string; subject: string }> = [];

  const dekantClient: DekantClient = {
    fetchMarkets: async () => markets,
    fetchPositions: async () => [],
    submitBuyOrder: async (input) => {
      submitBuyCalls.push(input);
      return { txId: `buy-${submitBuyCalls.length}` };
    },
    submitSellOrder: async () => ({ txId: "sell-1" }),
    prepareBotUser: async () => ({ userId: "u1", publicKey: "p1" })
  };

  const priceClient = {
    resolveMarketPrices: async (
      requestedMarkets: Array<{ id: string; subject: string }>
    ): Promise<MarketPriceResolution> => {
      priceResolveCalls += 1;
      lastResolvedMarkets = [...requestedMarkets];

      const byMarketId: MarketPriceResolution["byMarketId"] = new Map();
      const quotesByToken: MarketPriceResolution["quotesByToken"] = new Map();

      for (const market of requestedMarkets) {
        const token = market.subject.trim().toUpperCase();
        const quote: PriceQuote = {
          tokenId: token,
          price: token === "BTC" ? 90_000 : token === "ETH" ? 3_000 : 200,
          emaPrice: token === "BTC" ? 90_050 : token === "ETH" ? 3_005 : 202,
          confidence: 0.001,
          timestamp: "2026-01-01T00:00:00.000Z",
          stale: false
        };

        byMarketId.set(market.id, {
          marketId: market.id,
          token,
          status: "ok",
          quote
        });
        quotesByToken.set(token, quote);
      }

      return {
        byMarketId,
        quotesByToken,
        missingTokens: [],
        staleTokens: []
      };
    }
  };

  return {
    dekantClient,
    priceClient,
    submitBuyCalls,
    getPriceResolveCalls: () => priceResolveCalls,
    getLastResolvedMarkets: () => lastResolvedMarkets
  };
}

describe("buy engine integration", () => {
  it("forced buy endpoint triggers an immediate buy cycle", async () => {
    const tempRoot = await createTempDir();
    const stateDir = path.join(tempRoot, "state");
    const env = createBaseEnv({
      STATE_DIR: stateDir,
      BOT_COUNTS: "2",
      BUY_CHANCE: "100",
      MAX_AMOUNT: "50"
    });

    const markets: DekantMarket[] = [
      { id: "m1", subject: "BTC", category: "crypto", status: "open", liquidity: 100_000 },
      { id: "m2", subject: "ETH", category: "crypto", status: "open", liquidity: 80_000 }
    ];

    const harness = createBuyHarness(markets);

    const appCtx = await createInitializedApp(env, {
      timer: {
        setTimeout: () => "handle",
        clearTimeout: () => {}
      },
      marketCache: {
        client: harness.dekantClient
      },
      buy: {
        dekant: harness.dekantClient,
        price: harness.priceClient,
        random: () => 0.25
      }
    });

    await appCtx.app.ready();
    await appCtx.markets!.refresh();

    const response = await request(appCtx.app.server)
      .post("/admin/bots/buy")
      .set("x-security", env.ADMIN_SECRET as string)
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
    expect(response.body.cycle.source).toBe("manual");
    expect(response.body.cycle.submittedCount).toBe(4);
    expect(harness.submitBuyCalls).toHaveLength(4);
    expect(harness.getPriceResolveCalls()).toBe(1);

    await appCtx.app.close();
  });

  it("forced buy endpoint market_ids filter scopes bot buys to selected markets", async () => {
    const tempRoot = await createTempDir();
    const stateDir = path.join(tempRoot, "state");
    const env = createBaseEnv({
      STATE_DIR: stateDir,
      BOT_COUNTS: "3",
      BUY_CHANCE: "100",
      MAX_AMOUNT: "50"
    });

    const markets: DekantMarket[] = [
      { id: "m1", subject: "BTC", category: "crypto", status: "open", liquidity: 100_000 },
      { id: "m2", subject: "ETH", category: "crypto", status: "open", liquidity: 90_000 },
      { id: "m3", subject: "SOL", category: "crypto", status: "open", liquidity: 70_000 }
    ];

    const harness = createBuyHarness(markets);

    const appCtx = await createInitializedApp(env, {
      timer: {
        setTimeout: () => "handle",
        clearTimeout: () => {}
      },
      marketCache: {
        client: harness.dekantClient
      },
      buy: {
        dekant: harness.dekantClient,
        price: harness.priceClient,
        random: () => 0.5
      }
    });

    await appCtx.app.ready();
    await appCtx.markets!.refresh();

    const response = await request(appCtx.app.server)
      .post("/admin/bots/buy")
      .set("x-security", env.ADMIN_SECRET as string)
      .send({ market_ids: ["m2"] });

    expect(response.status).toBe(200);
    expect(response.body.cycle.selectedMarkets).toBe(1);
    expect(response.body.cycle.submittedCount).toBe(3);
    expect(harness.submitBuyCalls.every((call) => call.marketId === "m2")).toBe(true);

    await appCtx.app.close();
  });

  it("a multi-bot cycle resolves prices once and shares results across all bot actions", async () => {
    const tempRoot = await createTempDir();
    const stateDir = path.join(tempRoot, "state");
    const env = createBaseEnv({
      STATE_DIR: stateDir,
      BOT_COUNTS: "4",
      BUY_CHANCE: "100",
      MAX_AMOUNT: "60"
    });

    const markets: DekantMarket[] = [
      { id: "m1", subject: "BTC", category: "crypto", status: "open", liquidity: 120_000 },
      { id: "m2", subject: "ETH", category: "crypto", status: "open", liquidity: 80_000 },
      { id: "m3", subject: "SOL", category: "crypto", status: "open", liquidity: 60_000 }
    ];

    const harness = createBuyHarness(markets);

    const appCtx = await createInitializedApp(env, {
      timer: {
        setTimeout: () => "handle",
        clearTimeout: () => {}
      },
      marketCache: {
        client: harness.dekantClient
      },
      buy: {
        dekant: harness.dekantClient,
        price: harness.priceClient,
        random: () => 0.8
      }
    });

    await appCtx.app.ready();
    await appCtx.markets!.refresh();

    const response = await request(appCtx.app.server)
      .post("/admin/bots/buy")
      .set("x-security", env.ADMIN_SECRET as string)
      .send({});

    expect(response.status).toBe(200);
    expect(harness.getPriceResolveCalls()).toBe(1);
    expect(harness.getLastResolvedMarkets().map((market) => market.id).sort()).toEqual(["m1", "m2", "m3"]);
    expect(harness.submitBuyCalls).toHaveLength(12);

    await appCtx.app.close();
  });
});
