import { describe, expect, it } from "vitest";
import {
  buildPredictionRange,
  computeBuyCollateralAmount,
  rollChance
} from "../../src/trading/buy-engine.js";

describe("rollChance", () => {
  it("handles 0..100 threshold boundaries correctly", () => {
    expect(rollChance(0, () => 0)).toBe(false);
    expect(rollChance(100, () => 0.999999)).toBe(true);

    expect(rollChance(50, () => 0.4999)).toBe(true);
    expect(rollChance(50, () => 0.5)).toBe(false);

    expect(rollChance(-20, () => 0)).toBe(false);
    expect(rollChance(150, () => 0.999)).toBe(true);
  });
});

describe("buildPredictionRange", () => {
  it("widens projected range when deadline is farther away", () => {
    const now = new Date("2026-05-07T00:00:00.000Z");

    const near = buildPredictionRange({
      referencePrice: 100,
      deadline: "2026-05-08T00:00:00.000Z",
      now,
      random: () => 0.5
    });

    const far = buildPredictionRange({
      referencePrice: 100,
      deadline: "2026-07-06T00:00:00.000Z",
      now,
      random: () => 0.5
    });

    expect(far.maxDeviationRatio).toBeGreaterThan(near.maxDeviationRatio);
    expect(far.maxPrice - far.minPrice).toBeGreaterThan(near.maxPrice - near.minPrice);
    expect(far.spread).toBeGreaterThan(near.spread);
  });
});

describe("computeBuyCollateralAmount", () => {
  it("uses market/fleet/bot factors and respects max cap", () => {
    const aggressive = computeBuyCollateralAmount({
      maxAmount: 100,
      marketLiquidity: 80_000,
      fleetBotCount: 1,
      botRecentTradeCount: 0,
      botRecentCollateral: 0,
      random: () => 1
    });

    const conservative = computeBuyCollateralAmount({
      maxAmount: 100,
      marketLiquidity: 2_000,
      fleetBotCount: 24,
      botRecentTradeCount: 5,
      botRecentCollateral: 500,
      random: () => 0
    });

    expect(aggressive).toBeLessThanOrEqual(100);
    expect(aggressive).toBeGreaterThan(conservative);
    expect(conservative).toBeGreaterThan(0);
  });
});
