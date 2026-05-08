import { describe, expect, it } from "vitest";
import { TradeStatsStore } from "../../src/metrics/trade-stats.js";
import { BuyCycleResult } from "../../src/trading/buy-engine.js";
import { SellCycleResult } from "../../src/trading/sell-engine.js";
import { BotRecord } from "../../src/state/types.js";

function makeBot(id: string): BotRecord {
  return {
    id,
    publicKey: `wallet-${id}`,
    secretKey: `secret-${id}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    lastActiveAt: null
  };
}

describe("TradeStatsStore", () => {
  it("aggregates per-bot and global totals across buy/sell cycles", () => {
    const store = new TradeStatsStore({
      now: () => new Date("2026-05-07T00:00:00.000Z")
    });

    const buyCycle: BuyCycleResult = {
      cycleId: "buy-1",
      source: "manual",
      startedAt: "2026-05-06T00:00:00.000Z",
      finishedAt: "2026-05-06T00:01:00.000Z",
      busy: false,
      totalBots: 2,
      totalMarkets: 1,
      selectedMarkets: 1,
      requestedTokenCount: 1,
      missingTokenCount: 0,
      staleTokenCount: 0,
      submittedCount: 2,
      skippedChanceCount: 0,
      skippedMissingPriceCount: 0,
      skippedStalePriceCount: 0,
      failedSubmitCount: 1,
      actions: [
        {
          botId: "a",
          marketId: "m1",
          token: "BTC",
          status: "submitted",
          collateralAmount: 10,
          center: 100,
          spread: 1,
          txId: "tx1"
        },
        {
          botId: "a",
          marketId: "m1",
          token: "BTC",
          status: "submitted",
          collateralAmount: 5,
          center: 100,
          spread: 1,
          txId: "tx2"
        },
        {
          botId: "b",
          marketId: "m1",
          token: "BTC",
          status: "failed_submit",
          collateralAmount: 7,
          center: 100,
          spread: 1,
          error: "tx_fail"
        }
      ]
    };

    const sellCycle: SellCycleResult = {
      cycleId: "sell-1",
      source: "manual",
      startedAt: "2026-05-06T01:00:00.000Z",
      finishedAt: "2026-05-06T01:02:00.000Z",
      busy: false,
      totalBots: 2,
      totalMarkets: 1,
      selectedMarkets: 1,
      botsWithPositions: 2,
      botsWithoutPositions: 0,
      positionsConsidered: 2,
      requestedTokenCount: 1,
      missingTokenCount: 0,
      staleTokenCount: 0,
      soldFullCount: 2,
      skippedInRangeCount: 0,
      skippedChanceCount: 0,
      skippedMissingPriceCount: 0,
      skippedStalePriceCount: 0,
      skippedNoReferenceCount: 0,
      skippedInvalidAmountCount: 0,
      failedSubmitCount: 1,
      actions: [
        {
          botId: "a",
          marketId: "m1",
          token: "BTC",
          positionId: "p1",
          status: "sold_full",
          requestedSellAmount: 2,
          txId: "tx3"
        },
        {
          botId: "b",
          marketId: "m1",
          token: "BTC",
          positionId: "p2",
          status: "sold_full",
          requestedSellAmount: 3,
          txId: "tx4"
        },
        {
          botId: "b",
          marketId: "m1",
          token: "BTC",
          positionId: "p3",
          status: "failed_submit",
          requestedSellAmount: 1,
          error: "tx_fail"
        }
      ]
    };

    store.ingestBuyCycle(buyCycle);
    store.ingestSellCycle(sellCycle);

    const bots = [makeBot("a"), makeBot("b"), makeBot("c")];
    const summary = store.getSummary({ page: 1, pageSize: 10, bots });

    expect(summary.global.buyTrades).toBe(2);
    expect(summary.global.sellTrades).toBe(2);
    expect(summary.global.totalTrades).toBe(4);
    expect(summary.global.buyVolume).toBe(15);
    expect(summary.global.sellVolume).toBe(5);
    expect(summary.global.totalVolume).toBe(20);
    expect(summary.global.failedBuyActions).toBe(1);
    expect(summary.global.failedSellActions).toBe(1);

    const botA = summary.items.find((item) => item.botId === "a");
    expect(botA?.totalTrades).toBe(3);
    expect(botA?.totalVolume).toBe(17);

    const botB = summary.items.find((item) => item.botId === "b");
    expect(botB?.totalTrades).toBe(1);
    expect(botB?.failedBuyActions).toBe(1);
    expect(botB?.failedSellActions).toBe(1);

    const botC = summary.items.find((item) => item.botId === "c");
    expect(botC?.totalTrades).toBe(0);
    expect(botC?.totalVolume).toBe(0);
  });
});
