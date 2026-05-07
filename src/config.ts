import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  ADMIN_SECRET: z.string().min(1).default("dev-admin-secret")
});

export type AppConfig = {
  nodeEnv: string;
  host: string;
  port: number;
  adminSecret: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);

  return {
    nodeEnv: parsed.NODE_ENV,
    host: parsed.HOST,
    port: parsed.PORT,
    adminSecret: parsed.ADMIN_SECRET
  };
}
