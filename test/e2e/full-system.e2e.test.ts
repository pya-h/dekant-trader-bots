import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createInitializedApp } from "../../src/server.js";
import { DekantClient, DekantMarket, DekantPosition, SubmitTradeRequest } from "../../src/clients/dekant-client.js";
import { MarketPriceResolution, PriceQuote } from "../../src/clients/price-client.js";
import { BotRecord } from "../../src/state/types.js";
import { createBaseEnv } from "../helpers/config.js";
import { createCapturedLogger } from "../helpers/observability.js";

const tempRoots: string[] = [];

type BalanceSnapshot = {
  sol: number;
  tokens: Record<string, number>;
};

type IntervalHarness = {
  timer: {
    setInterval: (handler: () => void, intervalMs: number) => unknown;
    clearInterval: (handle: unknown) => void;
  };
  tick: () => Promise<void>;
};

async function createTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dtb-full-system-e2e-"));
  tempRoots.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempRoots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tempRoots.length = 0;
});

function createIntervalHarness(): IntervalHarness {
  let intervalHandler: (() => void) | null = null;

  return {
    timer: {
      setInterval: (handler: () => void) => {
        intervalHandler = handler;
        return "interval-handle";
      },
      clearInterval: () => {
        intervalHandler = null;
      }
    },
    tick: async () => {
      if (!intervalHandler) {
        throw new Error("interval_not_started");
      }

      intervalHandler();
      await Promise.resolve();
      await Promise.resolve();
    }
  };
}

async function bootstrapBots(env: NodeJS.ProcessEnv): Promise<BotRecord[]> {
  const appCtx = await createInitializedApp(env, {
    timer: {
      setTimeout: () => "handle",
      clearTimeout: () => {}
    }
  });

  const bots = [...appCtx.state.botsState.bots];
  await appCtx.app.close();
  return bots;
}

function createPositionsByBot(bots: BotRecord[], markets: DekantMarket[]): Record<string, DekantPosition[]> {
  const positions: Record<string, DekantPosition[]> = {};

  for (const bot of bots) {
    positions[bot.id] = markets.map((market, index) => {
      const isBtc = market.subject.toUpperCase() === "BTC";
      const isEth = market.subject.toUpperCase() === "ETH";

      const center = isBtc ? 125_000 : isEth ? 6_000 : 500;
      const amount = 10 + index * 3;

      return {
        id: `${bot.id}-${market.id}-pos`,
        marketId: market.id,
        token: market.subject,
        amount,
        center
      };
    });
  }

  return positions;
}

function createPriceClient(priceByToken: Record<string, number>) {
  return {
    resolveMarketPrices: async (
      requestedMarkets: Array<{ id: string; subject: string }>
    ): Promise<MarketPriceResolution> => {
      const byMarketId: MarketPriceResolution["byMarketId"] = new Map();
      const quotesByToken: MarketPriceResolution["quotesByToken"] = new Map();

      for (const market of requestedMarkets) {
        const token = market.subject.trim().toUpperCase();
        const quote: PriceQuote = {
          tokenId: token,
          price: priceByToken[token] ?? 100,
          emaPrice: (priceByToken[token] ?? 100) * 1.001,
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
}

function createDekantHarness(input: {
  markets: DekantMarket[];
  positionsByBotId: Record<string, DekantPosition[]>;
  failEveryBuy?: number;
  failEverySell?: number;
}) {
  const submitBuyCalls: SubmitTradeRequest[] = [];
  const submitSellCalls: SubmitTradeRequest[] = [];

  const dekantClient: DekantClient = {
    fetchMarkets: async () => input.markets,
    fetchPositions: async (botId: string) => input.positionsByBotId[botId] ?? [],
    submitBuyOrder: async (payload) => {
      submitBuyCalls.push(payload);

      if (input.failEveryBuy && submitBuyCalls.length % input.failEveryBuy === 0) {
        throw new Error("buy_submit_intermittent_failure");
      }

      return { txId: `buy-${submitBuyCalls.length}` };
    },
    submitSellOrder: async (payload) => {
      submitSellCalls.push(payload);

      if (input.failEverySell && submitSellCalls.length % input.failEverySell === 0) {
        throw new Error("sell_submit_intermittent_failure");
      }

      return { txId: `sell-${submitSellCalls.length}` };
    },
    prepareBotUser: async () => ({ userId: "u1", publicKey: "p1" })
  };

  return {
    dekantClient,
    submitBuyCalls,
    submitSellCalls
  };
}

function createFundingHarness(input: {
  balancesByAddress: Map<string, BalanceSnapshot>;
  faucetSupportedTokens?: string[];
}) {
  const transferTokenCalls: Array<{ token: string; toAddress: string; amount: number }> = [];
  const transferSolCalls: Array<{ toAddress: string; amount: number }> = [];

  const faucetTokenSet = new Set((input.faucetSupportedTokens ?? []).map((token) => token.toUpperCase()));

  return {
    funding: {
      vault: {
        transferToken: async (payload: { token: string; toAddress: string; amount: number }) => {
          transferTokenCalls.push(payload);

          const snapshot = input.balancesByAddress.get(payload.toAddress) ?? { sol: 0, tokens: {} };
          snapshot.tokens[payload.token] = (snapshot.tokens[payload.token] ?? 0) + payload.amount;
          input.balancesByAddress.set(payload.toAddress, snapshot);

          return { txId: `vault-token-${transferTokenCalls.length}` };
        },
        transferSol: async (payload: { toAddress: string; amount: number }) => {
          transferSolCalls.push(payload);

          const snapshot = input.balancesByAddress.get(payload.toAddress) ?? { sol: 0, tokens: {} };
          snapshot.sol += payload.amount;
          input.balancesByAddress.set(payload.toAddress, snapshot);

          return { txId: `vault-sol-${transferSolCalls.length}` };
        }
      },
      balances: {
        getBotBalance: async (address: string, tokens: string[]) => {
          const snapshot = input.balancesByAddress.get(address) ?? { sol: 0, tokens: {} };
          const selected: Record<string, number> = {};
          for (const token of tokens) {
            selected[token] = snapshot.tokens[token] ?? 0;
          }

          return {
            sol: snapshot.sol,
            tokens: selected
          };
        }
      },
      faucet: {
        checkAvailability: async (token: string, _walletAddress: string) => ({
          available: faucetTokenSet.has(token.toUpperCase()),
          reason: faucetTokenSet.has(token.toUpperCase()) ? undefined : "unsupported"
        }),
        requestTokens: async (payload: { token: string; walletAddress: string }) => {
          if (!faucetTokenSet.has(payload.token.toUpperCase())) {
            return { success: false };
          }

          return {
            success: true,
            amount: 2,
            txId: `faucet-${payload.token}-${payload.walletAddress}`
          };
        }
      },
      random: () => 0.99
    },
    transferTokenCalls,
    transferSolCalls
  };
}

describe("full system e2e", () => {
  it("golden path: bootstrap + scheduled loops + manual controls + funding fallback", async () => {
    const tempRoot = await createTempDir();
    const stateDir = path.join(tempRoot, "state");
    const env = createBaseEnv({
      STATE_DIR: stateDir,
      BOT_COUNTS: "3",
      BUY_CHANCE: "100",
      SELL_CHANCE: "100",
      MAX_AMOUNT: "40"
    });

    const bots = await bootstrapBots(env);

    const markets: DekantMarket[] = [
      { id: "m1", subject: "BTC", category: "crypto", status: "open", liquidity: 300_000 },
      { id: "m2", subject: "ETH", category: "crypto", status: "open", liquidity: 220_000 }
    ];

    const positionsByBotId = createPositionsByBot(bots, markets);
    const dekant = createDekantHarness({ markets, positionsByBotId });
    const priceClient = createPriceClient({ BTC: 96_000, ETH: 2_900 });

    const balancesByAddress = new Map<string, BalanceSnapshot>(
      bots.map((bot) => [
        bot.publicKey,
        {
          sol: 0,
          tokens: { USDT: 0, USDC: 0 }
        }
      ])
    );

    const fundingHarness = createFundingHarness({
      balancesByAddress,
      faucetSupportedTokens: ["DOGE"]
    });
    const capturedLogger = createCapturedLogger();

    const buyInterval = createIntervalHarness();
    const sellInterval = createIntervalHarness();

    const appCtx = await createInitializedApp(env, {
      timer: {
        setTimeout: () => "handle",
        clearTimeout: () => {}
      },
      marketCache: {
        client: dekant.dekantClient
      },
      buy: {
        dekant: dekant.dekantClient,
        price: priceClient,
        random: () => 0.2,
        timer: buyInterval.timer
      },
      sell: {
        dekant: dekant.dekantClient,
        price: priceClient,
        random: () => 0.95,
        timer: sellInterval.timer
      },
      funding: fundingHarness.funding,
      observability: {
        logger: capturedLogger.logger
      }
    });

    await appCtx.app.ready();
    await appCtx.markets!.refresh();

    await appCtx.buy!.start();
    await appCtx.sell!.start();

    expect(appCtx.buy!.getSnapshot().lastResult?.source).toBe("scheduled");
    expect(appCtx.sell!.getSnapshot().lastResult?.source).toBe("scheduled");

    await buyInterval.tick();
    await sellInterval.tick();

    const manualBuy = await request(appCtx.app.server)
      .post("/admin/bots/buy")
      .set("x-security", env.ADMIN_SECRET as string)
      .send({ market_ids: ["m1"] });

    expect(manualBuy.status).toBe(200);
    expect(manualBuy.body.cycle.submittedCount).toBe(3);

    const manualSell = await request(appCtx.app.server)
      .post("/admin/bots/sell")
      .set("x-security", env.ADMIN_SECRET as string)
      .send({ market_ids: ["m2"] });

    expect(manualSell.status).toBe(200);
    expect(manualSell.body.cycle.soldFullCount + manualSell.body.cycle.soldPartialCount).toBeGreaterThan(0);

    const manualFund = await request(appCtx.app.server)
      .post("/admin/bots/fund")
      .set("x-security", env.ADMIN_SECRET as string)
      .send({ token: "DOGE", amount: 3 });

    expect(manualFund.status).toBe(200);
    expect(manualFund.body.result.targetBotIds).toHaveLength(3);
    expect(
      manualFund.body.result.results.every((item: { tokenActions: Array<{ source: string; status: string }> }) =>
        item.tokenActions.some((action) => action.source === "faucet" && action.status === "funded")
      )
    ).toBe(true);

    const stats = await request(appCtx.app.server)
      .get("/admin/stats")
      .set("x-security", env.ADMIN_SECRET as string);

    expect(stats.status).toBe(200);
    expect(stats.body.global.totalTrades).toBeGreaterThan(0);

    const status = await request(appCtx.app.server)
      .get("/admin/status")
      .set("x-security", env.ADMIN_SECRET as string);

    expect(status.status).toBe(200);
    expect(status.body.status).toBe("ok");
    expect(status.body.runtime.observability.health).toBe("ok");
    expect(status.body.runtime.observability.totals.jobFailures).toBe(0);
    expect(status.body.runtime.observability.totals.actionFailures).toBe(0);

    expect(dekant.submitBuyCalls.length).toBeGreaterThan(0);
    expect(dekant.submitSellCalls.length).toBeGreaterThan(0);
    expect(capturedLogger.entries).toHaveLength(0);

    await appCtx.buy!.stop();
    await appCtx.sell!.stop();
    await appCtx.app.close();
  });

  it("stress path: many bots/markets with intermittent failures stays available", async () => {
    const tempRoot = await createTempDir();
    const stateDir = path.join(tempRoot, "state");
    const env = createBaseEnv({
      STATE_DIR: stateDir,
      BOT_COUNTS: "12",
      BUY_CHANCE: "100",
      SELL_CHANCE: "100",
      MAX_AMOUNT: "35"
    });

    const bots = await bootstrapBots(env);

    const markets: DekantMarket[] = [
      { id: "m1", subject: "BTC", category: "crypto", status: "open", liquidity: 400_000 },
      { id: "m2", subject: "ETH", category: "crypto", status: "open", liquidity: 300_000 },
      { id: "m3", subject: "SOL", category: "crypto", status: "open", liquidity: 260_000 },
      { id: "m4", subject: "AVAX", category: "crypto", status: "open", liquidity: 220_000 },
      { id: "m5", subject: "XRP", category: "crypto", status: "open", liquidity: 210_000 },
      { id: "m6", subject: "DOGE", category: "crypto", status: "open", liquidity: 180_000 }
    ];

    const positionsByBotId = createPositionsByBot(bots, markets.slice(0, 3));
    const dekant = createDekantHarness({
      markets,
      positionsByBotId,
      failEveryBuy: 7,
      failEverySell: 5
    });
    const priceClient = createPriceClient({ BTC: 95_000, ETH: 2_700, SOL: 160, AVAX: 42, XRP: 1.2, DOGE: 0.2 });
    const capturedLogger = createCapturedLogger();

    const appCtx = await createInitializedApp(env, {
      timer: {
        setTimeout: () => "handle",
        clearTimeout: () => {}
      },
      marketCache: {
        client: dekant.dekantClient
      },
      buy: {
        dekant: dekant.dekantClient,
        price: priceClient,
        random: () => 0.45
      },
      sell: {
        dekant: dekant.dekantClient,
        price: priceClient,
        random: () => 0.95
      },
      observability: {
        logger: capturedLogger.logger
      }
    });

    await appCtx.app.ready();
    await appCtx.markets!.refresh();

    const buyAll = await request(appCtx.app.server)
      .post("/admin/bots/buy")
      .set("x-security", env.ADMIN_SECRET as string)
      .send({});

    expect(buyAll.status).toBe(200);
    expect(buyAll.body.cycle.failedSubmitCount).toBeGreaterThan(0);
    expect(buyAll.body.cycle.submittedCount).toBeGreaterThan(0);

    const sellScoped = await request(appCtx.app.server)
      .post("/admin/bots/sell")
      .set("x-security", env.ADMIN_SECRET as string)
      .send({ market_ids: ["m1", "m2", "m3"] });

    expect(sellScoped.status).toBe(200);
    expect(sellScoped.body.cycle.failedSubmitCount).toBeGreaterThan(0);
    expect(sellScoped.body.cycle.soldFullCount + sellScoped.body.cycle.soldPartialCount).toBeGreaterThan(0);

    const status = await request(appCtx.app.server)
      .get("/admin/status")
      .set("x-security", env.ADMIN_SECRET as string);

    expect(status.status).toBe(200);
    expect(status.body.status).toBe("degraded");
    expect(status.body.runtime.observability.totals.jobFailures).toBe(0);
    expect(status.body.runtime.observability.totals.actionFailures).toBe(
      buyAll.body.cycle.failedSubmitCount + sellScoped.body.cycle.failedSubmitCount
    );

    const errorEvents = capturedLogger.getEvents();
    expect(capturedLogger.getByEvent("buy_action_failed")).toHaveLength(buyAll.body.cycle.failedSubmitCount);
    expect(capturedLogger.getByEvent("sell_action_failed")).toHaveLength(sellScoped.body.cycle.failedSubmitCount);
    expect(errorEvents.every((event) => event === "buy_action_failed" || event === "sell_action_failed")).toBe(true);

    const health = await request(appCtx.app.server).get("/health");
    expect(health.status).toBe(200);

    await appCtx.app.close();
  });

  it("restart path: persisted bots/config/ignored-markets reload correctly", async () => {
    const tempRoot = await createTempDir();
    const stateDir = path.join(tempRoot, "state");
    const env = createBaseEnv({
      STATE_DIR: stateDir,
      BOT_COUNTS: "2"
    });

    const markets: DekantMarket[] = [
      { id: "m1", subject: "BTC", category: "crypto", status: "open", liquidity: 100_000 },
      { id: "m2", subject: "ETH", category: "crypto", status: "open", liquidity: 100_000 }
    ];

    const firstDekant: DekantClient = {
      fetchMarkets: async () => markets,
      fetchPositions: async () => [],
      submitBuyOrder: async () => ({ txId: "buy-1" }),
      submitSellOrder: async () => ({ txId: "sell-1" }),
      prepareBotUser: async () => ({ userId: "u1", publicKey: "p1" })
    };

    const first = await createInitializedApp(env, {
      timer: {
        setTimeout: () => "handle",
        clearTimeout: () => {}
      },
      marketCache: {
        client: firstDekant
      }
    });

    await first.app.ready();

    const addBots = await request(first.app.server)
      .post("/admin/bots/add")
      .set("x-security", env.ADMIN_SECRET as string)
      .send({ count: 1 });

    expect(addBots.status).toBe(200);
    expect(addBots.body.result.totalBotCount).toBe(3);

    const patchConfig = await request(first.app.server)
      .patch("/admin/config")
      .set("x-security", env.ADMIN_SECRET as string)
      .send({
        trading: {
          buyChance: 41
        }
      });

    expect(patchConfig.status).toBe(200);

    const ignore = await request(first.app.server)
      .post("/admin/markets/ignored/add")
      .set("x-security", env.ADMIN_SECRET as string)
      .send({ market_ids: ["m2"] });

    expect(ignore.status).toBe(200);

    await first.app.close();

    const bots = await bootstrapBots(env);
    const balancesByAddress = new Map<string, BalanceSnapshot>(
      bots.map((bot) => [
        bot.publicKey,
        {
          sol: 0,
          tokens: { USDT: 0, USDC: 0 }
        }
      ])
    );

    const fundingHarness = createFundingHarness({
      balancesByAddress,
      faucetSupportedTokens: ["DOGE"]
    });

    const secondDekant: DekantClient = {
      fetchMarkets: async () => markets,
      fetchPositions: async () => [],
      submitBuyOrder: async () => ({ txId: "buy-1" }),
      submitSellOrder: async () => ({ txId: "sell-1" }),
      prepareBotUser: async () => ({ userId: "u1", publicKey: "p1" })
    };

    const second = await createInitializedApp(env, {
      timer: {
        setTimeout: () => "handle",
        clearTimeout: () => {}
      },
      marketCache: {
        client: secondDekant
      },
      funding: fundingHarness.funding
    });

    await second.app.ready();

    const status = await request(second.app.server)
      .get("/admin/status")
      .set("x-security", env.ADMIN_SECRET as string);

    expect(status.status).toBe(200);
    expect(status.body.runtime.botCount).toBe(3);
    expect(status.body.runtime.buyChance).toBe(41);

    await second.markets!.refresh();
    expect(second.markets!.getSnapshot().markets.map((market) => market.id)).toEqual(["m1"]);

    const fallbackFund = await request(second.app.server)
      .post("/admin/bots/fund")
      .set("x-security", env.ADMIN_SECRET as string)
      .send({ token: "DOGE", amount: 2 });

    expect(fallbackFund.status).toBe(200);
    expect(fallbackFund.body.result.targetBotIds).toHaveLength(3);
    expect(
      fallbackFund.body.result.results.every((item: { tokenActions: Array<{ source: string; status: string }> }) =>
        item.tokenActions.some((action) => action.source === "faucet" && action.status === "funded")
      )
    ).toBe(true);

    await second.app.close();
  });
});
