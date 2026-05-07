export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export type StructuredLogger = {
  debug?: (event: string, fields?: Record<string, unknown>) => void;
  info?: (event: string, fields?: Record<string, unknown>) => void;
  warn?: (event: string, fields?: Record<string, unknown>) => void;
  error: (event: string, fields?: Record<string, unknown>) => void;
};

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100
};

export function parseLogLevel(value: string | undefined, fallback: LogLevel = "info"): LogLevel {
  if (!value) {
    return fallback;
  }
  const lower = value.trim().toLowerCase();
  if (lower in LEVEL_ORDER) {
    return lower as LogLevel;
  }
  return fallback;
}

export type LoggerOptions = {
  level?: LogLevel;
  now?: () => Date;
  sink?: (line: string) => void;
};

export function createLogger(options: LoggerOptions = {}): StructuredLogger {
  const level = options.level ?? "info";
  const now = options.now ?? (() => new Date());
  const threshold = LEVEL_ORDER[level];

  function emit(target: LogLevel, stream: "stdout" | "stderr", event: string, fields?: Record<string, unknown>) {
    if (LEVEL_ORDER[target] < threshold) {
      return;
    }
    const line = JSON.stringify({
      timestamp: now().toISOString(),
      level: target,
      event,
      ...(fields ?? {})
    });
    if (options.sink) {
      options.sink(line);
      return;
    }
    if (stream === "stderr") {
      console.error(line);
    } else {
      console.log(line);
    }
  }

  return {
    debug: (event, fields) => emit("debug", "stdout", event, fields),
    info: (event, fields) => emit("info", "stdout", event, fields),
    warn: (event, fields) => emit("warn", "stderr", event, fields),
    error: (event, fields) => emit("error", "stderr", event, fields)
  };
}
