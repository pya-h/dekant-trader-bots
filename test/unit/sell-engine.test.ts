import { describe, expect, it } from "vitest";
import {
  isPositionFarFromPredictedRange,
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

describe("resolvePositionReferencePrice", () => {
  it("returns center when set, null otherwise", () => {
    expect(
      resolvePositionReferencePrice({
        id: "p1",
        marketId: "m1",
        token: "BTC",
        amount: 10,
        center: 101
      })
    ).toBe(101);

    expect(
      resolvePositionReferencePrice({
        id: "p2",
        marketId: "m1",
        token: "BTC",
        amount: 10
      })
    ).toBeNull();
  });
});
