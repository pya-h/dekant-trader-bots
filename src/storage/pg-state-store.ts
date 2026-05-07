import postgres from "postgres";
import type { StructuredLogger } from "../observability/logger.js";
import {
  BotsStateFile,
  RuntimeConfigFile,
  botsStateFileSchema,
  runtimeConfigFileSchema
} from "../state/types.js";
import type { StateStore } from "./state-store.js";

export class PgStateStore implements StateStore {
  private sql: postgres.Sql;

  constructor(databaseUrl: string, logger?: StructuredLogger) {
    this.sql = postgres(databaseUrl, {
      onnotice: (notice) => {
        const fields = {
          severity: notice.severity,
          code: notice.code,
          message: notice.message,
          ...(notice.detail ? { detail: notice.detail } : {}),
          ...(notice.hint ? { hint: notice.hint } : {})
        };
        const severity = (notice.severity ?? "").toUpperCase();
        if (severity === "WARNING") {
          logger?.warn?.("pg_notice", fields);
        } else if (severity === "DEBUG" || severity === "INFO" || severity === "LOG") {
          logger?.debug?.("pg_notice", fields);
        } else {
          logger?.info?.("pg_notice", fields);
        }
      }
    });
  }

  async initialize(): Promise<void> {
    await this.sql`
      CREATE TABLE IF NOT EXISTS app_state (
        key VARCHAR(64) PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
  }

  async close(): Promise<void> {
    await this.sql.end();
  }

  async loadRuntimeConfig(): Promise<RuntimeConfigFile | null> {
    const rows = await this.sql`
      SELECT data FROM app_state WHERE key = 'runtime_config'
    `;
    if (rows.length === 0) {
      return null;
    }
    return runtimeConfigFileSchema.parse(rows[0].data);
  }

  async saveRuntimeConfig(config: RuntimeConfigFile): Promise<void> {
    const validated = runtimeConfigFileSchema.parse(config);
    await this.sql`
      INSERT INTO app_state (key, data, updated_at)
      VALUES ('runtime_config', ${this.sql.json(validated)}, now())
      ON CONFLICT (key)
      DO UPDATE SET data = ${this.sql.json(validated)}, updated_at = now()
    `;
  }

  async loadBotsState(): Promise<BotsStateFile | null> {
    const rows = await this.sql`
      SELECT data FROM app_state WHERE key = 'bots_state'
    `;
    if (rows.length === 0) {
      return null;
    }
    return botsStateFileSchema.parse(rows[0].data);
  }

  async saveBotsState(state: BotsStateFile): Promise<void> {
    const validated = botsStateFileSchema.parse(state);
    await this.sql`
      INSERT INTO app_state (key, data, updated_at)
      VALUES ('bots_state', ${this.sql.json(validated)}, now())
      ON CONFLICT (key)
      DO UPDATE SET data = ${this.sql.json(validated)}, updated_at = now()
    `;
  }
}
