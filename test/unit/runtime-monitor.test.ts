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
});
