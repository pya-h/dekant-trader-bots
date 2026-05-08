import { Logger } from "../../src/observability/logger.js";

export type CapturedLogEntry = {
  level: "debug" | "info" | "warn" | "error";
  event: string;
  fields: Record<string, unknown>;
};

export function createCapturedLogger() {
  const entries: CapturedLogEntry[] = [];

  const capture = (level: CapturedLogEntry["level"]) => (event: string, fields: Record<string, unknown> = {}) => {
    entries.push({ level, event, fields: { ...fields } });
  };

  const logger: Logger = {
    debug: capture("debug"),
    info: capture("info"),
    warn: capture("warn"),
    error: capture("error")
  };

  return {
    logger,
    entries,
    getEvents: () => entries.map((entry) => entry.event),
    getByEvent: (event: string) => entries.filter((entry) => entry.event === event),
    getByLevel: (level: CapturedLogEntry["level"]) => entries.filter((entry) => entry.level === level)
  };
}
