/**
 * EventLog — a small, bounded in-memory ring buffer of recent error/warn events,
 * tagged with the bot, operation (job) and market they relate to, plus a timestamp.
 *
 * It is purely additive observability: every entry it holds is already produced at
 * a failure/warn site that also writes to the structured logger, so capturing it
 * here adds no new RPC, no DB write and no hot-path cost — just an array push at a
 * capped size. The buffer is fixed-capacity (oldest entries are evicted), so a
 * long-running process cannot leak memory through it. Nothing is persisted; like
 * the runtime counters, it resets on restart.
 */

export type EventSeverity = "error" | "warn";

export type LoggedEvent = {
  /** Monotonic id — stable across a single process lifetime, useful as a key. */
  id: number;
  timestamp: string;
  severity: EventSeverity;
  /** Structured-log event name, e.g. "buy_action_failed". */
  event: string;
  /** Owning job/operation, or null for events not tied to a monitored job. */
  job: string | null;
  botId: string | null;
  marketId: string | null;
  /** Classified error type (validation, network, ...) when known. */
  errorType: string | null;
  message: string;
};

export type EventLogSnapshot = {
  capacity: number;
  /** Total events ever recorded this process (>= entries.length). */
  total: number;
  /** How many events have been evicted by the ring buffer. */
  dropped: number;
  /** Newest first. */
  entries: LoggedEvent[];
};

export type EventLogInput = {
  severity: EventSeverity;
  event: string;
  job?: string | null;
  botId?: string | null;
  marketId?: string | null;
  errorType?: string | null;
  message: string;
};

const DEFAULT_CAPACITY = 300;

export class EventLog {
  private readonly capacity: number;
  private readonly now: () => Date;
  private readonly buffer: LoggedEvent[] = [];
  private seq = 0;
  private dropped = 0;

  constructor(options: { capacity?: number; now?: () => Date } = {}) {
    this.capacity = Math.max(1, Math.floor(options.capacity ?? DEFAULT_CAPACITY));
    this.now = options.now ?? (() => new Date());
  }

  record(input: EventLogInput): void {
    this.seq += 1;
    this.buffer.push({
      id: this.seq,
      timestamp: this.now().toISOString(),
      severity: input.severity,
      event: input.event,
      job: input.job ?? null,
      botId: input.botId ?? null,
      marketId: input.marketId ?? null,
      errorType: input.errorType ?? null,
      message: input.message
    });

    // Evict from the front to stay within capacity — O(n) but n is small and this
    // runs only on failures/warns, never on the trading hot path.
    while (this.buffer.length > this.capacity) {
      this.buffer.shift();
      this.dropped += 1;
    }
  }

  getSnapshot(limit?: number): EventLogSnapshot {
    const newestFirst = [...this.buffer].reverse();
    const entries =
      typeof limit === "number" ? newestFirst.slice(0, Math.max(0, Math.floor(limit))) : newestFirst;

    return {
      capacity: this.capacity,
      total: this.seq,
      dropped: this.dropped,
      entries
    };
  }
}
