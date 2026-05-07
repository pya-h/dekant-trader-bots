import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { BalanceClient } from "../funding/engine.js";

export type SolanaBalanceClientOptions = {
  connection: Connection;
  tokenMints: Record<string, string>;
};

function normalizeToken(token: string): string {
  return token.trim().toUpperCase();
}

export class SolanaBalanceClient implements BalanceClient {
  private readonly connection: Connection;
  private readonly tokenMints: Record<string, PublicKey>;
  private readonly mintToSymbol: Map<string, string>;

  constructor(options: SolanaBalanceClientOptions) {
    this.connection = options.connection;
    this.tokenMints = {};
    this.mintToSymbol = new Map();
    for (const [symbol, mint] of Object.entries(options.tokenMints)) {
      const normalizedSymbol = normalizeToken(symbol);
      const mintKey = new PublicKey(mint);
      this.tokenMints[normalizedSymbol] = mintKey;
      this.mintToSymbol.set(mintKey.toBase58(), normalizedSymbol);
    }
  }

  async getBotBalance(
    address: string,
    tokens: string[]
  ): Promise<{ sol: number; tokens: Record<string, number> }> {
    const owner = new PublicKey(address);
    const requestedSymbols = tokens.map(normalizeToken);

    const [lamports, accounts] = await Promise.all([
      this.connection.getBalance(owner, "confirmed"),
      this.connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID })
    ]);

    const balances: Record<string, number> = {};
    for (const symbol of requestedSymbols) {
      balances[symbol] = 0;
    }

    for (const { account } of accounts.value) {
      const parsed = account.data.parsed;
      const info = parsed?.info;
      const mint: string | undefined = info?.mint;
      const uiAmount: number = info?.tokenAmount?.uiAmount ?? 0;
      if (!mint) {
        continue;
      }
      const symbol = this.mintToSymbol.get(mint);
      if (!symbol || !requestedSymbols.includes(symbol)) {
        continue;
      }
      balances[symbol] = (balances[symbol] ?? 0) + uiAmount;
    }

    return {
      sol: lamports / 1_000_000_000,
      tokens: balances
    };
  }
}
