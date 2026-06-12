import request from "supertest";
import { describe, expect, it } from "vitest";
import { createInitializedApp } from "../../src/server.js";
import { createBaseEnv } from "../helpers/config.js";
import { DekantClient, DekantMarket } from "../../src/clients/dekant-client.js";
import { MarketPriceResolution, PriceQuote } from "../../src/clients/price-client.js";
import { InMemoryStateStore } from "../helpers/memory-state-store.js";
import { bootstrapState } from "../../src/bootstrap.js";

async function primeStoreWithMints(
  env: NodeJS.ProcessEnv,
  store: InMemoryStateStore,
  mints: string[]
): Promise<void> {
  // Run bootstrap once so the store has a runtime_config we can patch in-place.
  // Then seed vaultSupportedMints (formerly env-driven, now market-discovered).
  await bootstrapState(env, store);
  const existing = await store.loadRuntimeConfig();
  if (!existing) return;
  await store.saveRuntimeConfig({
    ...existing,
    config: {
      ...existing.config,
      funding: { ...existing.config.funding, vaultSupportedMints: mints }
    }
  });
}

type BalanceSnapshot = {
  sol: number;
  tokens: Record<string, number>;
};

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
        vaultAddress: "Vault11111111111111111111111111111111111111",
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
          if (address === "Vault11111111111111111111111111111111111111") {
            const tokensMap: Record<string, number> = {};
            for (const token of tokens) {
              tokensMap[token] = 1_000_000;
            }
            return { sol: 1, tokens: tokensMap };
          }
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
    const env = createBaseEnv({
      BOT_COUNTS: "2"
    });

    let scheduledTimeout: (() => void) | null = null;

    const balancesByAddress = new Map<string, BalanceSnapshot>();
    const harness = makeFundingHarness(balancesByAddress);

    const store = new InMemoryStateStore();
    await primeStoreWithMints(env, store, ["USDT", "USDC"]);
    const appCtx = await createInitializedApp(env, {
      store,
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

  it("trade scheduler fires due markets and contributes to stats without manual trigger", async () => {
    const env = createBaseEnv({
      BOT_COUNTS: "2",
      BUY_CHANCE: "100",
      TRADE_INTERVAL_MS: "1000"
    });

    const markets: DekantMarket[] = [{ id: "m1", subject: "BTC",
      collateralMint: "Mint11111111111111111111111111111111111111", marketType: 2, category: "crypto", state: 0 }];

    const dekantClient: DekantClient = {
      fetchMarkets: async () => markets,
      fetchPositions: async () => [],
      submitBuyOrder: async () => ({ txId: "buy-ok" }),
      submitSellOrder: async () => ({ txId: "sell-ok" })
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

    // Controllable clock so we can advance past a market's interval and assert
    // the scheduler fires it (without waiting real wall-clock time).
    let nowMs = Date.parse("2026-01-01T00:00:00.000Z");
    const now = () => new Date(nowMs);

    const appCtx = await createInitializedApp(env, {
      store: new InMemoryStateStore(),
      timer: {
        setTimeout: () => "timeout",
        clearTimeout: () => {}
      },
      observability: { now },
      marketCache: {
        client: dekantClient
      },
      buy: {
        dekant: dekantClient,
        price: priceClient,
        random: () => 0.5
      }
    });

    await appCtx.app.ready();
    await appCtx.markets!.refresh();

    // First scheduler tick stamps the freshly-seen market "now" — no trade yet.
    await appCtx.trading!.tick();
    expect(appCtx.buy!.getSnapshot().lastResult).toBeNull();

    // Advance past the trade interval; the next tick makes m1 due and trades.
    nowMs += 2_000;
    await appCtx.trading!.tick();
    await waitFor(() => appCtx.buy!.getSnapshot().lastResult !== null);

    const stats = await request(appCtx.app.server)
      .get("/admin/stats")
      .set("x-security", env.ADMIN_SECRET as string);

    expect(stats.status).toBe(200);
    expect(stats.body.global.buyTrades).toBeGreaterThan(0);

    await appCtx.trading!.stop();
    await appCtx.app.close();
  });

  it("funding loop executes periodic prefunding", async () => {
    const env = createBaseEnv({
      BOT_COUNTS: "2"
    });

    let fundingTick: (() => void) | null = null;

    const balancesByAddress = new Map<string, BalanceSnapshot>();
    const harness = makeFundingHarness(balancesByAddress);

    const store = new InMemoryStateStore();
    await primeStoreWithMints(env, store, ["USDT", "USDC"]);
    const appCtx = await createInitializedApp(env, {
      store,
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
