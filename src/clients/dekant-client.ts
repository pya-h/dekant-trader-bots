import { z } from "zod";
import { requestJsonWithRetry } from "./http-client.js";

const marketSchema = z.object({
  id: z.string(),
  subject: z.string(),
  category: z.string().optional(),
  status: z.string().optional(),
  liquidity: z.number().optional(),
  deadline: z.string().optional()
});

const positionSchema = z.object({
  id: z.string(),
  marketId: z.string(),
  token: z.string(),
  amount: z.number(),
  side: z.string().optional(),
  center: z.number().optional(),
  entryPrice: z.number().optional(),
  price: z.number().optional()
});

const txResultSchema = z.object({
  txId: z.string()
});

const prepareBotResultSchema = z.object({
  userId: z.string(),
  publicKey: z.string()
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

export type PrepareBotRequest = {
  botId: string;
  publicKey: string;
};

export interface DekantClient {
  fetchMarkets(): Promise<DekantMarket[]>;
  fetchPositions(botId: string): Promise<DekantPosition[]>;
  submitBuyOrder(input: SubmitTradeRequest): Promise<{ txId: string }>;
  submitSellOrder(input: SubmitTradeRequest): Promise<{ txId: string }>;
  prepareBotUser(input: PrepareBotRequest): Promise<{ userId: string; publicKey: string }>;
}

export type DekantClientOptions = {
  baseUrl: string;
  timeoutMs: number;
  retryCount: number;
  retryBackoffMs: number;
  fetchImpl?: typeof fetch;
};

export class HttpDekantClient implements DekantClient {
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

    return z.array(marketSchema).parse(payload);
  }

  async fetchPositions(botId: string): Promise<DekantPosition[]> {
    const params = new URLSearchParams({ botId });
    const payload = await requestJsonWithRetry<unknown>({
      url: `${this.baseUrl}/positions?${params.toString()}`,
      timeoutMs: this.timeoutMs,
      retryCount: this.retryCount,
      retryBackoffMs: this.retryBackoffMs,
      fetchImpl: this.fetchImpl
    });

    return z.array(positionSchema).parse(payload);
  }

  async submitBuyOrder(input: SubmitTradeRequest): Promise<{ txId: string }> {
    const payload = await requestJsonWithRetry<unknown>({
      url: `${this.baseUrl}/trades/buy`,
      method: "POST",
      body: input,
      timeoutMs: this.timeoutMs,
      retryCount: this.retryCount,
      retryBackoffMs: this.retryBackoffMs,
      fetchImpl: this.fetchImpl
    });

    return txResultSchema.parse(payload);
  }

  async submitSellOrder(input: SubmitTradeRequest): Promise<{ txId: string }> {
    const payload = await requestJsonWithRetry<unknown>({
      url: `${this.baseUrl}/trades/sell`,
      method: "POST",
      body: input,
      timeoutMs: this.timeoutMs,
      retryCount: this.retryCount,
      retryBackoffMs: this.retryBackoffMs,
      fetchImpl: this.fetchImpl
    });

    return txResultSchema.parse(payload);
  }

  async prepareBotUser(input: PrepareBotRequest): Promise<{ userId: string; publicKey: string }> {
    const payload = await requestJsonWithRetry<unknown>({
      url: `${this.baseUrl}/bots/prepare`,
      method: "POST",
      body: input,
      timeoutMs: this.timeoutMs,
      retryCount: this.retryCount,
      retryBackoffMs: this.retryBackoffMs,
      fetchImpl: this.fetchImpl
    });

    return prepareBotResultSchema.parse(payload);
  }
}
