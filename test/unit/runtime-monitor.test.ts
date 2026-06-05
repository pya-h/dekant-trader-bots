import { describe, expect, it } from "vitest";
import { RuntimeMonitor } from "../../src/observability/runtime-monitor.js";

describe("RuntimeMonitor", () => {
  it("tracks job runs and failure totals", () => {
    const now = new Date("2026-05-07T00:00:00.000Z");
    const monitor = new RuntimeMonitor({ now: () => now });

    monitor.recordJobStart("buy_cycle");
    monitor.recordJobFailure("buy_cycle", new TypeError("network"));
    monitor.recordActionFailure("sell_cycle", new Error("unknown_boom"));

    const snapshot = monitor.getSnapshot();

    expect(snapshot.health).toBe("degraded");
    expect(snapshot.totals.jobRuns).toBe(1);
    expect(snapshot.totals.jobFailures).toBe(1);
    expect(snapshot.totals.actionFailures).toBe(1);
    expect(snapshot.totals.knownErrors).toBe(1);
    expect(snapshot.totals.unknownErrors).toBe(1);
    expect(snapshot.jobs.buy_cycle.failures).toBe(1);
    expect(snapshot.jobs.sell_cycle.actionFailures).toBe(1);
  });

  it("captures failures and warnings in the event log with bot/market context", () => {
    const now = new Date("2026-05-07T00:00:00.000Z");
    const monitor = new RuntimeMonitor({ now: () => now });

    monitor.recordActionFailure("buy_cycle", new TypeError("network"), {
      event: "buy_action_failed",
      botId: "bot-1",
      marketId: "14"
    });
    monitor.recordWarning({
      event: "claim_payout_failed",
      job: "market_refresh",
      botId: "bot-2",
      marketId: "9",
      message: "claim retry"
    });

    const events = monitor.getEventLog();
    expect(events.total).toBe(2);
    // Newest first: the warning was recorded last.
    expect(events.entries[0]).toMatchObject({
      severity: "warn",
      event: "claim_payout_failed",
      job: "market_refresh",
      botId: "bot-2",
      marketId: "9",
      message: "claim retry"
    });
    expect(events.entries[1]).toMatchObject({
      severity: "error",
      event: "buy_action_failed",
      job: "buy_cycle",
      botId: "bot-1",
      marketId: "14",
      errorType: "network"
    });

    // Warnings must not affect job counters or health.
    const snapshot = monitor.getSnapshot();
    expect(snapshot.totals.jobFailures).toBe(0);
    expect(snapshot.totals.actionFailures).toBe(1);
  });
});
