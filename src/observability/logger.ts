export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

function formatLogEntry(
  level: LogLevel,
  event: string,
  fields: Record<string, unknown>,
  now: () => Date
): string {
  return JSON.stringify({
    timestamp: now().toISOString(),
    level,
    event,
    ...fields
  });
}

export function createLogger(options: {
  now?: () => Date;
  minLevel?: LogLevel;
} = {}): Logger {
  const now = options.now ?? (() => new Date());
  const minLevel = options.minLevel ?? "debug";

  const levels: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
  };

  const threshold = levels[minLevel];

  return {
    debug(event, fields = {}) {
      if (levels.debug >= threshold) {
        console.log(formatLogEntry("debug", event, fields, now));
      }
    },
    info(event, fields = {}) {
      if (levels.info >= threshold) {
        console.log(formatLogEntry("info", event, fields, now));
      }
    },
    warn(event, fields = {}) {
      if (levels.warn >= threshold) {
        console.warn(formatLogEntry("warn", event, fields, now));
      }
    },
    error(event, fields = {}) {
      if (levels.error >= threshold) {
        console.error(formatLogEntry("error", event, fields, now));
      }
    }
  };
}
