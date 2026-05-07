import { randomUUID } from "node:crypto";
import { DekantClient, DekantMarket } from "../clients/dekant-client.js";
import { MarketPriceResolution } from "../clients/price-client.js";
import { BotRecord } from "../state/types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundToFixed(value: number): number {
  return Number(value.toFixed(6));
}

export function rollChance(chancePercent: number, random: () => number = Math.random): boolean {
  const normalizedChance = clamp(Number.isFinite(chancePercent) ? chancePercent : 0, 0, 100);

  if (normalizedChance <= 0) {
    return false;
  }

  if (normalizedChance >= 100) {
    return true;
  }

  const dice = random() * 100;
  return dice < normalizedChance;
}

export function estimateRemainingDays(deadline: string | undefined, now: Date): number {
  if (!deadline) {
    return 0;
  }

  const deadlineMs = Date.parse(deadline);
  if (!Number.isFinite(deadlineMs)) {
    return 0;
  }

  const remainingMs = deadlineMs - now.getTime();
  if (remainingMs <= 0) {
    return 0;
  }

  return remainingMs / DAY_MS;
}

export function estimateMaxDeviationRatio(remainingDays: number): number {
  return clamp(0.01 + remainingDays * 0.003, 0.01, 0.3);
}

export type PredictionRange = {
  center: number;
  spread: number;
  minPrice: number;
  maxPrice: number;
  remainingDays: number;
  maxDeviationRatio: number;
};

export function buildPredictionRange(options: {
  referencePrice: number;
  deadline?: string;
  now?: Date;
  random?: () => number;
}): PredictionRange {
  const now = options.now ?? new Date();
  const random = options.random ?? Math.random;

  const price = Math.max(options.referencePrice, 0.000001);
  const remainingDays = estimateRemainingDays(options.deadline, now);
  const maxDeviationRatio = estimateMaxDeviationRatio(remainingDays);

  const maxDeviationAmount = price * maxDeviationRatio;
  const minPrice = Math.max(0.000001, roundToFixed(price - maxDeviationAmount));
  const maxPrice = roundToFixed(price + maxDeviationAmount);

  const centerShift = (random() * 2 - 1) * maxDeviationAmount * 0.5;
  const center = Math.max(0.000001, roundToFixed(price + centerShift));

  const spreadMin = Math.max(price * 0.001, maxDeviationAmount * 0.15);
  const spreadMax = Math.max(spreadMin, maxDeviationAmount * 0.6);
  const spread = roundToFixed(spreadMin + random() * (spreadMax - spreadMin));

  return {
    center,
    spread,
    minPrice,
    maxPrice,
    remainingDays,
    maxDeviationRatio
  };
}

export function computeBuyCollateralAmount(options: {
  maxAmount: number;
  marketLiquidity?: number;
  fleetBotCount: number;
  botRecentTradeCount: number;
  botRecentCollateral: number;
  random?: () => number;
}): number {
  const random = options.random ?? Math.random;
  const maxAmount = Math.max(options.maxAmount, 0.01);

  const baseAmount = maxAmount * (0.25 + random() * 0.6);

  const liquidity = Math.max(0, options.marketLiquidity ?? maxAmount * 25);
  const liquidityFactor = clamp(Math.log10(liquidity + 10) / 2.8, 0.45, 2.2);

  const fleetSize = Math.max(1, options.fleetBotCount);
  const fleetFactor = clamp(2 / Math.sqrt(fleetSize), 0.35, 1.5);

  const tradePenalty = Math.min(0.45, options.botRecentTradeCount * 0.08);
  const collateralPenalty = Math.min(0.35, options.botRecentCollateral / (maxAmount * 8));
  const botFactor = clamp(1 - tradePenalty - collateralPenalty, 0.35, 1.1);

  const rawAmount = baseAmount * liquidityFactor * fleetFactor * botFactor;
  const minAmount = Math.min(maxAmount, Math.max(0.01, maxAmount * 0.05));

  return roundToFixed(clamp(rawAmount, minAmount, maxAmount));
}

export type BuyCycleSource = "manual" | "scheduled";

export type BuyCycleAction = {
  botId: string;
  marketId: string;
  token: string;
  status:
    | "submitted"
    | "skipped_chance"
    | "skipped_missing_price"
    | "skipped_stale_price"
    | "failed_submit";
  collateralAmount?: number;
  center?: number;
  spread?: number;
  txId?: string;
  error?: string;
};

export type BuyCycleResult = {
  cycleId: string;
  source: BuyCycleSource;
  startedAt: string;
  finishedAt: string;
  busy: boolean;
  totalBots: number;
  totalMarkets: number;
  selectedMarkets: number;
  requestedTokenCount: number;
  missingTokenCount: number;
  staleTokenCount: number;
  submittedCount: number;
  skippedChanceCount: number;
  skippedMissingPriceCount: number;
  skippedStalePriceCount: number;
  failedSubmitCount: number;
  actions: BuyCycleAction[];
};

type PriceClientLike = {
  resolveMarketPrices(markets: Array<{ id: string; subject: string }>): Promise<MarketPriceResolution>;
};

type DekantTradingClient = Pick<DekantClient, "submitBuyOrder">;
export type BuyEnginePriceClient = PriceClientLike;
export type BuyEngineDekantTradingClient = DekantTradingClient;

type BuyMarket = Pick<DekantMarket, "id" | "subject" | "deadline" | "liquidity">;

type BotBuyState = {
  tradeCount: number;
  collateral: number;
};

export type BuyEngineIntervalProvider = {
  setInterval(handler: () => void, intervalMs: number): unknown;
  clearInterval(handle: unknown): void;
};

export type BuyEngineCycleErrorContext = {
  source: BuyCycleSource;
  stage: "immediate" | "interval";
};

const defaultIntervalProvider: BuyEngineIntervalProvider = {
  setInterval: (handler, intervalMs) => setInterval(handler, intervalMs),
  clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout)
};

export class BuyEngine {
  private readonly priceClient: PriceClientLike;
  private readonly dekantClient: DekantTradingClient;
  private readonly getBots: () => BotRecord[];
  private readonly getMarkets: () => BuyMarket[];
  private buyChance: number;
  private maxAmount: number;
  private readonly intervalMs: number;
  private readonly random: () => number;
  private readonly now: () => Date;
  private readonly timer: BuyEngineIntervalProvider;
  private readonly onCycleError?: (error: unknown, context: BuyEngineCycleErrorContext) => void | Promise<void>;

  private intervalHandle: unknown = null;
  private running = false;
  private lastCycleAt: string | null = null;
  private lastResult: BuyCycleResult | null = null;
  private readonly botState = new Map<string, BotBuyState>();

  constructor(options: {
    runtime: {
      buyChance: number;
      maxAmount: number;
      intervalMs: number;
    };
    clients: {
      price: PriceClientLike;
      dekant: DekantTradingClient;
    };
    getBots: () => BotRecord[];
    getMarkets: () => BuyMarket[];
    random?: () => number;
    now?: () => Date;
    timer?: BuyEngineIntervalProvider;
    onCycleError?: (error: unknown, context: BuyEngineCycleErrorContext) => void | Promise<void>;
  }) {
    this.buyChance = options.runtime.buyChance;
    this.maxAmount = options.runtime.maxAmount;
    this.intervalMs = options.runtime.intervalMs;
    this.priceClient = options.clients.price;
    this.dekantClient = options.clients.dekant;
    this.getBots = options.getBots;
    this.getMarkets = options.getMarkets;
    this.random = options.random ?? Math.random;
    this.now = options.now ?? (() => new Date());
    this.timer = options.timer ?? defaultIntervalProvider;
    this.onCycleError = options.onCycleError;
  }

  private notifyCycleError(error: unknown, context: BuyEngineCycleErrorContext): void {
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

    return "buy_submit_failed";
  }

  private decayBotState(): void {
    for (const [botId, state] of this.botState.entries()) {
      this.botState.set(botId, {
        tradeCount: Math.floor(state.tradeCount * 0.6),
        collateral: roundToFixed(state.collateral * 0.6)
      });
    }
  }

  updateRuntime(patch: { buyChance?: number; maxAmount?: number }): void {
    if (patch.buyChance !== undefined) this.buyChance = patch.buyChance;
    if (patch.maxAmount !== undefined) this.maxAmount = patch.maxAmount;
  }

  getSnapshot(): {
    isRunning: boolean;
    lastCycleAt: string | null;
    lastResult: BuyCycleResult | null;
  } {
    return {
      isRunning: this.intervalHandle !== null,
      lastCycleAt: this.lastCycleAt,
      lastResult: this.lastResult
    };
  }

  private emptyResult(options: {
    source: BuyCycleSource;
    startedAt: string;
    finishedAt: string;
    totalBots: number;
    totalMarkets: number;
    selectedMarkets: number;
    busy: boolean;
  }): BuyCycleResult {
    return {
      cycleId: randomUUID(),
      source: options.source,
      startedAt: options.startedAt,
      finishedAt: options.finishedAt,
      busy: options.busy,
      totalBots: options.totalBots,
      totalMarkets: options.totalMarkets,
      selectedMarkets: options.selectedMarkets,
      requestedTokenCount: 0,
      missingTokenCount: 0,
      staleTokenCount: 0,
      submittedCount: 0,
      skippedChanceCount: 0,
      skippedMissingPriceCount: 0,
      skippedStalePriceCount: 0,
      failedSubmitCount: 0,
      actions: []
    };
  }

  async runCycle(options: {
    source?: BuyCycleSource;
    marketIds?: string[];
  } = {}): Promise<BuyCycleResult> {
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
    this.decayBotState();

    try {
      const priceResolution = await this.priceClient.resolveMarketPrices(
        selectedMarkets.map((market) => ({
          id: market.id,
          subject: market.subject
        }))
      );

      const actions: BuyCycleAction[] = [];
      let submittedCount = 0;
      let skippedChanceCount = 0;
      let skippedMissingPriceCount = 0;
      let skippedStalePriceCount = 0;
      let failedSubmitCount = 0;
      const requestedTokenCount = new Set(selectedMarkets.map((market) => market.subject.trim().toUpperCase())).size;

      for (const bot of bots) {
        const previous = this.botState.get(bot.id) ?? {
          tradeCount: 0,
          collateral: 0
        };

        for (const market of selectedMarkets) {
          const marketPrice = priceResolution.byMarketId.get(market.id);
          const token = market.subject.trim().toUpperCase();

          if (!marketPrice || marketPrice.status === "missing") {
            skippedMissingPriceCount += 1;
            actions.push({
              botId: bot.id,
              marketId: market.id,
              token,
              status: "skipped_missing_price"
            });
            continue;
          }

          if (marketPrice.status === "stale") {
            skippedStalePriceCount += 1;
            actions.push({
              botId: bot.id,
              marketId: market.id,
              token,
              status: "skipped_stale_price"
            });
            continue;
          }

          if (!rollChance(this.buyChance, this.random)) {
            skippedChanceCount += 1;
            actions.push({
              botId: bot.id,
              marketId: market.id,
              token,
              status: "skipped_chance"
            });
            continue;
          }

          if (!marketPrice.quote) {
            skippedMissingPriceCount += 1;
            actions.push({
              botId: bot.id,
              marketId: market.id,
              token,
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

          const collateralAmount = computeBuyCollateralAmount({
            maxAmount: this.maxAmount,
            marketLiquidity: market.liquidity,
            fleetBotCount: bots.length,
            botRecentTradeCount: previous.tradeCount,
            botRecentCollateral: previous.collateral,
            random: this.random
          });

          try {
            const tx = await this.dekantClient.submitBuyOrder({
              botId: bot.id,
              marketId: market.id,
              collateralAmount,
              center: prediction.center,
              spread: prediction.spread
            });

            previous.tradeCount += 1;
            previous.collateral = roundToFixed(previous.collateral + collateralAmount);
            this.botState.set(bot.id, previous);

            submittedCount += 1;
            actions.push({
              botId: bot.id,
              marketId: market.id,
              token,
              status: "submitted",
              collateralAmount,
              center: prediction.center,
              spread: prediction.spread,
              txId: tx.txId
            });
          } catch (error) {
            failedSubmitCount += 1;
            actions.push({
              botId: bot.id,
              marketId: market.id,
              token,
              status: "failed_submit",
              collateralAmount,
              center: prediction.center,
              spread: prediction.spread,
              error: this.toErrorMessage(error)
            });
          }
        }
      }

      const result: BuyCycleResult = {
        cycleId: randomUUID(),
        source,
        startedAt,
        finishedAt: this.now().toISOString(),
        busy: false,
        totalBots: bots.length,
        totalMarkets: allMarkets.length,
        selectedMarkets: selectedMarkets.length,
        requestedTokenCount,
        missingTokenCount: priceResolution.missingTokens.length,
        staleTokenCount: priceResolution.staleTokens.length,
        submittedCount,
        skippedChanceCount,
        skippedMissingPriceCount,
        skippedStalePriceCount,
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
