import { randomUUID } from "node:crypto";
import { DekantClient, DekantMarket, DekantPosition } from "../clients/dekant-client.js";
import { MarketPriceResolution } from "../clients/price-client.js";
import { BotRecord } from "../state/types.js";
import { buildPredictionRange, rollChance } from "./buy-engine.js";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundToFixed(value: number): number {
  return Number(value.toFixed(6));
}

function normalizeToken(token: string): string {
  return token.trim().toUpperCase();
}

export function resolvePositionReferencePrice(position: DekantPosition): number | null {
  if (typeof position.center === "number" && Number.isFinite(position.center)) {
    return position.center;
  }

  if (typeof position.entryPrice === "number" && Number.isFinite(position.entryPrice)) {
    return position.entryPrice;
  }

  if (typeof position.price === "number" && Number.isFinite(position.price)) {
    return position.price;
  }

  return null;
}

export function isPositionFarFromPredictedRange(options: {
  referencePrice: number;
  predictedMin: number;
  predictedMax: number;
  toleranceRatio?: number;
}): boolean {
  const toleranceRatio = clamp(options.toleranceRatio ?? 0.03, 0, 0.5);
  const lowerBound = options.predictedMin * (1 - toleranceRatio);
  const upperBound = options.predictedMax * (1 + toleranceRatio);

  return options.referencePrice < lowerBound || options.referencePrice > upperBound;
}

export function decideSellMode(options: {
  random?: () => number;
  partialBiasPercent?: number;
} = {}): "partial" | "full" {
  const random = options.random ?? Math.random;
  const partialBiasPercent = clamp(options.partialBiasPercent ?? 75, 0, 100);

  return rollChance(partialBiasPercent, random) ? "partial" : "full";
}

export function pickPartialSellAmount(positionAmount: number, random: () => number = Math.random): number {
  if (!Number.isFinite(positionAmount) || positionAmount <= 0) {
    return 0;
  }

  const ratio = 0.15 + random() * 0.7;
  const amount = positionAmount * ratio;

  return roundToFixed(clamp(amount, Math.min(positionAmount, 0.000001), positionAmount));
}

export type SellCycleSource = "manual" | "scheduled";

export type SellCycleAction = {
  botId: string;
  marketId: string;
  token: string;
  positionId: string;
  status:
    | "sold_full"
    | "sold_partial"
    | "skipped_in_range"
    | "skipped_chance"
    | "skipped_missing_price"
    | "skipped_stale_price"
    | "skipped_no_reference"
    | "skipped_invalid_amount"
    | "failed_submit";
  requestedSellAmount?: number;
  txId?: string;
  error?: string;
};

export type SellCycleResult = {
  cycleId: string;
  source: SellCycleSource;
  startedAt: string;
  finishedAt: string;
  busy: boolean;
  totalBots: number;
  totalMarkets: number;
  selectedMarkets: number;
  botsWithPositions: number;
  botsWithoutPositions: number;
  positionsConsidered: number;
  requestedTokenCount: number;
  missingTokenCount: number;
  staleTokenCount: number;
  soldFullCount: number;
  soldPartialCount: number;
  skippedInRangeCount: number;
  skippedChanceCount: number;
  skippedMissingPriceCount: number;
  skippedStalePriceCount: number;
  skippedNoReferenceCount: number;
  skippedInvalidAmountCount: number;
  failedSubmitCount: number;
  actions: SellCycleAction[];
};

type PriceClientLike = {
  resolveMarketPrices(markets: Array<{ id: string; subject: string }>): Promise<MarketPriceResolution>;
};

type DekantSellingClient = Pick<DekantClient, "fetchPositions" | "submitSellOrder">;
export type SellEnginePriceClient = PriceClientLike;
export type SellEngineDekantSellingClient = DekantSellingClient;

type SellMarket = Pick<DekantMarket, "id" | "subject" | "collateralMint" | "deadline">;

export type SellEngineIntervalProvider = {
  setInterval(handler: () => void, intervalMs: number): unknown;
  clearInterval(handle: unknown): void;
};

export type SellEngineCycleErrorContext = {
  source: SellCycleSource;
  stage: "immediate" | "interval";
};

const defaultIntervalProvider: SellEngineIntervalProvider = {
  setInterval: (handler, intervalMs) => setInterval(handler, intervalMs),
  clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout)
};

export class SellEngine {
  private readonly priceClient: PriceClientLike;
  private readonly dekantClient: DekantSellingClient;
  private readonly getBots: () => BotRecord[];
  private readonly getMarkets: () => SellMarket[];
  private sellChance: number;
  private readonly intervalMs: number;
  private readonly partialBiasPercent: number;
  private readonly random: () => number;
  private readonly now: () => Date;
  private readonly timer: SellEngineIntervalProvider;
  private readonly onCycleError?: (
    error: unknown,
    context: SellEngineCycleErrorContext
  ) => void | Promise<void>;

  private intervalHandle: unknown = null;
  private running = false;
  private lastCycleAt: string | null = null;
  private lastResult: SellCycleResult | null = null;

  constructor(options: {
    runtime: {
      sellChance: number;
      intervalMs: number;
      partialBiasPercent?: number;
    };
    clients: {
      price: PriceClientLike;
      dekant: DekantSellingClient;
    };
    getBots: () => BotRecord[];
    getMarkets: () => SellMarket[];
    random?: () => number;
    now?: () => Date;
    timer?: SellEngineIntervalProvider;
    onCycleError?: (error: unknown, context: SellEngineCycleErrorContext) => void | Promise<void>;
  }) {
    this.sellChance = options.runtime.sellChance;
    this.intervalMs = options.runtime.intervalMs;
    this.partialBiasPercent = options.runtime.partialBiasPercent ?? 75;
    this.priceClient = options.clients.price;
    this.dekantClient = options.clients.dekant;
    this.getBots = options.getBots;
    this.getMarkets = options.getMarkets;
    this.random = options.random ?? Math.random;
    this.now = options.now ?? (() => new Date());
    this.timer = options.timer ?? defaultIntervalProvider;
    this.onCycleError = options.onCycleError;
  }

  private notifyCycleError(error: unknown, context: SellEngineCycleErrorContext): void {
    if (!this.onCycleError) {
      return;
    }

    try {
      const result = this.onCycleError(error, context);
      if (result && typeof (result as Promise<void>).catch === "function") {
        void (result as Promise<void>).catch(() => {});
      }
    } catch {
      // Do not allow logging/error callbacks to crash worker loops.
    }
  }

  private toErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return "sell_submit_failed";
  }

  updateRuntime(patch: { sellChance?: number }): void {
    if (patch.sellChance !== undefined) this.sellChance = patch.sellChance;
  }

  getSnapshot(): {
    isRunning: boolean;
    lastCycleAt: string | null;
    lastResult: SellCycleResult | null;
  } {
    return {
      isRunning: this.intervalHandle !== null,
      lastCycleAt: this.lastCycleAt,
      lastResult: this.lastResult
    };
  }

  private emptyResult(options: {
    source: SellCycleSource;
    startedAt: string;
    finishedAt: string;
    totalBots: number;
    totalMarkets: number;
    selectedMarkets: number;
    busy: boolean;
  }): SellCycleResult {
    return {
      cycleId: randomUUID(),
      source: options.source,
      startedAt: options.startedAt,
      finishedAt: options.finishedAt,
      busy: options.busy,
      totalBots: options.totalBots,
      totalMarkets: options.totalMarkets,
      selectedMarkets: options.selectedMarkets,
      botsWithPositions: 0,
      botsWithoutPositions: 0,
      positionsConsidered: 0,
      requestedTokenCount: 0,
      missingTokenCount: 0,
      staleTokenCount: 0,
      soldFullCount: 0,
      soldPartialCount: 0,
      skippedInRangeCount: 0,
      skippedChanceCount: 0,
      skippedMissingPriceCount: 0,
      skippedStalePriceCount: 0,
      skippedNoReferenceCount: 0,
      skippedInvalidAmountCount: 0,
      failedSubmitCount: 0,
      actions: []
    };
  }

  async runCycle(options: {
    source?: SellCycleSource;
    marketIds?: string[];
  } = {}): Promise<SellCycleResult> {
    const source = options.source ?? "manual";
    const startedAtDate = this.now();
    const startedAt = startedAtDate.toISOString();

    const bots = this.getBots();
    const allMarkets = this.getMarkets();
    const marketFilter = (options.marketIds ?? []).map((id) => id.trim()).filter(Boolean);
    const selectedMarketIdSet = new Set(marketFilter);

    const selectedMarkets =
      marketFilter.length > 0
        ? allMarkets.filter((market) => selectedMarketIdSet.has(market.id))
        : allMarkets;

    if (this.running) {
      const busyResult = this.emptyResult({
        source,
        startedAt,
        finishedAt: this.now().toISOString(),
        totalBots: bots.length,
        totalMarkets: allMarkets.length,
        selectedMarkets: selectedMarkets.length,
        busy: true
      });
      this.lastResult = busyResult;
      return busyResult;
    }

    if (bots.length === 0 || selectedMarkets.length === 0) {
      const empty = this.emptyResult({
        source,
        startedAt,
        finishedAt: this.now().toISOString(),
        totalBots: bots.length,
        totalMarkets: allMarkets.length,
        selectedMarkets: selectedMarkets.length,
        busy: false
      });
      this.lastResult = empty;
      this.lastCycleAt = empty.finishedAt;
      return empty;
    }

    this.running = true;

    try {
      const selectedMarketsById = new Map(selectedMarkets.map((market) => [market.id, market]));
      const positionsByBot = new Map<string, DekantPosition[]>();

      let botsWithPositions = 0;
      let botsWithoutPositions = 0;

      for (const bot of bots) {
        const positions = await this.dekantClient.fetchPositions(bot.id);
        const selectedPositions = positions.filter((position) => selectedMarketsById.has(position.marketId));

        if (selectedPositions.length === 0) {
          botsWithoutPositions += 1;
          continue;
        }

        botsWithPositions += 1;
        positionsByBot.set(bot.id, selectedPositions);
      }

      const marketsForPricingById = new Map<string, SellMarket>();
      for (const positions of positionsByBot.values()) {
        for (const position of positions) {
          const market = selectedMarketsById.get(position.marketId);
          if (market) {
            marketsForPricingById.set(market.id, market);
          }
        }
      }

      const marketsForPricing = [...marketsForPricingById.values()];
      if (marketsForPricing.length === 0) {
        const empty = this.emptyResult({
          source,
          startedAt,
          finishedAt: this.now().toISOString(),
          totalBots: bots.length,
          totalMarkets: allMarkets.length,
          selectedMarkets: selectedMarkets.length,
          busy: false
        });

        empty.botsWithPositions = botsWithPositions;
        empty.botsWithoutPositions = botsWithoutPositions;

        this.lastResult = empty;
        this.lastCycleAt = empty.finishedAt;
        return empty;
      }

      const priceResolution = await this.priceClient.resolveMarketPrices(
        marketsForPricing.map((market) => ({
          id: market.id,
          subject: market.subject
        }))
      );

      const actions: SellCycleAction[] = [];
      let positionsConsidered = 0;
      let soldFullCount = 0;
      let soldPartialCount = 0;
      let skippedInRangeCount = 0;
      let skippedChanceCount = 0;
      let skippedMissingPriceCount = 0;
      let skippedStalePriceCount = 0;
      let skippedNoReferenceCount = 0;
      let skippedInvalidAmountCount = 0;
      let failedSubmitCount = 0;

      for (const bot of bots) {
        const positions = positionsByBot.get(bot.id) ?? [];

        for (const position of positions) {
          positionsConsidered += 1;

          const market = selectedMarketsById.get(position.marketId);
          const token = market?.collateralMint ?? position.token ?? "";
          const marketPrice = priceResolution.byMarketId.get(position.marketId);

          if (!marketPrice || marketPrice.status === "missing") {
            skippedMissingPriceCount += 1;
            actions.push({
              botId: bot.id,
              marketId: position.marketId,
              token,
              positionId: position.id,
              status: "skipped_missing_price"
            });
            continue;
          }

          if (marketPrice.status === "stale") {
            skippedStalePriceCount += 1;
            actions.push({
              botId: bot.id,
              marketId: position.marketId,
              token,
              positionId: position.id,
              status: "skipped_stale_price"
            });
            continue;
          }

          if (!market || !marketPrice.quote) {
            skippedMissingPriceCount += 1;
            actions.push({
              botId: bot.id,
              marketId: position.marketId,
              token,
              positionId: position.id,
              status: "skipped_missing_price"
            });
            continue;
          }

          const prediction = buildPredictionRange({
            referencePrice: marketPrice.quote.price,
            deadline: market.deadline,
            now: startedAtDate,
            random: this.random
          });

          const positionReference = resolvePositionReferencePrice(position);
          if (positionReference === null) {
            skippedNoReferenceCount += 1;
            actions.push({
              botId: bot.id,
              marketId: position.marketId,
              token,
              positionId: position.id,
              status: "skipped_no_reference"
            });
            continue;
          }

          const isFar = isPositionFarFromPredictedRange({
            referencePrice: positionReference,
            predictedMin: prediction.minPrice,
            predictedMax: prediction.maxPrice
          });

          if (!isFar) {
            skippedInRangeCount += 1;
            actions.push({
              botId: bot.id,
              marketId: position.marketId,
              token,
              positionId: position.id,
              status: "skipped_in_range"
            });
            continue;
          }

          if (!rollChance(this.sellChance, this.random)) {
            skippedChanceCount += 1;
            actions.push({
              botId: bot.id,
              marketId: position.marketId,
              token,
              positionId: position.id,
              status: "skipped_chance"
            });
            continue;
          }

          const mode = decideSellMode({
            random: this.random,
            partialBiasPercent: this.partialBiasPercent
          });

          const requestedSellAmount =
            mode === "partial" ? pickPartialSellAmount(position.amount, this.random) : roundToFixed(position.amount);

          if (requestedSellAmount <= 0) {
            skippedInvalidAmountCount += 1;
            actions.push({
              botId: bot.id,
              marketId: position.marketId,
              token,
              positionId: position.id,
              status: "skipped_invalid_amount"
            });
            continue;
          }

          try {
            const tx = await this.dekantClient.submitSellOrder({
              botId: bot.id,
              marketId: position.marketId,
              collateralAmount: requestedSellAmount,
              center: prediction.center,
              spread: prediction.spread
            });

            if (mode === "full") {
              soldFullCount += 1;
              actions.push({
                botId: bot.id,
                marketId: position.marketId,
                token,
                positionId: position.id,
                status: "sold_full",
                requestedSellAmount,
                txId: tx.txId
              });
            } else {
              soldPartialCount += 1;
              actions.push({
                botId: bot.id,
                marketId: position.marketId,
                token,
                positionId: position.id,
                status: "sold_partial",
                requestedSellAmount,
                txId: tx.txId
              });
            }
          } catch (error) {
            failedSubmitCount += 1;
            actions.push({
              botId: bot.id,
              marketId: position.marketId,
              token,
              positionId: position.id,
              status: "failed_submit",
              requestedSellAmount,
              error: this.toErrorMessage(error)
            });
          }
        }
      }

      const requestedTokenCount = new Set(marketsForPricing.map((market) => market.collateralMint)).size;

      const result: SellCycleResult = {
        cycleId: randomUUID(),
        source,
        startedAt,
        finishedAt: this.now().toISOString(),
        busy: false,
        totalBots: bots.length,
        totalMarkets: allMarkets.length,
        selectedMarkets: selectedMarkets.length,
        botsWithPositions,
        botsWithoutPositions,
        positionsConsidered,
        requestedTokenCount,
        missingTokenCount: priceResolution.missingTokens.length,
        staleTokenCount: priceResolution.staleTokens.length,
        soldFullCount,
        soldPartialCount,
        skippedInRangeCount,
        skippedChanceCount,
        skippedMissingPriceCount,
        skippedStalePriceCount,
        skippedNoReferenceCount,
        skippedInvalidAmountCount,
        failedSubmitCount,
        actions
      };

      this.lastCycleAt = result.finishedAt;
      this.lastResult = result;
      return result;
    } finally {
      this.running = false;
    }
  }

  async start(options: { immediate?: boolean } = {}): Promise<void> {
    if (this.intervalHandle !== null) {
      return;
    }

    if (options.immediate !== false) {
      try {
        await this.runCycle({ source: "scheduled" });
      } catch (error) {
        this.notifyCycleError(error, {
          source: "scheduled",
          stage: "immediate"
        });
      }
    }

    this.intervalHandle = this.timer.setInterval(() => {
      void this.runCycle({ source: "scheduled" }).catch((error) => {
        this.notifyCycleError(error, {
          source: "scheduled",
          stage: "interval"
        });
      });
    }, this.intervalMs);
  }

  stop(): void {
    if (this.intervalHandle === null) {
      return;
    }

    this.timer.clearInterval(this.intervalHandle);
    this.intervalHandle = null;
  }
}
