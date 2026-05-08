import { z } from "zod";
import { requestJsonWithRetry } from "./http-client.js";
import { VaultClient } from "../funding/engine.js";

const transferResultSchema = z.object({
  txId: z.string()
});

export type VaultClientOptions = {
  baseUrl: string;
  secretKey: string;
  timeoutMs: number;
  retryCount: number;
  retryBackoffMs: number;
  fetchImpl?: typeof fetch;
};

export class HttpVaultClient implements VaultClient {
  private readonly baseUrl: string;
  private readonly secretKey: string;
  private readonly timeoutMs: number;
  private readonly retryCount: number;
  private readonly retryBackoffMs: number;
  private readonly fetchImpl?: typeof fetch;

  constructor(options: VaultClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.secretKey = options.secretKey;
    this.timeoutMs = options.timeoutMs;
    this.retryCount = options.retryCount;
    this.retryBackoffMs = options.retryBackoffMs;
    this.fetchImpl = options.fetchImpl;
  }

  async transferToken(input: {
    token: string;
    toAddress: string;
    amount: number;
  }): Promise<{ txId: string }> {
    const payload = await requestJsonWithRetry<unknown>({
      url: `${this.baseUrl}/vault/transfer`,
      method: "POST",
      body: {
        secretKey: this.secretKey,
        token: input.token,
        toAddress: input.toAddress,
        amount: input.amount
      },
      timeoutMs: this.timeoutMs,
      retryCount: this.retryCount,
      retryBackoffMs: this.retryBackoffMs,
      fetchImpl: this.fetchImpl
    });

    return transferResultSchema.parse(payload);
  }

  async transferSol(input: {
    toAddress: string;
    amount: number;
  }): Promise<{ txId: string }> {
    const payload = await requestJsonWithRetry<unknown>({
      url: `${this.baseUrl}/vault/transfer-sol`,
      method: "POST",
      body: {
        secretKey: this.secretKey,
        toAddress: input.toAddress,
        amount: input.amount
      },
      timeoutMs: this.timeoutMs,
      retryCount: this.retryCount,
      retryBackoffMs: this.retryBackoffMs,
      fetchImpl: this.fetchImpl
    });

    return transferResultSchema.parse(payload);
  }
}
