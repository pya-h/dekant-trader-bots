import { Connection, PublicKey } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";

const NEGATIVE_TTL_MS = 30_000;

/**
 * Per-mint decimals cache. Mint decimals are immutable, so the first successful
 * lookup is the only RPC. Failures are cached for ~30s with a typed error to
 * keep transient `getMint` errors from storming the RPC during a hot trade loop.
 */
export class MintRegistry {
  private readonly connection: Connection;
  private readonly cache = new Map<string, number>();
  private readonly negativeCache = new Map<string, { error: unknown; expiresAt: number }>();
  private readonly now: () => number;

  constructor(options: { connection: Connection; now?: () => number }) {
    this.connection = options.connection;
    this.now = options.now ?? (() => Date.now());
  }

  async getDecimals(mint: string): Promise<number> {
    const cached = this.cache.get(mint);
    if (cached !== undefined) return cached;
    const negative = this.negativeCache.get(mint);
    if (negative && negative.expiresAt > this.now()) {
      throw negative.error;
    }
    try {
      const info = await getMint(this.connection, new PublicKey(mint));
      this.cache.set(mint, info.decimals);
      this.negativeCache.delete(mint);
      return info.decimals;
    } catch (error) {
      this.negativeCache.set(mint, { error, expiresAt: this.now() + NEGATIVE_TTL_MS });
      throw error;
    }
  }
}
