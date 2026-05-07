import { describe, expect, it } from "vitest";
import {
  decideSellMode,
  isPositionFarFromPredictedRange,
  pickPartialSellAmount,
  resolvePositionReferencePrice
} from "../../src/trading/sell-engine.js";

describe("isPositionFarFromPredictedRange", () => {
  it("classifies far and in-range positions correctly", () => {
    expect(
      isPositionFarFromPredictedRange({
        referencePrice: 120,
        predictedMin: 95,
        predictedMax: 105,
        toleranceRatio: 0
      })
    ).toBe(true);

    expect(
      isPositionFarFromPredictedRange({
        referencePrice: 100,
        predictedMin: 95,
        predictedMax: 105,
        toleranceRatio: 0
      })
    ).toBe(false);

    expect(
      isPositionFarFromPredictedRange({
        referencePrice: 92,
        predictedMin: 95,
        predictedMax: 105,
        toleranceRatio: 0.1
      })
    ).toBe(false);
  });
});

describe("decideSellMode", () => {
  it("biases toward partial but still allows full exits", () => {
    expect(decideSellMode({ random: () => 0.79, partialBiasPercent: 80 })).toBe("partial");
    expect(decideSellMode({ random: () => 0.8, partialBiasPercent: 80 })).toBe("full");

    expect(decideSellMode({ random: () => 0.5, partialBiasPercent: 100 })).toBe("partial");
    expect(decideSellMode({ random: () => 0.0, partialBiasPercent: 0 })).toBe("full");
  });
});

describe("pickPartialSellAmount", () => {
  it("returns bounded random partial amounts", () => {
    const low = pickPartialSellAmount(100, () => 0);
    const high = pickPartialSellAmount(100, () => 1);

    expect(low).toBeGreaterThan(0);
    expect(high).toBeLessThan(100);
    expect(high).toBeGreaterThan(low);

    expect(pickPartialSellAmount(0, () => 0.5)).toBe(0);
  });
});

describe("resolvePositionReferencePrice", () => {
  it("uses center, then entryPrice, then price as fallback", () => {
    expect(
      resolvePositionReferencePrice({
        id: "p1",
        marketId: "m1",
        token: "BTC",
        amount: 10,
        center: 101,
        entryPrice: 95,
        price: 99
      })
    ).toBe(101);

    expect(
      resolvePositionReferencePrice({
        id: "p2",
        marketId: "m1",
        token: "BTC",
        amount: 10,
        entryPrice: 95,
        price: 99
      })
    ).toBe(95);

    expect(
      resolvePositionReferencePrice({
        id: "p3",
        marketId: "m1",
        token: "BTC",
        amount: 10,
        price: 99
      })
    ).toBe(99);

    expect(
      resolvePositionReferencePrice({
        id: "p4",
        marketId: "m1",
        token: "BTC",
        amount: 10
      })
    ).toBeNull();
  });
});
