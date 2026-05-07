import { describe, expect, it, vi } from "vitest";
import { FundingEngine, selectFundingAmount, selectTargetBots } from "../../src/funding/engine.js";
import { BotRecord } from "../../src/state/types.js";

function makeBot(id: string): BotRecord {
  return {
    id,
    publicKey: `wallet-${id}`,
    secretKey: `secret-${id}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    lastActiveAt: null
  };
}

describe("selectFundingAmount", () => {
  it("uses manual amount override when provided", () => {
    const amount = selectFundingAmount({
      maxAmount: 100,
      prefundMultiplier: 10,
      manualAmount: 42,
      random: () => 0.9
    });

    expect(amount).toBe(42);
  });

  it("samples amount from configured prefund range when manual amount is absent", () => {
    const amount = selectFundingAmount({
      maxAmount: 100,
      prefundMultiplier: 10,
      random: () => 0.5
    });

    expect(amount).toBe(550);
  });
});

describe("FundingEngine", () => {
  it("enforces emergency top-up cooldown per bot", async () => {
    const bot = makeBot("b1");
    const vaultTokenTransfer = vi.fn(async () => ({ txId: "vault-token-tx" }));

    let nowMs = 1_000;
    const engine = new FundingEngine({
      runtime: {
        maxAmount: 100,
        prefundMultiplier: 10,
        minBotSol: 0.01,
        emergencyTopupCooldownMs: 5_000,
        vaultSupportedTokens: ["USDT"]
      },
      clients: {
        vault: {
          transferToken: vaultTokenTransfer,
          transferSol: vi.fn(async () => ({ txId: "sol-tx" }))
        },
        balances: {
          getBotBalance: vi.fn(async () => ({
            sol: 0.1,
            tokens: { USDT: 0 }
          }))
        },
        faucet: {
          checkAvailability: vi.fn(async () => ({ available: false })),
          requestTokens: vi.fn(async () => ({ success: false }))
        }
      },
      now: () => new Date(nowMs),
      random: () => 0
    });

    const first = await engine.requestEmergencyTopup({
      bot,
      token: "USDT"
    });
    expect(first.status).toBe("funded");

    const second = await engine.requestEmergencyTopup({
      bot,
      token: "USDT"
    });
    expect(second.status).toBe("skipped_cooldown");

    nowMs += 5_100;
    const third = await engine.requestEmergencyTopup({
      bot,
      token: "USDT"
    });
    expect(third.status).toBe("funded");

    expect(vaultTokenTransfer).toHaveBeenCalledTimes(2);
  });

  it("uses faucet fallback and skips vault token transfer for unsupported token", async () => {
    const bot = makeBot("b1");
    const vaultTokenTransfer = vi.fn(async () => ({ txId: "vault-token-tx" }));
    const faucetCheck = vi
      .fn()
      .mockResolvedValueOnce({ available: true })
      .mockResolvedValueOnce({ available: false, reason: "exhausted" });

    const faucetRequest = vi.fn(async () => ({ success: true, amount: 12, txId: "faucet-tx" }));

    const engine = new FundingEngine({
      runtime: {
        maxAmount: 100,
        prefundMultiplier: 10,
        minBotSol: 0.01,
        emergencyTopupCooldownMs: 5_000,
        vaultSupportedTokens: ["USDT"]
      },
      clients: {
        vault: {
          transferToken: vaultTokenTransfer,
          transferSol: vi.fn(async () => ({ txId: "sol-tx" }))
        },
        balances: {
          getBotBalance: vi.fn(async () => ({
            sol: 0.1,
            tokens: { BTC: 0 }
          }))
        },
        faucet: {
          checkAvailability: faucetCheck,
          requestTokens: faucetRequest
        }
      },
      random: () => 0
    });

    const first = await engine.manualFund({
      bots: [bot],
      token: "BTC"
    });

    const firstAction = first.results[0]?.tokenActions[0];
    expect(firstAction?.source).toBe("faucet");
    expect(firstAction?.status).toBe("funded");

    const second = await engine.manualFund({
      bots: [bot],
      token: "BTC"
    });

    const secondAction = second.results[0]?.tokenActions[0];
    expect(secondAction?.status).toBe("skipped_unavailable");

    expect(vaultTokenTransfer).not.toHaveBeenCalled();
    expect(faucetRequest).toHaveBeenCalledTimes(1);
  });

  it("selects target bots by union of bot IDs and addresses", () => {
    const bots = [makeBot("a"), makeBot("b"), makeBot("c")];
    const selected = selectTargetBots(bots, {
      botIds: ["a"],
      addresses: [bots[2].publicKey]
    });

    expect(selected.map((bot) => bot.id).sort()).toEqual(["a", "c"]);
  });
});
