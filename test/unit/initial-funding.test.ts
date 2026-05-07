import { describe, expect, it, vi } from "vitest";
import { scheduleInitialFundingIfNeeded } from "../../src/bots/initial-funding.js";
import { BotRecord } from "../../src/state/types.js";

function bot(id: string): BotRecord {
  return {
    id,
    publicKey: `pub-${id}`,
    secretKey: `sec-${id}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    lastActiveAt: null
  };
}

describe("scheduleInitialFundingIfNeeded", () => {
  it("schedules delayed trigger on first startup with created bots", async () => {
    let capturedHandler: (() => void) | null = null;
    let capturedDelay = -1;
    const trigger = vi.fn(async () => {});

    const result = scheduleInitialFundingIfNeeded({
      hadExistingBots: false,
      createdBots: [bot("b1"), bot("b2")],
      delayMs: 4500,
      trigger,
      timer: {
        setTimeout: (handler, timeoutMs) => {
          capturedHandler = handler;
          capturedDelay = timeoutMs;
          return "handle";
        },
        clearTimeout: () => {}
      }
    });

    expect(result.scheduled).toBe(true);
    expect(result.delayMs).toBe(4500);
    expect(capturedDelay).toBe(4500);

    expect(capturedHandler).toBeTypeOf("function");
    (capturedHandler as unknown as () => void)();
    expect(trigger).toHaveBeenCalledTimes(1);
  });

  it("does not schedule when startup already has existing bots", () => {
    const trigger = vi.fn();

    const result = scheduleInitialFundingIfNeeded({
      hadExistingBots: true,
      createdBots: [bot("b1")],
      delayMs: 1000,
      trigger
    });

    expect(result.scheduled).toBe(false);
    expect(result.delayMs).toBeNull();
    expect(trigger).not.toHaveBeenCalled();
  });

  it("does not schedule when no bots were created", () => {
    const trigger = vi.fn();

    const result = scheduleInitialFundingIfNeeded({
      hadExistingBots: false,
      createdBots: [],
      delayMs: 1000,
      trigger
    });

    expect(result.scheduled).toBe(false);
    expect(trigger).not.toHaveBeenCalled();
  });
});
