import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, getAccount, TokenAccountNotFoundError } from "@solana/spl-token";
import { BalanceClient } from "../funding/engine.js";

export type TokenMintMap = Record<string, string>;

export type SolanaBalanceClientOptions = {
  connection: Connection;
  tokenMints: TokenMintMap;
};

export class SolanaBalanceClient implements BalanceClient {
  private readonly connection: Connection;
  private readonly tokenMints: TokenMintMap;

  constructor(options: SolanaBalanceClientOptions) {
    this.connection = options.connection;
    this.tokenMints = options.tokenMints;
  }

  async getBotBalance(
    address: string,
    tokens: string[]
  ): Promise<{ sol: number; tokens: Record<string, number> }> {
    const owner = new PublicKey(address);

    const solLamports = await this.connection.getBalance(owner);
    const sol = solLamports / LAMPORTS_PER_SOL;

    const tokenBalances: Record<string, number> = {};
    for (const token of tokens) {
      const normalized = token.trim().toUpperCase();
      const mintAddress = this.tokenMints[normalized];
      if (!mintAddress) {
        tokenBalances[normalized] = 0;
        continue;
      }

      try {
        const mint = new PublicKey(mintAddress);
        const ata = getAssociatedTokenAddressSync(mint, owner, true);
        const account = await getAccount(this.connection, ata);
        const decimals = await this.getTokenDecimals(mint);
        tokenBalances[normalized] = Number(account.amount) / Math.pow(10, decimals);
      } catch (error) {
        if (error instanceof TokenAccountNotFoundError) {
          tokenBalances[normalized] = 0;
        } else {
          tokenBalances[normalized] = 0;
        }
      }
    }

    return { sol, tokens: tokenBalances };
  }

  private async getTokenDecimals(mint: PublicKey): Promise<number> {
    const info = await this.connection.getParsedAccountInfo(mint);
    if (info.value && "parsed" in (info.value.data as Record<string, unknown>)) {
      const parsed = (info.value.data as { parsed: { info: { decimals: number } } }).parsed;
      return parsed.info.decimals;
    }
    return 6;
  }

  async getWalletBalances(
    address: string,
    tokens: string[]
  ): Promise<{ address: string; sol: number; tokens: Record<string, number> }> {
    const balances = await this.getBotBalance(address, tokens);
    return {
      address,
      ...balances
    };
  }
}
