import { Connection, PublicKey } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";

/** Per-mint decimals cache. Mint decimals are immutable, so first lookup is the only RPC. */
export class MintRegistry {
  private readonly connection: Connection;
  private readonly cache = new Map<string, number>();

  constructor(options: { connection: Connection }) {
    this.connection = options.connection;
  }

  async getDecimals(mint: string): Promise<number> {
    const cached = this.cache.get(mint);
    if (cached !== undefined) return cached;
    const info = await getMint(this.connection, new PublicKey(mint));
    this.cache.set(mint, info.decimals);
    return info.decimals;
  }
}
