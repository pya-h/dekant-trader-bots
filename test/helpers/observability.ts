export type CapturedErrorLog = {
  event: string;
  fields: Record<string, unknown>;
};

type StructuredLogger = {
  error(event: string, fields: Record<string, unknown>): void;
};

export function createCapturedLogger() {
  const entries: CapturedErrorLog[] = [];

  const logger: StructuredLogger = {
    error(event: string, fields: Record<string, unknown>) {
      entries.push({
        event,
        fields: { ...fields }
      });
    }
  };

  return {
    logger,
    entries,
    getEvents: () => entries.map((entry) => entry.event),
    getByEvent: (event: string) => entries.filter((entry) => entry.event === event)
  };
}
