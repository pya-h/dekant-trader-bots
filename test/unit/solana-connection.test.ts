import { describe, expect, it } from "vitest";
import { Connection } from "@solana/web3.js";
import { createSolanaConnection } from "../../src/solana/connection.js";

describe("createSolanaConnection", () => {
  it("creates a Connection with the given rpcUrl", () => {
    const conn = createSolanaConnection({ rpcUrl: "https://api.devnet.solana.com" });

    expect(conn).toBeInstanceOf(Connection);
    expect(conn.rpcEndpoint).toBe("https://api.devnet.solana.com");
  });

  it("uses 'confirmed' commitment by default", () => {
    const conn = createSolanaConnection({ rpcUrl: "https://api.devnet.solana.com" });

    expect(conn.commitment).toBe("confirmed");
  });

  it("uses the provided commitment", () => {
    const conn = createSolanaConnection({
      rpcUrl: "https://api.devnet.solana.com",
      commitment: "finalized"
    });

    expect(conn.commitment).toBe("finalized");
  });
});
