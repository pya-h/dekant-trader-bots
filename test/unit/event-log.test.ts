import { describe, expect, it } from "vitest";
import { EventLog } from "../../src/observability/event-log.js";

const fixedNow = () => new Date("2026-05-07T00:00:00.000Z");

describe("EventLog", () => {
  it("records events newest-first with monotonic ids", () => {
    const log = new EventLog({ now: fixedNow });

    log.record({ severity: "error", event: "buy_action_failed", job: "buy_cycle", botId: "bot-1", message: "boom" });
    log.record({ severity: "warn", event: "claim_payout_failed", job: "market_refresh", botId: "bot-2", marketId: "14", message: "retry" });

    const snapshot = log.getSnapshot();
    expect(snapshot.total).toBe(2);
    expect(snapshot.dropped).toBe(0);
    expect(snapshot.entries).toHaveLength(2);
    // Newest first.
    expect(snapshot.entries[0].event).toBe("claim_payout_failed");
    expect(snapshot.entries[0].botId).toBe("bot-2");
    expect(snapshot.entries[0].marketId).toBe("14");
    expect(snapshot.entries[1].event).toBe("buy_action_failed");
    // Monotonic ids in record order.
    expect(snapshot.entries[1].id).toBe(1);
    expect(snapshot.entries[0].id).toBe(2);
  });

  it("evicts oldest entries past capacity and counts drops", () => {
    const log = new EventLog({ now: fixedNow, capacity: 3 });

    for (let i = 1; i <= 5; i += 1) {
      log.record({ severity: "error", event: `e${i}`, message: `m${i}` });
    }

    const snapshot = log.getSnapshot();
    expect(snapshot.capacity).toBe(3);
    expect(snapshot.total).toBe(5);
    expect(snapshot.dropped).toBe(2);
    expect(snapshot.entries.map((e) => e.event)).toEqual(["e5", "e4", "e3"]);
  });

  it("honors the limit argument", () => {
    const log = new EventLog({ now: fixedNow });
    for (let i = 1; i <= 4; i += 1) {
      log.record({ severity: "warn", event: `e${i}`, message: `m${i}` });
    }

    const snapshot = log.getSnapshot(2);
    expect(snapshot.entries.map((e) => e.event)).toEqual(["e4", "e3"]);
    // Totals still reflect the full history, not the limited view.
    expect(snapshot.total).toBe(4);
  });

  it("defaults optional fields to null", () => {
    const log = new EventLog({ now: fixedNow });
    log.record({ severity: "error", event: "x", message: "y" });
    const [entry] = log.getSnapshot().entries;
    expect(entry.job).toBeNull();
    expect(entry.botId).toBeNull();
    expect(entry.marketId).toBeNull();
    expect(entry.errorType).toBeNull();
  });
});
