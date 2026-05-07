import { describe, expect, it } from "vitest";
import { HttpResponseError, requestJsonWithRetry } from "../../src/clients/http-client.js";

describe("requestJsonWithRetry", () => {
  it("retries transient network failures and succeeds within retry limit", async () => {
    let calls = 0;
    const sleepCalls: number[] = [];

    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      if (calls < 3) {
        throw new TypeError("network failure");
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };

    const result = await requestJsonWithRetry<{ ok: boolean }>({
      url: "https://example.test/retry",
      timeoutMs: 100,
      retryCount: 2,
      retryBackoffMs: 20,
      fetchImpl,
      sleep: async (ms) => {
        sleepCalls.push(ms);
      }
    });

    expect(result).toEqual({ ok: true });
    expect(calls).toBe(3);
    expect(sleepCalls).toEqual([20, 40]);
  });

  it("stops after retry limit on repeated transient failures", async () => {
    let calls = 0;

    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      throw new TypeError("still down");
    };

    await expect(
      requestJsonWithRetry({
        url: "https://example.test/down",
        timeoutMs: 100,
        retryCount: 1,
        retryBackoffMs: 10,
        fetchImpl,
        sleep: async () => {}
      })
    ).rejects.toThrow();

    expect(calls).toBe(2);
  });

  it("does not retry non-retriable responses", async () => {
    let calls = 0;

    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "content-type": "application/json" }
      });
    };

    await expect(
      requestJsonWithRetry({
        url: "https://example.test/missing",
        timeoutMs: 100,
        retryCount: 3,
        retryBackoffMs: 5,
        fetchImpl,
        sleep: async () => {}
      })
    ).rejects.toBeInstanceOf(HttpResponseError);

    expect(calls).toBe(1);
  });
});
