import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { requestJsonWithRetry } from "./http-client.js";

const marketSchema = z
  .object({
    id: z.string().regex(/^\d+$/, "id_must_be_numeric_string"),
    subject: z.string(),
    collateralMint: z.string().min(1).refine((value) => {
      try {
        new PublicKey(value);
        return true;
      } catch {
        return false;
      }
    }, "collateralMint_not_valid_pubkey"),
    category: z.string().optional(),
    marketType: z.number().int(),
    state: z.number().int().optional(),
    // Stringified u64 from the backend (collateral mint base units).
    lpSharesTotal: z.string().optional(),
    liquidity: z.number().optional(),
    deadline: z.string().optional()
  });

// Loose response shape; invalid market entries are dropped (with a warn log)
// instead of failing the entire response, since one bad row shouldn't kill
// market discovery.
const marketsResponseSchema = z.union([
  z.array(z.unknown()),
  z.object({ data: z.array(z.unknown()) }).passthrough()
]);

const positionSchema = z.object({
  id: z.string(),
  marketId: z.string(),
  token: z.string(),
  amount: z.number(),
  center: z.number().optional()
});

export type DekantMarket = z.infer<typeof marketSchema>;
export type DekantPosition = z.infer<typeof positionSchema>;

export type SubmitTradeRequest = {
  botId: string;
  marketId: string;
  collateralAmount: number;
  center: number;
  spread: number;
};

export type TradeImpactSummary = {
  tokensTransacted: number;
  effectivePrice: number | null;
  kSquaredRatio: number | null;
  delta: { totalMinted: string; kSquared: string; lpSharesTotal: string };
  before: { totalMinted: string; kSquared: string; lpSharesTotal: string };
  after: { totalMinted: string; kSquared: string; lpSharesTotal: string };
  /** mu actually submitted (scaled i64) after clamping into the market range. */
  muApplied: string;
  /** Spot-derived mu (scaled i64) before clamping. */
  muRequested: string;
  /** True when the requested mu was outside [rangeMin, rangeMax] and clamped. */
  muClamped: boolean;
};

export type SubmitTradeResult = {
  txId: string;
  impact?: TradeImpactSummary;
};

export interface DekantClient {
  fetchMarkets(): Promise<DekantMarket[]>;
  fetchPositions(botId: string): Promise<DekantPosition[]>;
  submitBuyOrder(input: SubmitTradeRequest): Promise<SubmitTradeResult>;
  submitSellOrder(input: SubmitTradeRequest): Promise<SubmitTradeResult>;
}

export type DekantClientOptions = {
  baseUrl: string;
  timeoutMs: number;
  retryCount: number;
  retryBackoffMs: number;
  fetchImpl?: typeof fetch;
  onMarketDropped?: (input: { reason: string; raw: unknown }) => void;
};

export class HttpDekantClient implements Pick<DekantClient, "fetchMarkets"> {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly retryCount: number;
  private readonly retryBackoffMs: number;
  private readonly fetchImpl?: typeof fetch;
  private readonly onMarketDropped?: (input: { reason: string; raw: unknown }) => void;

  constructor(options: DekantClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs;
    this.retryCount = options.retryCount;
    this.retryBackoffMs = options.retryBackoffMs;
    this.fetchImpl = options.fetchImpl;
    this.onMarketDropped = options.onMarketDropped;
  }

  async fetchMarkets(): Promise<DekantMarket[]> {
    const payload = await requestJsonWithRetry<unknown>({
      url: `${this.baseUrl}/markets`,
      timeoutMs: this.timeoutMs,
      retryCount: this.retryCount,
      retryBackoffMs: this.retryBackoffMs,
      fetchImpl: this.fetchImpl
    });

    const parsed = marketsResponseSchema.parse(payload);
    const raw = Array.isArray(parsed) ? parsed : parsed.data;
    const valid: DekantMarket[] = [];
    for (const entry of raw) {
      const result = marketSchema.safeParse(entry);
      if (!result.success) {
        this.onMarketDropped?.({ reason: result.error.message, raw: entry });
        continue;
      }
      // Bot only trades on Continuous markets (marketType === 2). Binary/Multi
      // markets reject buy_distribution/sell_distribution on-chain with WrongMarketType.
      if (result.data.marketType !== 2) {
        this.onMarketDropped?.({ reason: `non_continuous_market_type:${result.data.marketType}`, raw: entry });
        continue;
      }
      valid.push(result.data);
    }
    return valid;
  }
}
