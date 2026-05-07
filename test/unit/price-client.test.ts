import { describe, expect, it } from "vitest";
import {
  extractUniqueTokensFromMarkets,
  normalizeTokenId,
  PriceClient
} from "../../src/clients/price-client.js";

describe("price-client token helpers", () => {
  it("normalizes token identifiers", () => {
    expect(normalizeTokenId(" sol ")).toBe("SOL");
  });

  it("extracts uppercase unique tokens from markets", () => {
    const tokens = extractUniqueTokensFromMarkets([
      { id: "m1", subject: "sol" },
      { id: "m2", subject: " SOL " },
      { id: "m3", subject: "btc" }
    ]);

    expect(tokens).toEqual(["SOL", "BTC"]);
  });
});

describe("price-client resolve logic", () => {
  it("parses batch data, uses single fallback for missing tokens, and skips stale quotes", async () => {
    const fetchCalls: string[] = [];

    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      fetchCalls.push(url);

      if (url.includes("/prices?")) {
        return new Response(
          JSON.stringify([
            {
              token_id: "BTC",
              price: 90000,
              ema_price: 90100,
              confidence: 0.001,
              timestamp: "2026-01-01T00:00:00Z"
            },
            {
              token_id: "SOL",
              price: 200,
              ema_price: 201,
              confidence: 0.002,
              timestamp: "2026-01-01T00:00:00Z",
              stale: true
            }
          ]),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        );
      }

      if (url.endsWith("/prices/ETH")) {
        return new Response(
          JSON.stringify({
            token_id: "ETH",
            price: 3500,
            ema_price: 3490,
            confidence: 0.001,
            timestamp: "2026-01-01T00:00:00Z"
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        );
      }

      return new Response(JSON.stringify({ error: "token not found" }), {
        status: 404,
        headers: { "content-type": "application/json" }
      });
    };

    const client = new PriceClient({
      baseUrl: "https://prices.example.com",
      timeoutMs: 200,
      retryCount: 0,
      retryBackoffMs: 0,
      stalePolicy: "skip",
      fetchImpl
    });

    const resolved = await client.fetchResolvedPrices([" btc ", "eth", "SOL"]);

    expect([...resolved.tradableQuotesByToken.keys()].sort()).toEqual(["BTC", "ETH"]);
    expect(resolved.staleTokens).toEqual(["SOL"]);
    expect(resolved.missingTokens).toEqual([]);
    expect(fetchCalls.some((url) => url.includes("/prices?tokens=BTC%2CETH%2CSOL"))).toBe(true);
    expect(fetchCalls.some((url) => url.endsWith("/prices/ETH"))).toBe(true);
  });
});
