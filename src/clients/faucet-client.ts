import { z } from "zod";
import { requestJsonWithRetry } from "./http-client.js";

const availabilitySchema = z.object({
  available: z.boolean(),
  reason: z.string().optional()
});

const requestFaucetResultSchema = z.object({
  success: z.boolean(),
  amount: z.number().optional(),
  txId: z.string().optional()
});

export type FaucetAvailability = z.infer<typeof availabilitySchema>;

export type FaucetRequestInput = {
  token: string;
  walletAddress: string;
};

export interface FaucetClient {
  checkAvailability(token: string): Promise<FaucetAvailability>;
  requestTokens(input: FaucetRequestInput): Promise<z.infer<typeof requestFaucetResultSchema>>;
}

export type FaucetClientOptions = {
  baseUrl: string;
  timeoutMs: number;
  retryCount: number;
  retryBackoffMs: number;
  fetchImpl?: typeof fetch;
};

export class HttpFaucetClient implements FaucetClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly retryCount: number;
  private readonly retryBackoffMs: number;
  private readonly fetchImpl?: typeof fetch;

  constructor(options: FaucetClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs;
    this.retryCount = options.retryCount;
    this.retryBackoffMs = options.retryBackoffMs;
    this.fetchImpl = options.fetchImpl;
  }

  async checkAvailability(token: string): Promise<FaucetAvailability> {
    const payload = await requestJsonWithRetry<unknown>({
      url: `${this.baseUrl}/faucet/${encodeURIComponent(token)}/availability`,
      timeoutMs: this.timeoutMs,
      retryCount: this.retryCount,
      retryBackoffMs: this.retryBackoffMs,
      fetchImpl: this.fetchImpl
    });

    return availabilitySchema.parse(payload);
  }

  async requestTokens(
    input: FaucetRequestInput
  ): Promise<z.infer<typeof requestFaucetResultSchema>> {
    const payload = await requestJsonWithRetry<unknown>({
      url: `${this.baseUrl}/faucet/${encodeURIComponent(input.token)}/request`,
      method: "POST",
      body: {
        walletAddress: input.walletAddress
      },
      timeoutMs: this.timeoutMs,
      retryCount: this.retryCount,
      retryBackoffMs: this.retryBackoffMs,
      fetchImpl: this.fetchImpl
    });

    return requestFaucetResultSchema.parse(payload);
  }
}
