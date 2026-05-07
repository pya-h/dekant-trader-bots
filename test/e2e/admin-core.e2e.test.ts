import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createInitializedApp } from "../../src/server.js";
import { DekantClient, DekantMarket } from "../../src/clients/dekant-client.js";
import { createBaseEnv } from "../helpers/config.js";

const tempRoots: string[] = [];
type BalanceSnapshot = { sol: number; tokens: Record<string, number> };

async function createTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dtb-admin-core-e2e-"));
  tempRoots.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempRoots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tempRoots.length = 0;
});

function createDekantClient(markets: DekantMarket[]): DekantClient {
  return {
    fetchMarkets: async () => markets,
    fetchPositions: async () => [],
    submitBuyOrder: async () => ({ txId: "buy-1" }),
    submitSellOrder: async () => ({ txId: "sell-1" }),
    prepareBotUser: async () => ({ userId: "u1", publicKey: "p1" })
  };
}

describe("admin core endpoints", () => {
  it("enforces admin auth on core control endpoints", async () => {
    const tempRoot = await createTempDir();
    const env = createBaseEnv({ STATE_DIR: path.join(tempRoot, "state") });

    const appCtx = await createInitializedApp(env, {
      timer: {
        setTimeout: () => "handle",
        clearTimeout: () => {}
      }
    });
    await appCtx.app.ready();

    const response = await request(appCtx.app.server).post("/admin/markets/ignored/add").send({ market_ids: ["m1"] });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "unauthorized" });

    await appCtx.app.close();
  });

  it("persists ignored markets and applies them to active market filtering", async () => {
    const tempRoot = await createTempDir();
    const stateDir = path.join(tempRoot, "state");
    const env = createBaseEnv({ STATE_DIR: stateDir });

    const markets: DekantMarket[] = [
      { id: "m1", subject: "BTC", category: "crypto", status: "open" },
      { id: "m2", subject: "ETH", category: "crypto", status: "open" }
    ];

    const client = createDekantClient(markets);

    const first = await createInitializedApp(env, {
      timer: {
        setTimeout: () => "handle",
        clearTimeout: () => {}
      },
      marketCache: {
        client
      }
    });
    await first.app.ready();

    await first.markets!.refresh();
    expect(first.markets!.getSnapshot().markets.map((market) => market.id).sort()).toEqual(["m1", "m2"]);

    const addResponse = await request(first.app.server)
      .post("/admin/markets/ignored/add")
      .set("x-security", env.ADMIN_SECRET as string)
      .send({ market_ids: ["m2"] });

    expect(addResponse.status).toBe(200);
    expect(addResponse.body.result.ignoredMarketIds).toContain("m2");

    await first.markets!.refresh();
    expect(first.markets!.getSnapshot().markets.map((market) => market.id)).toEqual(["m1"]);

    await first.app.close();

    const second = await createInitializedApp(env, {
      timer: {
        setTimeout: () => "handle",
        clearTimeout: () => {}
      },
      marketCache: {
        client
      }
    });
    await second.app.ready();

    await second.markets!.refresh();
    expect(second.markets!.getSnapshot().markets.map((market) => market.id)).toEqual(["m1"]);

    await second.app.close();
  });

  it("returns paginated bot balances", async () => {
    const tempRoot = await createTempDir();
    const stateDir = path.join(tempRoot, "state");
    const env = createBaseEnv({ STATE_DIR: stateDir, BOT_COUNTS: "3" });

    const boot = await createInitializedApp(env, {
      timer: {
        setTimeout: () => "handle",
        clearTimeout: () => {}
      }
    });
    const bots = boot.state.botsState.bots;
    await boot.app.close();

    const balancesByAddress = new Map<string, BalanceSnapshot>(
      bots.map((bot, index) => [
        bot.publicKey,
        {
          sol: Number((0.01 + index * 0.001).toFixed(6)),
          tokens: {
            USDT: 100 + index,
            USDC: 50 + index
          }
        }
      ])
    );

    const appCtx = await createInitializedApp(env, {
      timer: {
        setTimeout: () => "handle",
        clearTimeout: () => {}
      },
      funding: {
        vault: {
          transferToken: async () => ({ txId: "token-tx" }),
          transferSol: async () => ({ txId: "sol-tx" })
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
        random: () => 0
      }
    });
    await appCtx.app.ready();

    const response = await request(appCtx.app.server)
      .get("/admin/bots/balances?page=2&page_size=1")
      .set("x-security", env.ADMIN_SECRET as string);

    expect(response.status).toBe(200);
    expect(response.body.page).toBe(2);
    expect(response.body.pageSize).toBe(1);
    expect(response.body.total).toBe(3);
    expect(response.body.totalPages).toBe(3);
    expect(response.body.items).toHaveLength(1);

    await appCtx.app.close();
  });

  it("persists mutable runtime config patches and reloads them on restart", async () => {
    const tempRoot = await createTempDir();
    const stateDir = path.join(tempRoot, "state");
    const env = createBaseEnv({ STATE_DIR: stateDir, BUY_CHANCE: "90" });

    const first = await createInitializedApp(env, {
      timer: {
        setTimeout: () => "handle",
        clearTimeout: () => {}
      }
    });
    await first.app.ready();

    const patchResponse = await request(first.app.server)
      .patch("/admin/config")
      .set("x-security", env.ADMIN_SECRET as string)
      .send({
        trading: {
          buyChance: 44
        },
        funding: {
          minBotSol: 0.02
        }
      });

    expect(patchResponse.status).toBe(200);
    expect(patchResponse.body.config.trading.buyChance).toBe(44);
    expect(patchResponse.body.config.funding.minBotSol).toBe(0.02);

    await first.app.close();

    const second = await createInitializedApp(env, {
      timer: {
        setTimeout: () => "handle",
        clearTimeout: () => {}
      }
    });
    await second.app.ready();

    const statusResponse = await request(second.app.server)
      .get("/admin/status")
      .set("x-security", env.ADMIN_SECRET as string);

    expect(statusResponse.status).toBe(200);
    expect(statusResponse.body.runtime.buyChance).toBe(44);

    await second.app.close();
  });
});
