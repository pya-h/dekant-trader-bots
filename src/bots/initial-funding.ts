import { BotRecord } from "../state/types.js";

export type TimerProvider = {
  setTimeout(handler: () => void, timeoutMs: number): unknown;
  clearTimeout(handle: unknown): void;
};

export type InitialFundingTrigger = (context: {
  createdBots: BotRecord[];
  delayMs: number;
}) => void | Promise<void>;

export type InitialFundingScheduleResult = {
  scheduled: boolean;
  delayMs: number | null;
  cancel: () => void;
};

const defaultTimerProvider: TimerProvider = {
  setTimeout: (handler, timeoutMs) => setTimeout(handler, timeoutMs),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout)
};

export function scheduleInitialFundingIfNeeded(options: {
  hadExistingBots: boolean;
  createdBots: BotRecord[];
  delayMs: number;
  trigger: InitialFundingTrigger;
  timer?: TimerProvider;
}): InitialFundingScheduleResult {
  if (options.hadExistingBots || options.createdBots.length === 0) {
    return {
      scheduled: false,
      delayMs: null,
      cancel: () => {}
    };
  }

  const timer = options.timer ?? defaultTimerProvider;
  const handle = timer.setTimeout(() => {
    void options.trigger({
      createdBots: options.createdBots,
      delayMs: options.delayMs
    });
  }, options.delayMs);

  return {
    scheduled: true,
    delayMs: options.delayMs,
    cancel: () => timer.clearTimeout(handle)
  };
}
