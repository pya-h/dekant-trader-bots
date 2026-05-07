import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { PriceClient } from "../../src/clients/price-client.js";

type PriceServerFixture = {
  url: string;
  close: () => Promise<void>;
};

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const close = cleanups.pop();
    if (close) {
      await close();
    }
  }
});

async function startPriceServer(
  registerRoutes: (app: FastifyInstance) => void | Promise<void>
): Promise<PriceServerFixture> {
  const app = Fastify({ logger: false });
  await registerRoutes(app);

  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address() as AddressInfo;

  const close = async () => {
    await app.close();
  };
  cleanups.push(close);

  return {
    url: `http://127.0.0.1:${address.port}`,
    close
  };
}

describe("price-client integration", () => {
  it("maps market.subject to token price correctly", async () => {
    const server = await startPriceServer((app) => {
      app.get("/prices", async () => {
        return [
          {
            token_id: "SOL",
            price: 210,
            ema_price: 211,
            confidence: 0.001,
            timestamp: "2026-01-01T00:00:00Z"
          }
        ];
      });

      app.get("/prices/:token", async (_request: FastifyRequest, reply: FastifyReply) => {
        reply.code(404);
        return { error: "token not found" };
      });
    });

    const client = new PriceClient({
      baseUrl: server.url,
      timeoutMs: 500,
      retryCount: 0,
      retryBackoffMs: 0,
      stalePolicy: "skip"
    });

    const result = await client.resolveMarketPrices([{ id: "m1", subject: " sol " }]);

    const marketResult = result.byMarketId.get("m1");
    expect(marketResult?.status).toBe("ok");
    expect(marketResult?.quote?.tokenId).toBe("SOL");
    expect(marketResult?.quote?.price).toBe(210);
  });

  it("uses single-token fallback when batch omits a token", async () => {
    let batchCalls = 0;
    let singleCalls = 0;

    const server = await startPriceServer((app) => {
      app.get("/prices", async () => {
        batchCalls += 1;
        return [
          {
            token_id: "BTC",
            price: 90000,
            ema_price: 90050,
            confidence: 0.001,
            timestamp: "2026-01-01T00:00:00Z"
          }
        ];
      });

      app.get(
        "/prices/:token",
        async (request: FastifyRequest<{ Params: { token: string } }>, reply: FastifyReply) => {
          singleCalls += 1;
          if (request.params.token === "ETH") {
            return {
              token_id: "ETH",
              price: 3500,
              ema_price: 3510,
              confidence: 0.001,
              timestamp: "2026-01-01T00:00:00Z"
            };
          }

          reply.code(404);
          return { error: "token not found" };
        }
      );
    });

    const client = new PriceClient({
      baseUrl: server.url,
      timeoutMs: 500,
      retryCount: 0,
      retryBackoffMs: 0,
      stalePolicy: "skip"
    });

    const result = await client.resolveMarketPrices([
      { id: "m1", subject: "BTC" },
      { id: "m2", subject: "ETH" }
    ]);

    expect(batchCalls).toBe(1);
    expect(singleCalls).toBe(1);
    expect(result.byMarketId.get("m1")?.status).toBe("ok");
    expect(result.byMarketId.get("m2")?.status).toBe("ok");
  });

  it("marks stale price as skipped when stale policy is skip", async () => {
    const server = await startPriceServer((app) => {
      app.get("/prices", async () => {
        return [
          {
            token_id: "SOL",
            price: 210,
            ema_price: 211,
            confidence: 0.001,
            timestamp: "2026-01-01T00:00:00Z",
            stale: true
          }
        ];
      });

      app.get("/prices/:token", async (_request: FastifyRequest, reply: FastifyReply) => {
        reply.code(404);
        return { error: "token not found" };
      });
    });

    const client = new PriceClient({
      baseUrl: server.url,
      timeoutMs: 500,
      retryCount: 0,
      retryBackoffMs: 0,
      stalePolicy: "skip"
    });

    const result = await client.resolveMarketPrices([{ id: "m1", subject: "SOL" }]);

    expect(result.byMarketId.get("m1")?.status).toBe("stale");
    expect(result.quotesByToken.has("SOL")).toBe(false);
    expect(result.staleTokens).toEqual(["SOL"]);
  });
});
