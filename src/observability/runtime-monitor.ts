import { classifyError, ClassifiedError } from "./errors.js";
import { EventLog, EventLogSnapshot } from "./event-log.js";

/** Optional bot/operation context attached to a recorded failure or warning. */
export type EventContext = {
  event?: string;
  botId?: string | null;
  marketId?: string | null;
};

export type MonitoredJob =
  | "buy_cycle"
  | "sell_cycle"
  | "market_refresh"
  | "manual_fund"
  | "initial_funding"
  | "add_bots";

export type JobCounters = {
  runs: number;
  successes: number;
  failures: number;
  actionFailures: number;
  lastStartedAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastErrorType: string | null;
  lastErrorMessage: string | null;
};

export type RuntimeMonitorSnapshot = {
  startedAt: string;
  uptimeMs: number;
  health: "ok" | "degraded";
  totals: {
    jobRuns: number;
    jobSuccesses: number;
    jobFailures: number;
    actionFailures: number;
    knownErrors: number;
    unknownErrors: number;
  };
  jobs: Record<MonitoredJob, JobCounters>;
};

const JOB_NAMES: MonitoredJob[] = [
  "buy_cycle",
  "sell_cycle",
  "market_refresh",
  "manual_fund",
  "initial_funding",
  "add_bots"
];

function makeEmptyCounters(): JobCounters {
  return {
    runs: 0,
    successes: 0,
    failures: 0,
    actionFailures: 0,
    lastStartedAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastErrorType: null,
    lastErrorMessage: null
  };
}

export class RuntimeMonitor {
  private readonly now: () => Date;
  private readonly startedAt: string;
  private readonly eventLog: EventLog;

  private readonly jobs = new Map<MonitoredJob, JobCounters>();
  private totals: RuntimeMonitorSnapshot["totals"] = {
    jobRuns: 0,
    jobSuccesses: 0,
    jobFailures: 0,
    actionFailures: 0,
    knownErrors: 0,
    unknownErrors: 0
  };

  constructor(options: { now?: () => Date; eventLogCapacity?: number } = {}) {
    this.now = options.now ?? (() => new Date());
    this.startedAt = this.now().toISOString();
    this.eventLog = new EventLog({ now: this.now, capacity: options.eventLogCapacity });

    for (const job of JOB_NAMES) {
      this.jobs.set(job, makeEmptyCounters());
    }
  }

  private getJob(job: MonitoredJob): JobCounters {
    const existing = this.jobs.get(job);
    if (existing) {
      return existing;
    }

    const created = makeEmptyCounters();
    this.jobs.set(job, created);
    return created;
  }

  private incrementErrorTotals(classified: ClassifiedError): void {
    if (classified.known) {
      this.totals.knownErrors += 1;
      return;
    }

    this.totals.unknownErrors += 1;
  }

  recordJobStart(job: MonitoredJob): void {
    const counters = this.getJob(job);
    counters.runs += 1;
    counters.lastStartedAt = this.now().toISOString();

    this.totals.jobRuns += 1;
  }

  recordJobSuccess(job: MonitoredJob): void {
    const counters = this.getJob(job);
    counters.successes += 1;
    counters.lastSuccessAt = this.now().toISOString();

    this.totals.jobSuccesses += 1;
  }

  recordJobFailure(job: MonitoredJob, error: unknown, context?: EventContext): ClassifiedError {
    const classified = classifyError(error);
    const counters = this.getJob(job);

    counters.failures += 1;
    counters.lastFailureAt = this.now().toISOString();
    counters.lastErrorType = classified.type;
    counters.lastErrorMessage = classified.message;

    this.totals.jobFailures += 1;
    this.incrementErrorTotals(classified);
    this.appendEvent("error", job, classified, context);

    return classified;
  }

  recordActionFailure(job: MonitoredJob, error: unknown, context?: EventContext): ClassifiedError {
    const classified = classifyError(error);
    const counters = this.getJob(job);

    counters.actionFailures += 1;
    counters.lastFailureAt = this.now().toISOString();
    counters.lastErrorType = classified.type;
    counters.lastErrorMessage = classified.message;

    this.totals.actionFailures += 1;
    this.incrementErrorTotals(classified);
    this.appendEvent("error", job, classified, context);

    return classified;
  }

  /**
   * Record a warning into the event log. Warnings don't touch the job counters or
   * health (they are not failures), they only add to the per-bot/per-operation trail
   * the panel surfaces.
   */
  recordWarning(input: {
    event: string;
    message: string;
    job?: MonitoredJob | null;
    botId?: string | null;
    marketId?: string | null;
    errorType?: string | null;
  }): void {
    this.eventLog.record({
      severity: "warn",
      event: input.event,
      job: input.job ?? null,
      botId: input.botId ?? null,
      marketId: input.marketId ?? null,
      errorType: input.errorType ?? null,
      message: input.message
    });
  }

  private appendEvent(
    severity: "error" | "warn",
    job: MonitoredJob,
    classified: ClassifiedError,
    context?: EventContext
  ): void {
    this.eventLog.record({
      severity,
      event: context?.event ?? job,
      job,
      botId: context?.botId ?? null,
      marketId: context?.marketId ?? null,
      errorType: classified.type,
      message: classified.message
    });
  }

  getEventLog(limit?: number): EventLogSnapshot {
    return this.eventLog.getSnapshot(limit);
  }

  getSnapshot(): RuntimeMonitorSnapshot {
    const now = this.now();
    const startedAtMs = Date.parse(this.startedAt);
    const uptimeMs = Number.isFinite(startedAtMs) ? Math.max(0, now.getTime() - startedAtMs) : 0;

    const jobs = JOB_NAMES.reduce((acc, job) => {
      acc[job] = { ...this.getJob(job) };
      return acc;
    }, {} as RuntimeMonitorSnapshot["jobs"]);

    return {
      startedAt: this.startedAt,
      uptimeMs,
      health: this.totals.jobFailures > 0 || this.totals.actionFailures > 0 ? "degraded" : "ok",
      totals: {
        ...this.totals
      },
      jobs
    };
  }
}
