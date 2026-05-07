import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createInitializedApp } from "../../src/server.js";
import { createBaseEnv } from "../helpers/config.js";
import { DekantClient, DekantMarket, DekantPosition, SubmitTradeRequest } from "../../src/clients/dekant-client.js";
import { MarketPriceResolution, PriceQuote } from "../../src/clients/price-client.js";

const tempRoots: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dtb-admin-ops-e2e-"));
  tempRoots.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempRoots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tempRoots.length = 0;
});

type BalanceSnapshot = {
  sol: number;
  tokens: Record<string, number>;
};

function createOpsHarness(input: {
  markets: DekantMarket[];
  positionsByBotId: Record<string, DekantPosition[]>;
  balancesByAddress?: Map<string, BalanceSnapshot>;
}) {
  const submitBuyCalls: SubmitTradeRequest[] = [];
  const submitSellCalls: SubmitTradeRequest[] = [];
  const transferTokenCalls: Array<{ token: string; toAddress: string; amount: number }> = [];
  const transferSolCalls: Array<{ toAddress: string; amount: number }> = [];

  const balancesByAddress =
    input.balancesByAddress ??
    new Map<string, BalanceSnapshot>(
      Object.values(input.positionsByBotId).flat().map((position) => [position.token, { sol: 0, tokens: {} }])
    );

  const dekantClient: DekantClient = {
    fetchMarkets: async () => input.markets,
    fetchPositions: async (botId: string) => input.positionsByBotId[botId] ?? [],
    submitBuyOrder: async (payload) => {
      submitBuyCalls.push(payload);
      return { txId: `buy-${submitBuyCalls.length}` };
    },
    submitSellOrder: async (payload) => {
      submitSellCalls.push(payload);
      return { txId: `sell-${submitSellCalls.length}` };
    },
    prepareBotUser: async () => ({ userId: "u1", publicKey: "p1" })
  };

  const priceClient = {
    resolveMarketPrices: async (
      requestedMarkets: Array<{ id: string; subject: string }>
    ): Promise<MarketPriceResolution> => {
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

  const funding = {
    vault: {
      transferToken: async (input: { token: string; toAddress: string; amount: number }) => {
        transferTokenCalls.push(input);
        const snapshot = balancesByAddress.get(input.toAddress) ?? { sol: 0, tokens: {} };
        snapshot.tokens[input.token] = (snapshot.tokens[input.token] ?? 0) + input.amount;
        balancesByAddress.set(input.toAddress, snapshot);
        return { txId: `vault-token-${transferTokenCalls.length}` };
      },
      transferSol: async (input: { toAddress: string; amount: number }) => {
        transferSolCalls.push(input);
        const snapshot = balancesByAddress.get(input.toAddress) ?? { sol: 0, tokens: {} };
        snapshot.sol += input.amount;
        balancesByAddress.set(input.toAddress, snapshot);
        return { txId: `vault-sol-${transferSolCalls.length}` };
      }
    },
    balances: {
      getBotBalance: async (address: string, tokens: string[]) => {
        const snapshot = balancesByAddress.get(address) ?? { sol: 0, tokens: {} };
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
      checkAvailability: async () => ({ available: false }),
      requestTokens: async () => ({ success: false })
    },
    random: () => 0.99
  };

  return {
    dekantClient,
    priceClient,
    funding,
    submitBuyCalls,
    submitSellCalls,
    transferTokenCalls,
    transferSolCalls,
    balancesByAddress
  };
}

describe("admin ops endpoints", () => {
  it("force buy/sell/fund endpoints execute with and without selectors", async () => {
    const tempRoot = await createTempDir();
    const stateDir = path.join(tempRoot, "state");
    const env = createBaseEnv({
      STATE_DIR: stateDir,
      BOT_COUNTS: "2",
      BUY_CHANCE: "100",
      SELL_CHANCE: "100"
    });

    const bootstrap = await createInitializedApp(env, {
      timer: {
        setTimeout: () => "handle",
        clearTimeout: () => {}
      }
    });
    const bots = bootstrap.state.botsState.bots;
    await bootstrap.app.close();

    const markets: DekantMarket[] = [
      { id: "m1", subject: "BTC", category: "crypto", status: "open" },
      { id: "m2", subject: "ETH", category: "crypto", status: "open" }
    ];

    const positionsByBotId: Record<string, DekantPosition[]> = {
      [bots[0].id]: [
        { id: "p1", marketId: "m1", token: "BTC", amount: 10, center: 140 },
        { id: "p2", marketId: "m2", token: "ETH", amount: 8, center: 140 }
      ],
      [bots[1].id]: [
        { id: "p3", marketId: "m1", token: "BTC", amount: 7, center: 140 },
        { id: "p4", marketId: "m2", token: "ETH", amount: 6, center: 140 }
      ]
    };

    const balancesByAddress = new Map<string, BalanceSnapshot>(
      bots.map((bot) => [
        bot.publicKey,
        {
          sol: 0,
          tokens: { USDT: 0, USDC: 0 }
        }
      ])
    );

    const harness = createOpsHarness({ markets, positionsByBotId, balancesByAddress });

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
        random: () => 0.3
      },
      sell: {
        dekant: harness.dekantClient,
        price: harness.priceClient,
        random: () => 0.99
      },
      funding: harness.funding
    });

    await appCtx.app.ready();
    await appCtx.markets!.refresh();

    const buyAll = await request(appCtx.app.server)
      .post("/admin/bots/buy")
      .set("x-security", env.ADMIN_SECRET as string)
      .send({});

    expect(buyAll.status).toBe(200);
    expect(buyAll.body.cycle.submittedCount).toBe(4);

    const buyScoped = await request(appCtx.app.server)
      .post("/admin/bots/buy")
      .set("x-security", env.ADMIN_SECRET as string)
      .send({ market_ids: ["m2"] });

    expect(buyScoped.status).toBe(200);
    expect(buyScoped.body.cycle.submittedCount).toBe(2);

    const sellAll = await request(appCtx.app.server)
      .post("/admin/bots/sell")
      .set("x-security", env.ADMIN_SECRET as string)
      .send({});

    expect(sellAll.status).toBe(200);
    expect(sellAll.body.cycle.soldFullCount).toBe(4);

    const sellScoped = await request(appCtx.app.server)
      .post("/admin/bots/sell")
      .set("x-security", env.ADMIN_SECRET as string)
      .send({ market_ids: ["m1"] });

    expect(sellScoped.status).toBe(200);
    expect(sellScoped.body.cycle.soldFullCount).toBe(2);

    const fundAll = await request(appCtx.app.server)
      .post("/admin/bots/fund")
      .set("x-security", env.ADMIN_SECRET as string)
      .send({});

    expect(fundAll.status).toBe(200);
    expect(fundAll.body.result.targetBotIds).toHaveLength(2);

    const fundScoped = await request(appCtx.app.server)
      .post("/admin/bots/fund")
      .set("x-security", env.ADMIN_SECRET as string)
      .send({
        bot_ids: [bots[0].id],
        addresses: [bots[1].publicKey],
        amount: 11
      });

    expect(fundScoped.status).toBe(200);
    expect(fundScoped.body.result.targetBotIds.sort()).toEqual([bots[0].id, bots[1].id].sort());

    expect(harness.submitBuyCalls).toHaveLength(6);
    expect(harness.submitSellCalls).toHaveLength(6);

    await appCtx.app.close();
  });

  it("add bots endpoint creates bots and runs first-time readiness funding", async () => {
    const tempRoot = await createTempDir();
    const stateDir = path.join(tempRoot, "state");
    const env = createBaseEnv({
      STATE_DIR: stateDir,
      BOT_COUNTS: "1"
    });

    const balancesByAddress = new Map<string, BalanceSnapshot>();
    const harness = createOpsHarness({
      markets: [{ id: "m1", subject: "BTC", category: "crypto", status: "open" }],
      positionsByBotId: {},
      balancesByAddress
    });

    const appCtx = await createInitializedApp(env, {
      timer: {
        setTimeout: () => "handle",
        clearTimeout: () => {}
      },
      funding: harness.funding
    });

    await appCtx.app.ready();

    const response = await request(appCtx.app.server)
      .post("/admin/bots/add")
      .set("x-security", env.ADMIN_SECRET as string)
      .send({ count: 2 });

    expect(response.status).toBe(200);
    expect(response.body.result.addedBots).toHaveLength(2);
    expect(response.body.result.totalBotCount).toBe(3);
    expect(response.body.result.funding.targetBotIds).toHaveLength(2);

    await appCtx.app.close();
  });

  it("stats endpoint returns paginated per-bot details and global totals", async () => {
    const tempRoot = await createTempDir();
    const stateDir = path.join(tempRoot, "state");
    const env = createBaseEnv({
      STATE_DIR: stateDir,
      BOT_COUNTS: "2",
      BUY_CHANCE: "100",
      SELL_CHANCE: "100"
    });

    const bootstrap = await createInitializedApp(env, {
      timer: {
        setTimeout: () => "handle",
        clearTimeout: () => {}
      }
    });
    const bots = bootstrap.state.botsState.bots;
    await bootstrap.app.close();

    const markets: DekantMarket[] = [{ id: "m1", subject: "BTC", category: "crypto", status: "open" }];
    const positionsByBotId: Record<string, DekantPosition[]> = {
      [bots[0].id]: [{ id: "p1", marketId: "m1", token: "BTC", amount: 10, center: 130 }],
      [bots[1].id]: [{ id: "p2", marketId: "m1", token: "BTC", amount: 9, center: 130 }]
    };

    const harness = createOpsHarness({
      markets,
      positionsByBotId,
      balancesByAddress: new Map<string, BalanceSnapshot>(
        bots.map((bot) => [
          bot.publicKey,
          {
            sol: 0,
            tokens: { USDT: 0, USDC: 0 }
          }
        ])
      )
    });

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
        random: () => 0.2
      },
      sell: {
        dekant: harness.dekantClient,
        price: harness.priceClient,
        random: () => 0.99
      },
      funding: harness.funding
    });

    await appCtx.app.ready();
    await appCtx.markets!.refresh();

    await request(appCtx.app.server)
      .post("/admin/bots/buy")
      .set("x-security", env.ADMIN_SECRET as string)
      .send({});

    await request(appCtx.app.server)
      .post("/admin/bots/sell")
      .set("x-security", env.ADMIN_SECRET as string)
      .send({});

    const statsResponse = await request(appCtx.app.server)
      .get("/admin/stats?page=1&page_size=1")
      .set("x-security", env.ADMIN_SECRET as string);

    expect(statsResponse.status).toBe(200);
    expect(statsResponse.body.page).toBe(1);
    expect(statsResponse.body.pageSize).toBe(1);
    expect(statsResponse.body.totalBots).toBe(2);
    expect(statsResponse.body.totalPages).toBe(2);
    expect(statsResponse.body.items).toHaveLength(1);
    expect(statsResponse.body.global.totalTrades).toBeGreaterThan(0);
    expect(statsResponse.body.global.totalVolume).toBeGreaterThan(0);

    await appCtx.app.close();
  });
});
