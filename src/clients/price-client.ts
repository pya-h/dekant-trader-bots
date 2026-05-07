import { z } from "zod";
import { requestJsonWithRetry, HttpResponseError } from "./http-client.js";

const priceQuoteSchema = z.object({
  token_id: z.string(),
  price: z.number(),
  ema_price: z.number(),
  confidence: z.number(),
  timestamp: z.string().datetime(),
  stale: z.boolean().optional()
});

const priceQuoteArraySchema = z.array(priceQuoteSchema);

export type PriceQuote = {
  tokenId: string;
  price: number;
  emaPrice: number;
  confidence: number;
  timestamp: string;
  stale: boolean;
};

export type MarketLike = {
  id: string;
  subject: string;
};

export type MarketPriceDecision = {
  marketId: string;
  token: string;
  status: "ok" | "missing" | "stale";
  quote?: PriceQuote;
};

export type ResolvedPriceResult = {
  requestedTokens: string[];
  tradableQuotesByToken: Map<string, PriceQuote>;
  allQuotesByToken: Map<string, PriceQuote>;
  missingTokens: string[];
  staleTokens: string[];
};

export type MarketPriceResolution = {
  byMarketId: Map<string, MarketPriceDecision>;
  quotesByToken: Map<string, PriceQuote>;
  missingTokens: string[];
  staleTokens: string[];
};

export type PriceClientOptions = {
  baseUrl: string;
  timeoutMs: number;
  retryCount: number;
  retryBackoffMs: number;
  stalePolicy: "skip" | "allow";
  fetchImpl?: typeof fetch;
};

export function normalizeTokenId(token: string): string {
  return token.trim().toUpperCase();
}

function mapQuote(raw: z.infer<typeof priceQuoteSchema>): PriceQuote {
  return {
    tokenId: normalizeTokenId(raw.token_id),
    price: raw.price,
    emaPrice: raw.ema_price,
    confidence: raw.confidence,
    timestamp: raw.timestamp,
    stale: raw.stale === true
  };
}

export function extractUniqueTokensFromMarkets(markets: MarketLike[]): string[] {
  return [...new Set(markets.map((market) => normalizeTokenId(market.subject)).filter(Boolean))];
}

export class PriceClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly retryCount: number;
  private readonly retryBackoffMs: number;
  private readonly stalePolicy: "skip" | "allow";
  private readonly fetchImpl?: typeof fetch;

  constructor(options: PriceClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs;
    this.retryCount = options.retryCount;
    this.retryBackoffMs = options.retryBackoffMs;
    this.stalePolicy = options.stalePolicy;
    this.fetchImpl = options.fetchImpl;
  }

  private async fetchBatch(tokens: string[]): Promise<PriceQuote[]> {
    if (tokens.length === 0) {
      return [];
    }

    const params = new URLSearchParams({
      tokens: tokens.join(",")
    });

    const payload = await requestJsonWithRetry<unknown>({
      url: `${this.baseUrl}/prices?${params.toString()}`,
      timeoutMs: this.timeoutMs,
      retryCount: this.retryCount,
      retryBackoffMs: this.retryBackoffMs,
      fetchImpl: this.fetchImpl
    });

    return priceQuoteArraySchema.parse(payload).map(mapQuote);
  }

  private async fetchSingle(token: string): Promise<PriceQuote | null> {
    try {
      const payload = await requestJsonWithRetry<unknown>({
        url: `${this.baseUrl}/prices/${encodeURIComponent(token)}`,
        timeoutMs: this.timeoutMs,
        retryCount: this.retryCount,
        retryBackoffMs: this.retryBackoffMs,
        fetchImpl: this.fetchImpl
      });

      return mapQuote(priceQuoteSchema.parse(payload));
    } catch (error) {
      if (error instanceof HttpResponseError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async fetchResolvedPrices(tokens: string[]): Promise<ResolvedPriceResult> {
    const normalizedTokens = [...new Set(tokens.map(normalizeTokenId).filter(Boolean))];
    const quotesByToken = new Map<string, PriceQuote>();

    const batchQuotes = await this.fetchBatch(normalizedTokens);
    for (const quote of batchQuotes) {
      quotesByToken.set(quote.tokenId, quote);
    }

    const batchMissing = normalizedTokens.filter((token) => !quotesByToken.has(token));
    for (const token of batchMissing) {
      const quote = await this.fetchSingle(token);
      if (quote) {
        quotesByToken.set(token, quote);
      }
    }

    const missingTokens = normalizedTokens.filter((token) => !quotesByToken.has(token));
    const staleTokens = [...quotesByToken.values()]
      .filter((quote) => quote.stale)
      .map((quote) => quote.tokenId);

    const tradableQuotesByToken = new Map<string, PriceQuote>();
    for (const [token, quote] of quotesByToken.entries()) {
      if (quote.stale && this.stalePolicy === "skip") {
        continue;
      }
      tradableQuotesByToken.set(token, quote);
    }

    return {
      requestedTokens: normalizedTokens,
      tradableQuotesByToken,
      allQuotesByToken: quotesByToken,
      missingTokens,
      staleTokens
    };
  }

  async resolveMarketPrices(markets: MarketLike[]): Promise<MarketPriceResolution> {
    const tokens = extractUniqueTokensFromMarkets(markets);
    const resolved = await this.fetchResolvedPrices(tokens);

    const staleSet = new Set(resolved.staleTokens);
    const byMarketId = new Map<string, MarketPriceDecision>();

    for (const market of markets) {
      const token = normalizeTokenId(market.subject);
      const tradable = resolved.tradableQuotesByToken.get(token);

      if (tradable) {
        byMarketId.set(market.id, {
          marketId: market.id,
          token,
          status: "ok",
          quote: tradable
        });
        continue;
      }

      if (staleSet.has(token) && this.stalePolicy === "skip") {
        byMarketId.set(market.id, {
          marketId: market.id,
          token,
          status: "stale"
        });
        continue;
      }

      byMarketId.set(market.id, {
        marketId: market.id,
        token,
        status: "missing"
      });
    }

    return {
      byMarketId,
      quotesByToken: resolved.tradableQuotesByToken,
      missingTokens: resolved.missingTokens,
      staleTokens: resolved.staleTokens
    };
  }
}
