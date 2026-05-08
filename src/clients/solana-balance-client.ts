import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { BalanceClient } from "../funding/engine.js";

export type SolanaBalanceClientOptions = {
  connection: Connection;
};

export class SolanaBalanceClient implements BalanceClient {
  private readonly connection: Connection;

  constructor(options: SolanaBalanceClientOptions) {
    this.connection = options.connection;
  }

  async getBotBalance(
    address: string,
    tokens: string[]
  ): Promise<{ sol: number; tokens: Record<string, number> }> {
    const owner = new PublicKey(address);
    const requestedMints = new Set(tokens);

    const [lamports, accounts] = await Promise.all([
      this.connection.getBalance(owner, "confirmed"),
      this.connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID })
    ]);

    const balances: Record<string, number> = {};
    for (const mint of requestedMints) {
      balances[mint] = 0;
    }

    for (const { account } of accounts.value) {
      const parsed = account.data.parsed;
      const info = parsed?.info;
      const mint: string | undefined = info?.mint;
      if (!mint || !requestedMints.has(mint)) {
        continue;
      }
      const tokenAmount = info?.tokenAmount;
      const amountStr: string | undefined = tokenAmount?.amount;
      const decimals: number | undefined = tokenAmount?.decimals;
      let uiAmount = 0;
      if (typeof amountStr === "string" && typeof decimals === "number") {
        uiAmount = Number(amountStr) / Math.pow(10, decimals);
      } else if (typeof tokenAmount?.uiAmountString === "string") {
        uiAmount = Number(tokenAmount.uiAmountString);
      } else {
        uiAmount = tokenAmount?.uiAmount ?? 0;
      }
      balances[mint] = (balances[mint] ?? 0) + uiAmount;
    }

    return {
      sol: lamports / 1_000_000_000,
      tokens: balances
    };
  }
}
