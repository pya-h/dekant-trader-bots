import { describe, it, expect } from "vitest";
import anchorPkg from "@coral-xyz/anchor";
import { resolveSigma } from "../../src/solana/transactions.js";

const { BN } = anchorPkg;

// On-chain ranges are i64 scaled by 1e9 (human value × 1_000_000_000).
const rangeMin = new BN("80000000000"); // 80
const rangeMax = new BN("120000000000"); // 120 → span = 40 (scaled 40e9)
const numOutcomes = 10;

// Bin-coverage floor = ceil(span / (2 · n · Z_CUTOFF))
//   = ceil(40e9 / (2 · 10 · 5)) = 40e9 / 100 = 400_000_000 (= 0.4 human).
const minSigma = "400000000";

describe("resolveSigma", () => {
  it("passes a comfortably large spread through unchanged", () => {
    const r = resolveSigma(5, rangeMin, rangeMax, numOutcomes);
    expect(r.floored).toBe(false);
    expect(r.sigma.toString()).toBe("5000000000");
    expect(r.requested.toString()).toBe("5000000000");
  });

  it("floors a spread too small to cover any bin", () => {
    // 0.01 human → 10_000_000 scaled, below the 400_000_000 floor. Left as-is
    // this produces all-zero weights on-chain → DivisionByZero(6032).
    const r = resolveSigma(0.01, rangeMin, rangeMax, numOutcomes);
    expect(r.floored).toBe(true);
    expect(r.sigma.toString()).toBe(minSigma);
    // requested preserves the original spot-derived value for observability.
    expect(r.requested.toString()).toBe("10000000");
  });

  it("leaves a spread exactly at the floor unchanged", () => {
    const r = resolveSigma(0.4, rangeMin, rangeMax, numOutcomes);
    expect(r.floored).toBe(false);
    expect(r.sigma.toString()).toBe(minSigma);
  });

  it("scales the floor with bin count (more bins → larger min sigma)", () => {
    // 100 bins → ceil(40e9 / (2·100·5)) = 40e9 / 1000 = 40_000_000.
    const r = resolveSigma(0.01, rangeMin, rangeMax, 100);
    expect(r.floored).toBe(true);
    expect(r.sigma.toString()).toBe("40000000");
  });

  it("does not floor when the range is degenerate", () => {
    const r = resolveSigma(0.01, rangeMin, rangeMin, numOutcomes);
    expect(r.floored).toBe(false);
    expect(r.sigma.toString()).toBe("10000000");
  });

  it("rejects a non-positive spread", () => {
    expect(() => resolveSigma(0, rangeMin, rangeMax, numOutcomes)).toThrow(
      /sigma_must_be_positive/
    );
  });
});
