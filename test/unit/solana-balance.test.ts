import { describe, expect, it, vi } from "vitest";
import { SolanaBalanceClient } from "../../src/solana/balance.js";

function createMockConnection(overrides: {
  solBalance?: number;
  tokenAmount?: bigint;
  tokenDecimals?: number;
  tokenNotFound?: boolean;
} = {}) {
  return {
    getBalance: vi.fn().mockResolvedValue(overrides.solBalance ?? 1_000_000_000),
    getParsedAccountInfo: vi.fn().mockResolvedValue({
      value: {
        data: {
          parsed: {
            info: {
              decimals: overrides.tokenDecimals ?? 6
            }
          }
        }
      }
    })
  } as any;
}

function createMockConnectionWithTokenAccount(amount: bigint) {
  const conn = createMockConnection();
  // The getAccount function from @solana/spl-token makes direct RPC calls,
  // so we test the SolanaBalanceClient indirectly through its public API
  return conn;
}

describe("SolanaBalanceClient", () => {
  const tokenMints = {
    USDT: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    USDC: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
  };

  it("constructs without errors", () => {
    const conn = createMockConnection();
    const client = new SolanaBalanceClient({ connection: conn, tokenMints });

    expect(client).toBeDefined();
  });

  it("returns 0 balance for tokens not in tokenMints map", async () => {
    const conn = createMockConnection();
    const client = new SolanaBalanceClient({ connection: conn, tokenMints: {} });

    // getBotBalance will query SOL and find no mint for UNKNOWN
    const result = await client.getBotBalance(
      "11111111111111111111111111111111",
      ["UNKNOWN"]
    );

    expect(result.tokens.UNKNOWN).toBe(0);
    expect(typeof result.sol).toBe("number");
  });

  it("getWalletBalances includes address in result", async () => {
    const conn = createMockConnection();
    const client = new SolanaBalanceClient({ connection: conn, tokenMints: {} });

    const result = await client.getWalletBalances(
      "11111111111111111111111111111111",
      []
    );

    expect(result.address).toBe("11111111111111111111111111111111");
    expect(typeof result.sol).toBe("number");
  });
});
