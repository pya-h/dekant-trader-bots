import { describe, it, expect } from "vitest";
import anchorPkg from "@coral-xyz/anchor";
import { clampMu } from "../../src/solana/transactions.js";

const { BN } = anchorPkg;

// On-chain ranges are i64 scaled by 1e9 (human value × 1_000_000_000).
const rangeMin = new BN("80000000000"); // 80
const rangeMax = new BN("120000000000"); // 120

describe("clampMu", () => {
  it("passes an in-range center through unchanged", () => {
    const r = clampMu(100, rangeMin, rangeMax);
    expect(r.clamped).toBe(false);
    expect(r.mu.toString()).toBe("100000000000");
    expect(r.requested.toString()).toBe("100000000000");
  });

  it("clamps a below-range center up to rangeMin", () => {
    const r = clampMu(70, rangeMin, rangeMax);
    expect(r.clamped).toBe(true);
    expect(r.mu.toString()).toBe(rangeMin.toString());
    // requested preserves the original spot-derived value for observability.
    expect(r.requested.toString()).toBe("70000000000");
  });

  it("clamps an above-range center down to rangeMax", () => {
    // e.g. BTC spot ~66000 against a market configured as [0, 100] — a units
    // mismatch that previously failed every buy with mu_outside_market_range.
    const r = clampMu(66000, rangeMin, rangeMax);
    expect(r.clamped).toBe(true);
    expect(r.mu.toString()).toBe(rangeMax.toString());
    expect(r.requested.toString()).toBe("66000000000000");
  });

  it("treats the exact bounds as in-range (inclusive)", () => {
    expect(clampMu(80, rangeMin, rangeMax).clamped).toBe(false);
    expect(clampMu(120, rangeMin, rangeMax).clamped).toBe(false);
  });

  it("rejects a non-finite center", () => {
    expect(() => clampMu(Number.NaN, rangeMin, rangeMax)).toThrow(/mu_not_finite/);
  });
});
