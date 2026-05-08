import { describe, expect, it } from "vitest";
import { selectTargetBots } from "../../src/funding/engine.js";
import { filterEligibleMarkets } from "../../src/markets/cache.js";
import { estimateMaxDeviationRatio, rollChance } from "../../src/trading/buy-engine.js";

describe("core regression guards", () => {
  it("keeps market eligibility filtering stable", () => {
    const result = filterEligibleMarkets({
      markets: [
        { id: "m1", subject: "BTC",
      collateralMint: "Mint11111111111111111111111111111111111111", category: "crypto", state: 0 },
        { id: "m2", subject: "ETH",
      collateralMint: "Mint11111111111111111111111111111111111111", category: "sports", state: 0 },
        { id: "m3", subject: "SOL",
      collateralMint: "Mint11111111111111111111111111111111111111", category: "crypto", state: 3 },
        { id: "m4", subject: "AVAX",
      collateralMint: "Mint11111111111111111111111111111111111111", category: "crypto", state: 0 }
      ],
      ignoredMarketIds: new Set(["m4"])
    });

    expect(result.map((market) => market.id)).toEqual(["m1"]);
  });

  it("keeps bot selector union semantics stable", () => {
    const bots = [
      { id: "b1", publicKey: "a1", secretKey: "s1", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "b2", publicKey: "a2", secretKey: "s2", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "b3", publicKey: "a3", secretKey: "s3", createdAt: "2026-01-01T00:00:00.000Z" }
    ];

    const selected = selectTargetBots(bots, {
      botIds: ["b1"],
      addresses: ["a3"]
    });

    expect(selected.map((bot) => bot.id).sort()).toEqual(["b1", "b3"]);
  });

  it("keeps chance/deviation bounds stable", () => {
    expect(rollChance(0, () => 0)).toBe(false);
    expect(rollChance(100, () => 0.9999)).toBe(true);

    expect(estimateMaxDeviationRatio(0)).toBeGreaterThanOrEqual(0.01);
    expect(estimateMaxDeviationRatio(10_000)).toBeLessThanOrEqual(0.3);
  });
});
