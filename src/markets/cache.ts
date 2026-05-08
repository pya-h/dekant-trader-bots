import { DekantClient, DekantMarket } from "../clients/dekant-client.js";
import type { MintRegistry } from "../clients/mint-registry.js";

// Mirror of on-chain MarketState enum from the program IDL.
const MARKET_STATE_ACTIVE = 0;

export type IntervalProvider = {
  setInterval(handler: () => void, intervalMs: number): unknown;
  clearInterval(handle: unknown): void;
};

const defaultIntervalProvider: IntervalProvider = {
  setInterval: (handler, intervalMs) => setInterval(handler, intervalMs),
  clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout)
};

export function filterEligibleMarkets(options: {
  markets: DekantMarket[];
  ignoredMarketIds: Set<string>;
}): DekantMarket[] {
  return options.markets.filter((market) => {
    const category = market.category?.toLowerCase();
    if (category !== "crypto") {
      return false;
    }

    if (options.ignoredMarketIds.has(market.id)) {
      return false;
    }

    if (market.state !== undefined && market.state !== MARKET_STATE_ACTIVE) {
      return false;
    }

    return true;
  });
}

export type MarketCacheSnapshot = {
  markets: DekantMarket[];
  ignoredMarketIds: string[];
  isRunning: boolean;
  lastRefreshAt: string | null;
  lastError: string | null;
};

export class MarketCache {
  private readonly client: DekantClient;
  private readonly refreshIntervalMs: number;
  private readonly timer: IntervalProvider;
  private readonly mintRegistry: MintRegistry | null;
  private ignoredMarketIds: Set<string>;
  private intervalHandle: unknown = null;

  private activeMarkets: DekantMarket[] = [];
  private lastRefreshAt: string | null = null;
  private lastError: string | null = null;

  constructor(options: {
    client: DekantClient;
    refreshIntervalMs: number;
    ignoredMarketIds?: string[];
    timer?: IntervalProvider;
    mintRegistry?: MintRegistry;
  }) {
    this.client = options.client;
    this.refreshIntervalMs = options.refreshIntervalMs;
    this.timer = options.timer ?? defaultIntervalProvider;
    this.mintRegistry = options.mintRegistry ?? null;
    this.ignoredMarketIds = new Set((options.ignoredMarketIds ?? []).map((id) => id.trim()));
  }

  setIgnoredMarketIds(ids: string[]): void {
    this.ignoredMarketIds = new Set(ids.map((id) => id.trim()));
  }

  addIgnoredMarketIds(ids: string[]): void {
    for (const id of ids) {
      this.ignoredMarketIds.add(id.trim());
    }
  }

  removeIgnoredMarketIds(ids: string[]): void {
    for (const id of ids) {
      this.ignoredMarketIds.delete(id.trim());
    }
  }

  getSnapshot(): MarketCacheSnapshot {
    return {
      markets: [...this.activeMarkets],
      ignoredMarketIds: [...this.ignoredMarketIds],
      isRunning: this.intervalHandle !== null,
      lastRefreshAt: this.lastRefreshAt,
      lastError: this.lastError
    };
  }

  async refresh(): Promise<{ updated: boolean; count: number; error?: string }> {
    try {
      const markets = await this.client.fetchMarkets();
      const filtered = filterEligibleMarkets({
        markets,
        ignoredMarketIds: this.ignoredMarketIds
      });
      const enriched = await this.enrichLiquidity(filtered);

      this.activeMarkets = enriched;
      this.lastRefreshAt = new Date().toISOString();
      this.lastError = null;

      return {
        updated: true,
        count: filtered.length
      };
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : "market_refresh_failed";

      return {
        updated: false,
        count: this.activeMarkets.length,
        error: this.lastError
      };
    }
  }

  async start(options: { immediate?: boolean } = {}): Promise<void> {
    if (this.intervalHandle !== null) {
      return;
    }

    if (options.immediate !== false) {
      await this.refresh();
    }

    this.intervalHandle = this.timer.setInterval(() => {
      void this.refresh();
    }, this.refreshIntervalMs);
  }

  stop(): void {
    if (this.intervalHandle === null) {
      return;
    }

    this.timer.clearInterval(this.intervalHandle);
    this.intervalHandle = null;
  }

  /** Derive `liquidity` (human units) from `lpSharesTotal` using the mint's decimals. */
  private async enrichLiquidity(markets: DekantMarket[]): Promise<DekantMarket[]> {
    if (!this.mintRegistry) return markets;

    return Promise.all(
      markets.map(async (market) => {
        if (market.liquidity !== undefined || market.lpSharesTotal === undefined) {
          return market;
        }
        let raw: bigint;
        try {
          raw = BigInt(market.lpSharesTotal);
        } catch {
          return market;
        }
        if (raw < 0n) return market;
        try {
          const decimals = await this.mintRegistry!.getDecimals(market.collateralMint);
          const scale = 10n ** BigInt(decimals);
          // Final number is lossy by design — liquidity is used for sizing
          // heuristics, never as authoritative collateral accounting.
          const whole = Number(raw / scale);
          const frac = Number(raw % scale) / Number(scale);
          return { ...market, liquidity: whole + frac };
        } catch {
          return market;
        }
      })
    );
  }
}
