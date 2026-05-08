import { describe, expect, it } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { SolanaVaultClient } from "../../src/solana/vault.js";

const COLLATERAL_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

describe("SolanaVaultClient", () => {
  const tokenMints = {
    USDT: COLLATERAL_MINT,
    USDC: COLLATERAL_MINT
  };

  function createClient() {
    const vaultKeypair = Keypair.generate();
    const connection = {} as any; // We won't call real RPC in these tests

    return new SolanaVaultClient({
      connection,
      vaultKeypair,
      tokenMints
    });
  }

  it("exposes the vault publicKey", () => {
    const vaultKeypair = Keypair.generate();
    const client = new SolanaVaultClient({
      connection: {} as any,
      vaultKeypair,
      tokenMints
    });

    expect(client.publicKey.toBase58()).toBe(vaultKeypair.publicKey.toBase58());
  });

  it("transferToken throws for unsupported token", async () => {
    const client = createClient();

    await expect(
      client.transferToken({
        token: "DOGE",
        toAddress: Keypair.generate().publicKey.toBase58(),
        amount: 100
      })
    ).rejects.toThrow("unsupported_token: DOGE");
  });

  it("transferToken normalizes token to uppercase", async () => {
    const client = createClient();

    await expect(
      client.transferToken({
        token: "unknown_token",
        toAddress: Keypair.generate().publicKey.toBase58(),
        amount: 100
      })
    ).rejects.toThrow("unsupported_token: UNKNOWN_TOKEN");
  });
});
