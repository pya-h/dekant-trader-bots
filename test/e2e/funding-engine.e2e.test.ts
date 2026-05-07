import { describe, expect, it } from "vitest";
import { createInitializedApp, type AppInitializationOptions } from "../../src/server.js";
import { BotRecord } from "../../src/state/types.js";
import { createBaseEnv } from "../helpers/config.js";
import { InMemoryStateStore } from "../helpers/memory-state-store.js";

type BalanceSnapshot = {
  sol: number;
  tokens: Record<string, number>;
};

type FundingHarness = {
  balancesByAddress: Map<string, BalanceSnapshot>;
  transferTokenCalls: Array<{ token: string; toAddress: string; amount: number }>;
  transferSolCalls: Array<{ toAddress: string; amount: number }>;
  setFaucetAvailability: (token: string, values: Array<{ available: boolean; reason?: string }>) => void;
};

function buildFundingHarness(bots: BotRecord[], initialSol = 0, initialTokens: Record<string, number> = {}): {
  harness: FundingHarness;
  deps: NonNullable<AppInitializationOptions["funding"]>;
} {
  const balancesByAddress = new Map<string, BalanceSnapshot>();
  for (const bot of bots) {
    balancesByAddress.set(bot.publicKey, {
      sol: initialSol,
      tokens: { ...initialTokens }
    });
  }

  const transferTokenCalls: Array<{ token: string; toAddress: string; amount: number }> = [];
  const transferSolCalls: Array<{ toAddress: string; amount: number }> = [];
  const faucetAvailability = new Map<string, Array<{ available: boolean; reason?: string }>>();

  const harness: FundingHarness = {
    balancesByAddress,
    transferTokenCalls,
    transferSolCalls,
    setFaucetAvailability: (token, values) => {
      faucetAvailability.set(token, [...values]);
    }
  };

  const deps: NonNullable<AppInitializationOptions["funding"]> = {
    vaultAddress: "Vault11111111111111111111111111111111111111",
    vault: {
      transferToken: async (input: { token: string; toAddress: string; amount: number }) => {
        const { token, toAddress, amount } = input;
        transferTokenCalls.push({ token, toAddress, amount });
        const snapshot = balancesByAddress.get(toAddress);
        if (snapshot) {
          snapshot.tokens[token] = (snapshot.tokens[token] ?? 0) + amount;
        }
        return { txId: `vault-token-${transferTokenCalls.length}` };
      },
      transferSol: async (input: { toAddress: string; amount: number }) => {
        const { toAddress, amount } = input;
        transferSolCalls.push({ toAddress, amount });
        const snapshot = balancesByAddress.get(toAddress);
        if (snapshot) {
          snapshot.sol += amount;
        }
        return { txId: `vault-sol-${transferSolCalls.length}` };
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
      checkAvailability: async (token: string, _walletAddress: string) => {
        const queue = faucetAvailability.get(token) ?? [];
        if (queue.length === 0) {
          return { available: false, reason: "not-configured" };
        }

        return queue[0];
      },
      requestTokens: async (input: { token: string; walletAddress: string }) => {
        const { token, walletAddress } = input;
        const queue = faucetAvailability.get(token) ?? [];
        if (queue.length === 0) {
          return { success: false };
        }

        queue.shift();
        faucetAvailability.set(token, queue);

        const snapshot = balancesByAddress.get(walletAddress);
        if (snapshot) {
          snapshot.tokens[token] = (snapshot.tokens[token] ?? 0) + 5;
        }

        return {
          success: true,
          amount: 5,
          txId: `faucet-${token}`
        };
      }
    },
    random: () => 0
  };

  return {
    harness,
    deps
  };
}

describe("funding engine integration", () => {
  it("out-of-interval manual fund targets all bots when no selector provided", async () => {
    const store = new InMemoryStateStore();
    const env = createBaseEnv({
      BOT_COUNTS: "3"
    });

    const appCtx = await createInitializedApp(env, {
      store,
      timer: {
        setTimeout: () => "handle",
        clearTimeout: () => {}
      }
    });

    const { harness, deps } = buildFundingHarness(appCtx.state.botsState.bots, 0, { USDT: 0, USDC: 0 });

    const withFunding = await createInitializedApp(env, {
      store,
      timer: {
        setTimeout: () => "handle",
        clearTimeout: () => {}
      },
      funding: deps
    });

    expect(withFunding.funding).not.toBeNull();
    const result = await withFunding.funding!.manualFund({});

    expect(result.targetBotIds).toHaveLength(3);
    expect(harness.transferTokenCalls).toHaveLength(6);
    expect(harness.transferSolCalls).toHaveLength(3);
    expect(result.results.every((entry) => entry.tokenActions.every((action) => action.status === "funded"))).toBe(
      true
    );
  });

  it("manual fund selector uses union of bot IDs and addresses", async () => {
    const store = new InMemoryStateStore();
    const env = createBaseEnv({
      BOT_COUNTS: "3"
    });

    const initialized = await createInitializedApp(env, {
      store,
      timer: {
        setTimeout: () => "handle",
        clearTimeout: () => {}
      }
    });

    const { harness, deps } = buildFundingHarness(initialized.state.botsState.bots, 0, { USDT: 0, USDC: 0 });

    const withFunding = await createInitializedApp(env, {
      store,
      timer: {
        setTimeout: () => "handle",
        clearTimeout: () => {}
      },
      funding: deps
    });

    const bots = withFunding.state.botsState.bots;
    const selected = await withFunding.funding!.manualFund({
      botIds: [bots[0].id],
      addresses: [bots[2].publicKey],
      amount: 10
    });

    expect(selected.targetBotIds.sort()).toEqual([bots[0].id, bots[2].id].sort());
    expect(harness.transferTokenCalls).toHaveLength(4);
    expect(harness.transferSolCalls).toHaveLength(2);
  });

  it("unsupported token uses faucet fallback then skips when unavailable", async () => {
    const store = new InMemoryStateStore();
    const env = createBaseEnv({
      BOT_COUNTS: "1"
    });

    const initialized = await createInitializedApp(env, {
      store,
      timer: {
        setTimeout: () => "handle",
        clearTimeout: () => {}
      }
    });

    const { harness, deps } = buildFundingHarness(initialized.state.botsState.bots, 1, { BTC: 0 });
    harness.setFaucetAvailability("BTC", [
      { available: true },
      { available: false, reason: "exhausted" }
    ]);

    const withFunding = await createInitializedApp(env, {
      store,
      timer: {
        setTimeout: () => "handle",
        clearTimeout: () => {}
      },
      funding: deps
    });

    const first = await withFunding.funding!.manualFund({
      token: "BTC",
      amount: 5
    });

    expect(first.results[0].tokenActions[0].source).toBe("faucet");
    expect(first.results[0].tokenActions[0].status).toBe("funded");

    const second = await withFunding.funding!.manualFund({
      token: "BTC",
      amount: 8
    });

    expect(second.results[0].tokenActions[0].status).toBe("skipped_unavailable");
    expect(harness.transferTokenCalls).toHaveLength(0);
  });
});
