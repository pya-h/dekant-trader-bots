import request from "supertest";
import { describe, expect, it } from "vitest";
import { DekantClient, DekantMarket, DekantPosition, SubmitTradeRequest } from "../../src/clients/dekant-client.js";
import { MarketPriceResolution, PriceQuote } from "../../src/clients/price-client.js";
import { createInitializedApp } from "../../src/server.js";
import { createBaseEnv } from "../helpers/config.js";
import { InMemoryStateStore } from "../helpers/memory-state-store.js";

function createSellHarness(input: {
  markets: DekantMarket[];
  positionsByBotId: Record<string, DekantPosition[]>;
}) {
  const submitSellCalls: SubmitTradeRequest[] = [];
  let priceResolveCalls = 0;
  let lastResolvedMarkets: Array<{ id: string; subject: string }> = [];

  const dekantClient: DekantClient = {
    fetchMarkets: async () => input.markets,
    fetchPositions: async (botId: string) => input.positionsByBotId[botId] ?? [],
    submitBuyOrder: async () => ({ txId: "buy-1" }),
    submitSellOrder: async (payload) => {
      submitSellCalls.push(payload);
      return { txId: `sell-${submitSellCalls.length}` };
    }
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
          price: token === "BTC" ? 100 : token === "ETH" ? 200 : 50,
          emaPrice: token === "BTC" ? 101 : token === "ETH" ? 201 : 51,
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
    submitSellCalls,
    getPriceResolveCalls: () => priceResolveCalls,
    getLastResolvedMarkets: () => lastResolvedMarkets
  };
}

describe("sell engine integration", () => {
  it("forced sell endpoint acts only on bots that actually have positions", async () => {
    const store = new InMemoryStateStore();
    const env = createBaseEnv({
      BOT_COUNTS: "3",
      SELL_CHANCE: "100"
    });

    const markets: DekantMarket[] = [
      { id: "m1", subject: "BTC",
      collateralMint: "Mint11111111111111111111111111111111111111", category: "crypto", state: 0 },
      { id: "m2", subject: "ETH",
      collateralMint: "Mint11111111111111111111111111111111111111", category: "crypto", state: 0 }
    ];

    const appBoot = await createInitializedApp(env, {
      store,
      timer: {
        setTimeout: () => "handle",
        clearTimeout: () => {}
      }
    });

    const bots = appBoot.state.botsState.bots;
    await appBoot.app.close();

    const harness = createSellHarness({
      markets,
      positionsByBotId: {
        [bots[0].id]: [{ id: "p1", marketId: "m1", token: "BTC", amount: 10, center: 130 }],
        [bots[2].id]: [{ id: "p2", marketId: "m2", token: "ETH", amount: 8, center: 140 }]
      }
    });

    const appCtx = await createInitializedApp(env, {
      store,
      timer: {
        setTimeout: () => "handle",
        clearTimeout: () => {}
      },
      marketCache: {
        client: harness.dekantClient
      },
      sell: {
        dekant: harness.dekantClient,
        price: harness.priceClient,
        random: () => 0.99
      }
    });

    await appCtx.app.ready();
    await appCtx.markets!.refresh();

    const response = await request(appCtx.app.server)
      .post("/admin/bots/sell")
      .set("x-security", env.ADMIN_SECRET as string)
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
    expect(response.body.cycle.botsWithPositions).toBe(2);
    expect(response.body.cycle.botsWithoutPositions).toBe(1);
    expect(response.body.cycle.soldFullCount).toBe(2);
    expect(response.body.cycle.soldPartialCount).toBe(0);
    expect(harness.submitSellCalls).toHaveLength(2);
    expect(harness.getPriceResolveCalls()).toBe(1);

    await appCtx.app.close();
  });

  it("forced sell endpoint market_ids filter scopes sells to selected markets", async () => {
    const store = new InMemoryStateStore();
    const env = createBaseEnv({
      BOT_COUNTS: "2",
      SELL_CHANCE: "100"
    });

    const markets: DekantMarket[] = [
      { id: "m1", subject: "BTC",
      collateralMint: "Mint11111111111111111111111111111111111111", category: "crypto", state: 0 },
      { id: "m2", subject: "ETH",
      collateralMint: "Mint11111111111111111111111111111111111111", category: "crypto", state: 0 }
    ];

    const appBoot = await createInitializedApp(env, {
      store,
      timer: {
        setTimeout: () => "handle",
        clearTimeout: () => {}
      }
    });

    const bots = appBoot.state.botsState.bots;
    await appBoot.app.close();

    const harness = createSellHarness({
      markets,
      positionsByBotId: {
        [bots[0].id]: [{ id: "p1", marketId: "m1", token: "BTC", amount: 10, center: 130 }],
        [bots[1].id]: [{ id: "p2", marketId: "m2", token: "ETH", amount: 8, center: 140 }]
      }
    });

    const appCtx = await createInitializedApp(env, {
      store,
      timer: {
        setTimeout: () => "handle",
        clearTimeout: () => {}
      },
      marketCache: {
        client: harness.dekantClient
      },
      sell: {
        dekant: harness.dekantClient,
        price: harness.priceClient,
        random: () => 0.99
      }
    });

    await appCtx.app.ready();
    await appCtx.markets!.refresh();

    const response = await request(appCtx.app.server)
      .post("/admin/bots/sell")
      .set("x-security", env.ADMIN_SECRET as string)
      .send({ market_ids: ["m2"] });

    expect(response.status).toBe(200);
    expect(response.body.cycle.selectedMarkets).toBe(1);
    expect(response.body.cycle.soldFullCount).toBe(1);
    expect(harness.submitSellCalls).toHaveLength(1);
    expect(harness.submitSellCalls[0].marketId).toBe("m2");

    await appCtx.app.close();
  });

  it("non-position bots are skipped cleanly", async () => {
    const store = new InMemoryStateStore();
    const env = createBaseEnv({
      BOT_COUNTS: "4",
      SELL_CHANCE: "100"
    });

    const markets: DekantMarket[] = [{ id: "m1", subject: "BTC",
      collateralMint: "Mint11111111111111111111111111111111111111", category: "crypto", state: 0 }];

    const appBoot = await createInitializedApp(env, {
      store,
      timer: {
        setTimeout: () => "handle",
        clearTimeout: () => {}
      }
    });

    const bots = appBoot.state.botsState.bots;
    await appBoot.app.close();

    const harness = createSellHarness({
      markets,
      positionsByBotId: {
        [bots[0].id]: [{ id: "p1", marketId: "m1", token: "BTC", amount: 9, center: 130 }]
      }
    });

    const appCtx = await createInitializedApp(env, {
      store,
      timer: {
        setTimeout: () => "handle",
        clearTimeout: () => {}
      },
      marketCache: {
        client: harness.dekantClient
      },
      sell: {
        dekant: harness.dekantClient,
        price: harness.priceClient,
        random: () => 0.99
      }
    });

    await appCtx.app.ready();
    await appCtx.markets!.refresh();

    const response = await request(appCtx.app.server)
      .post("/admin/bots/sell")
      .set("x-security", env.ADMIN_SECRET as string)
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.cycle.botsWithPositions).toBe(1);
    expect(response.body.cycle.botsWithoutPositions).toBe(3);
    expect(response.body.cycle.positionsConsidered).toBe(1);
    expect(harness.submitSellCalls).toHaveLength(1);

    await appCtx.app.close();
  });
});
