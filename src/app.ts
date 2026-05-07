import Fastify, { FastifyInstance } from "fastify";
import { AppConfig } from "./config.js";

type StatusRuntimeSnapshot = {
  stateDir: string;
  botCount: number;
  buyChance: number;
  sellChance: number;
  maxAmount: number;
  createdBotsOnStartup: number;
  initialFundingScheduled: boolean;
};

export function buildApp(
  config: AppConfig,
  runtimeSnapshot?: StatusRuntimeSnapshot
): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get("/health", async () => {
    return { status: "ok" };
  });

  app.register(
    async (adminScope) => {
      adminScope.addHook("onRequest", async (request, reply) => {
        const securityHeader = request.headers["x-security"];
        if (securityHeader !== config.adminSecret) {
          reply.code(401).send({ error: "unauthorized" });
        }
      });

      adminScope.get("/status", async () => {
        return {
          status: "ok",
          service: "dekant-trader-bots",
          runtime: runtimeSnapshot ?? null
        };
      });
    },
    { prefix: "/admin" }
  );

  return app;
}
