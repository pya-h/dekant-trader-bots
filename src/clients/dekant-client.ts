import { z } from "zod";
import { requestJsonWithRetry } from "./http-client.js";

const marketSchema = z.object({
  id: z.string(),
  subject: z.string(),
  collateralMint: z.string().min(1),
  category: z.string().optional(),
  state: z.number().int().optional(),
  // Stringified u64 from the backend (collateral mint base units).
  lpSharesTotal: z.string().optional(),
  liquidity: z.number().optional(),
  deadline: z.string().optional()
});

const marketsResponseSchema = z.union([
  z.array(marketSchema),
  z.object({ data: z.array(marketSchema) }).passthrough()
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

export interface DekantClient {
  fetchMarkets(): Promise<DekantMarket[]>;
  fetchPositions(botId: string): Promise<DekantPosition[]>;
  submitBuyOrder(input: SubmitTradeRequest): Promise<{ txId: string }>;
  submitSellOrder(input: SubmitTradeRequest): Promise<{ txId: string }>;
}

export type DekantClientOptions = {
  baseUrl: string;
  timeoutMs: number;
  retryCount: number;
  retryBackoffMs: number;
  fetchImpl?: typeof fetch;
};

export class HttpDekantClient implements Pick<DekantClient, "fetchMarkets"> {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly retryCount: number;
  private readonly retryBackoffMs: number;
  private readonly fetchImpl?: typeof fetch;

  constructor(options: DekantClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs;
    this.retryCount = options.retryCount;
    this.retryBackoffMs = options.retryBackoffMs;
    this.fetchImpl = options.fetchImpl;
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
    return Array.isArray(parsed) ? parsed : parsed.data;
  }
}
