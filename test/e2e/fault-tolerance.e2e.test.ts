import request from "supertest";
import { describe, expect, it } from "vitest";
import { createInitializedApp } from "../../src/server.js";
import { DekantClient, DekantMarket } from "../../src/clients/dekant-client.js";
import { MarketPriceResolution, PriceQuote } from "../../src/clients/price-client.js";
import { createBaseEnv } from "../helpers/config.js";
import { createCapturedLogger } from "../helpers/observability.js";
import { InMemoryStateStore } from "../helpers/memory-state-store.js";

describe("fault tolerance", () => {
  it("keeps running and reports degraded health when upstream dependencies fail", async () => {
    const env = createBaseEnv({
      BOT_COUNTS: "2",
      BUY_CHANCE: "100",
      MAX_AMOUNT: "30"
    });

    const markets: DekantMarket[] = [{ id: "m1", subject: "BTC",
      collateralMint: "Mint11111111111111111111111111111111111111", category: "crypto", state: 0 }];

    const dekantClient: DekantClient = {
      fetchMarkets: async () => markets,
      fetchPositions: async () => [],
      submitBuyOrder: async () => ({ txId: "buy-ok" }),
      submitSellOrder: async () => ({ txId: "sell-ok" })
    };

    let priceCalls = 0;
    const capturedLogger = createCapturedLogger();
    const priceClient = {
      resolveMarketPrices: async (): Promise<MarketPriceResolution> => {
        priceCalls += 1;

        if (priceCalls === 1) {
          throw new TypeError("price_service_down");
        }

        const quote: PriceQuote = {
          tokenId: "BTC",
          price: 95_000,
          emaPrice: 95_100,
          confidence: 0.001,
          timestamp: "2026-01-01T00:00:00.000Z",
          stale: false
        };

        return {
          byMarketId: new Map([
            [
              "m1",
              {
                marketId: "m1",
                token: "BTC",
                status: "ok",
                quote
              }
            ]
          ]),
          quotesByToken: new Map([["BTC", quote]]),
          missingTokens: [],
          staleTokens: []
        };
      }
    };

    const appCtx = await createInitializedApp(env, {
      store: new InMemoryStateStore(),
      timer: {
        setTimeout: () => "handle",
        clearTimeout: () => {}
      },
      marketCache: {
        client: dekantClient
      },
      buy: {
        dekant: dekantClient,
        price: priceClient,
        random: () => 0.5
      },
      observability: {
        logger: capturedLogger.logger
      }
    });

    await appCtx.app.ready();
    await appCtx.markets!.refresh();

    const failedBuy = await request(appCtx.app.server)
      .post("/admin/bots/buy")
      .set("x-security", env.ADMIN_SECRET as string)
      .send({});

    expect(failedBuy.status).toBe(500);

    const degradedStatus = await request(appCtx.app.server)
      .get("/admin/status")
      .set("x-security", env.ADMIN_SECRET as string);

    expect(degradedStatus.status).toBe(200);
    expect(degradedStatus.body.status).toBe("degraded");
    expect(degradedStatus.body.runtime.observability.health).toBe("degraded");
    expect(degradedStatus.body.runtime.observability.totals.jobFailures).toBeGreaterThanOrEqual(1);
    expect(capturedLogger.getByEvent("buy_cycle_failed")).toHaveLength(1);
    expect(capturedLogger.getByEvent("buy_cycle_failed")[0].fields).toMatchObject({
      errorType: "network",
      known: true,
      retryable: true,
      message: "price_service_down",
      source: "manual",
      cycleType: "buy"
    });

    const recoveredBuy = await request(appCtx.app.server)
      .post("/admin/bots/buy")
      .set("x-security", env.ADMIN_SECRET as string)
      .send({});

    expect(recoveredBuy.status).toBe(200);
    expect(recoveredBuy.body.cycle.submittedCount).toBe(2);
    expect(capturedLogger.getByEvent("buy_cycle_failed")).toHaveLength(1);

    await appCtx.app.close();
  });
});
