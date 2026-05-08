import { z } from "zod";
import { requestJsonWithRetry } from "./http-client.js";
import { BalanceClient } from "../funding/engine.js";

const balanceResponseSchema = z.object({
  sol: z.number(),
  tokens: z.record(z.string(), z.number())
});

export type BalanceClientOptions = {
  baseUrl: string;
  timeoutMs: number;
  retryCount: number;
  retryBackoffMs: number;
  fetchImpl?: typeof fetch;
};

export class HttpBalanceClient implements BalanceClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly retryCount: number;
  private readonly retryBackoffMs: number;
  private readonly fetchImpl?: typeof fetch;

  constructor(options: BalanceClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs;
    this.retryCount = options.retryCount;
    this.retryBackoffMs = options.retryBackoffMs;
    this.fetchImpl = options.fetchImpl;
  }

  async getBotBalance(
    address: string,
    tokens: string[]
  ): Promise<{ sol: number; tokens: Record<string, number> }> {
    const params = new URLSearchParams({
      tokens: tokens.join(",")
    });

    const payload = await requestJsonWithRetry<unknown>({
      url: `${this.baseUrl}/balances/${encodeURIComponent(address)}?${params.toString()}`,
      timeoutMs: this.timeoutMs,
      retryCount: this.retryCount,
      retryBackoffMs: this.retryBackoffMs,
      fetchImpl: this.fetchImpl
    });

    return balanceResponseSchema.parse(payload);
  }
}
