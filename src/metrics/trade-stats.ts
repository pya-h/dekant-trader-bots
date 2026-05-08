import { BuyCycleResult } from "../trading/buy-engine.js";
import { SellCycleResult } from "../trading/sell-engine.js";
import { BotRecord } from "../state/types.js";

function roundToFixed(value: number): number {
  return Number(value.toFixed(6));
}

type BotStatsRecord = {
  botId: string;
  buyTrades: number;
  sellTrades: number;
  buyVolume: number;
  sellVolume: number;
  failedBuyActions: number;
  failedSellActions: number;
  lastTradeAt: string | null;
};

export type TradeStatsSummary = {
  generatedAt: string;
  page: number;
  pageSize: number;
  totalBots: number;
  totalPages: number;
  global: {
    buyTrades: number;
    sellTrades: number;
    totalTrades: number;
    buyVolume: number;
    sellVolume: number;
    totalVolume: number;
    failedBuyActions: number;
    failedSellActions: number;
    lastTradeAt: string | null;
  };
  items: Array<
    BotStatsRecord & {
      address: string | null;
      totalTrades: number;
      totalVolume: number;
    }
  >;
};

function makeEmptyBotStats(botId: string): BotStatsRecord {
  return {
    botId,
    buyTrades: 0,
    sellTrades: 0,
    buyVolume: 0,
    sellVolume: 0,
    failedBuyActions: 0,
    failedSellActions: 0,
    lastTradeAt: null
  };
}

function makeEmptyBotSummary(bot: BotRecord): TradeStatsSummary["items"][number] {
  return {
    ...makeEmptyBotStats(bot.id),
    address: bot.publicKey,
    totalTrades: 0,
    totalVolume: 0
  };
}

export class TradeStatsStore {
  private readonly byBotId = new Map<string, BotStatsRecord>();
  private readonly now: () => Date;

  constructor(options: { now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date());
  }

  private getOrCreate(botId: string): BotStatsRecord {
    const existing = this.byBotId.get(botId);
    if (existing) {
      return existing;
    }

    const created = makeEmptyBotStats(botId);
    this.byBotId.set(botId, created);
    return created;
  }

  ingestBuyCycle(cycle: BuyCycleResult): void {
    for (const action of cycle.actions) {
      const row = this.getOrCreate(action.botId);

      if (action.status === "submitted") {
        const amount = action.collateralAmount ?? 0;
        row.buyTrades += 1;
        row.buyVolume = roundToFixed(row.buyVolume + amount);
        row.lastTradeAt = cycle.finishedAt;
      }

      if (action.status === "failed_submit") {
        row.failedBuyActions += 1;
      }
    }
  }

  ingestSellCycle(cycle: SellCycleResult): void {
    for (const action of cycle.actions) {
      const row = this.getOrCreate(action.botId);

      if (action.status === "sold_full") {
        const amount = action.requestedSellAmount ?? 0;
        row.sellTrades += 1;
        row.sellVolume = roundToFixed(row.sellVolume + amount);
        row.lastTradeAt = cycle.finishedAt;
      }

      if (action.status === "failed_submit") {
        row.failedSellActions += 1;
      }
    }
  }

  getSummary(input: {
    page: number;
    pageSize: number;
    bots: BotRecord[];
  }): TradeStatsSummary {
    const allRows = input.bots.map((bot) => {
      const base = this.byBotId.get(bot.id);
      if (!base) {
        return makeEmptyBotSummary(bot);
      }

      const totalTrades = base.buyTrades + base.sellTrades;
      const totalVolume = roundToFixed(base.buyVolume + base.sellVolume);

      return {
        ...base,
        address: bot.publicKey,
        totalTrades,
        totalVolume
      };
    });

    const totalBots = allRows.length;
    const totalPages = Math.max(1, Math.ceil(totalBots / input.pageSize));
    const offset = (input.page - 1) * input.pageSize;
    const items = allRows.slice(offset, offset + input.pageSize);

    let buyTrades = 0;
    let sellTrades = 0;
    let buyVolume = 0;
    let sellVolume = 0;
    let failedBuyActions = 0;
    let failedSellActions = 0;
    let lastTradeAt: string | null = null;

    for (const row of allRows) {
      buyTrades += row.buyTrades;
      sellTrades += row.sellTrades;
      buyVolume = roundToFixed(buyVolume + row.buyVolume);
      sellVolume = roundToFixed(sellVolume + row.sellVolume);
      failedBuyActions += row.failedBuyActions;
      failedSellActions += row.failedSellActions;

      if (row.lastTradeAt && (!lastTradeAt || row.lastTradeAt > lastTradeAt)) {
        lastTradeAt = row.lastTradeAt;
      }
    }

    return {
      generatedAt: this.now().toISOString(),
      page: input.page,
      pageSize: input.pageSize,
      totalBots,
      totalPages,
      global: {
        buyTrades,
        sellTrades,
        totalTrades: buyTrades + sellTrades,
        buyVolume,
        sellVolume,
        totalVolume: roundToFixed(buyVolume + sellVolume),
        failedBuyActions,
        failedSellActions,
        lastTradeAt
      },
      items
    };
  }
}
