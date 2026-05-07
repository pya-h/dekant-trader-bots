import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createInitializedApp } from "../../src/server.js";
import { createBaseEnv } from "../helpers/config.js";
import { DekantClient, DekantMarket } from "../../src/clients/dekant-client.js";
import { MarketPriceResolution, PriceQuote } from "../../src/clients/price-client.js";

const tempRoots: string[] = [];

type BalanceSnapshot = {
  sol: number;
  tokens: Record<string, number>;
};

async function createTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dtb-runtime-loops-e2e-"));
  tempRoots.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempRoots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tempRoots.length = 0;
});

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
  const timeoutMs = options.timeoutMs ?? 500;
  const stepMs = options.stepMs ?? 10;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }
    await sleep(stepMs);
  }

  throw new Error("wait_timeout");
}

function makeFundingHarness(balancesByAddress: Map<string, BalanceSnapshot>) {
  const transferTokenCalls: Array<{ token: string; toAddress: string; amount: number }> = [];
  const transferSolCalls: Array<{ toAddress: string; amount: number }> = [];

  return {
    funding: {
      vault: {
        transferToken: async (payload: { token: string; toAddress: string; amount: number }) => {
          transferTokenCalls.push(payload);
          const snapshot = balancesByAddress.get(payload.toAddress) ?? { sol: 0, tokens: {} };
          snapshot.tokens[payload.token] = (snapshot.tokens[payload.token] ?? 0) + payload.amount;
          balancesByAddress.set(payload.toAddress, snapshot);
          return { txId: `token-${transferTokenCalls.length}` };
        },
        transferSol: async (payload: { toAddress: string; amount: number }) => {
          transferSolCalls.push(payload);
          const snapshot = balancesByAddress.get(payload.toAddress) ?? { sol: 0, tokens: {} };
          snapshot.sol += payload.amount;
          balancesByAddress.set(payload.toAddress, snapshot);
          return { txId: `sol-${transferSolCalls.length}` };
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
        checkAvailability: async (_token: string, _address: string) => ({ available: false }),
        requestTokens: async () => ({ success: false })
      },
      random: () => 0.99
    },
    transferTokenCalls,
    transferSolCalls
  };
}

describe("runtime loops", () => {
  it("runs default initial funding after delay when callback is not provided", async () => {
    const tempRoot = await createTempDir();
    const stateDir = path.join(tempRoot, "state");
    const env = createBaseEnv({
      STATE_DIR: stateDir,
      BOT_COUNTS: "2"
    });

    let scheduledTimeout: (() => void) | null = null;

    const balancesByAddress = new Map<string, BalanceSnapshot>();
    const harness = makeFundingHarness(balancesByAddress);

    const appCtx = await createInitializedApp(env, {
      timer: {
        setTimeout: (handler: () => void) => {
          scheduledTimeout = handler;
          return "timeout";
        },
        clearTimeout: () => {}
      },
      funding: harness.funding
    });

    await appCtx.app.ready();

    expect(scheduledTimeout).not.toBeNull();

    const timeoutHandler = scheduledTimeout as unknown as () => void;
    timeoutHandler();
    await waitFor(() => harness.transferTokenCalls.length > 0, { timeoutMs: 1000 });

    expect(harness.transferSolCalls.length).toBeGreaterThan(0);
    expect(harness.transferTokenCalls.length).toBeGreaterThan(0);

    await appCtx.app.close();
  });

  it("scheduled buy loop contributes to stats without manual trigger", async () => {
    const tempRoot = await createTempDir();
    const stateDir = path.join(tempRoot, "state");
    const env = createBaseEnv({
      STATE_DIR: stateDir,
      BOT_COUNTS: "2",
      BUY_CHANCE: "100"
    });

    const markets: DekantMarket[] = [{ id: "m1", subject: "BTC", category: "crypto", status: "open" }];

    const dekantClient: DekantClient = {
      fetchMarkets: async () => markets,
      fetchPositions: async () => [],
      submitBuyOrder: async () => ({ txId: "buy-ok" }),
      submitSellOrder: async () => ({ txId: "sell-ok" }),
      prepareBotUser: async () => ({ userId: "u1", publicKey: "p1" })
    };

    const priceClient = {
      resolveMarketPrices: async (): Promise<MarketPriceResolution> => {
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

    let buyTick: (() => void) | null = null;

    const appCtx = await createInitializedApp(env, {
      timer: {
        setTimeout: () => "timeout",
        clearTimeout: () => {}
      },
      marketCache: {
        client: dekantClient
      },
      buy: {
        dekant: dekantClient,
        price: priceClient,
        random: () => 0.5,
        timer: {
          setInterval: (handler: () => void) => {
            buyTick = handler;
            return "buy-interval";
          },
          clearInterval: () => {
            buyTick = null;
          }
        }
      }
    });

    await appCtx.app.ready();
    await appCtx.markets!.refresh();

    await appCtx.buy!.start({ immediate: false });
    expect(buyTick).not.toBeNull();

    const buyTickHandler = buyTick as unknown as () => void;
    buyTickHandler();
    await waitFor(() => appCtx.buy!.getSnapshot().lastResult !== null);

    const stats = await request(appCtx.app.server)
      .get("/admin/stats")
      .set("x-security", env.ADMIN_SECRET as string);

    expect(stats.status).toBe(200);
    expect(stats.body.global.buyTrades).toBeGreaterThan(0);

    await appCtx.buy!.stop();
    await appCtx.app.close();
  });

  it("funding loop executes periodic prefunding", async () => {
    const tempRoot = await createTempDir();
    const stateDir = path.join(tempRoot, "state");
    const env = createBaseEnv({
      STATE_DIR: stateDir,
      BOT_COUNTS: "2"
    });

    let fundingTick: (() => void) | null = null;

    const balancesByAddress = new Map<string, BalanceSnapshot>();
    const harness = makeFundingHarness(balancesByAddress);

    const appCtx = await createInitializedApp(env, {
      timer: {
        setTimeout: () => "timeout",
        clearTimeout: () => {}
      },
      funding: {
        ...harness.funding,
        timer: {
          setInterval: (handler: () => void) => {
            fundingTick = handler;
            return "funding-interval";
          },
          clearInterval: () => {
            fundingTick = null;
          }
        }
      }
    });

    await appCtx.app.ready();

    await appCtx.funding!.start({ immediate: false });
    expect(fundingTick).not.toBeNull();

    const fundingTickHandler = fundingTick as unknown as () => void;
    fundingTickHandler();
    await waitFor(() => harness.transferTokenCalls.length > 0, { timeoutMs: 1000 });

    expect(harness.transferTokenCalls.length).toBeGreaterThan(0);

    await appCtx.funding!.stop();
    await appCtx.app.close();
  });
});
