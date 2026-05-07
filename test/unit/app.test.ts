import { describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import type { AppConfig } from "../../src/config.js";

const testConfig: AppConfig = {
  nodeEnv: "test",
  host: "127.0.0.1",
  port: 0,
  adminSecret: "test-secret"
};

describe("buildApp", () => {
  it("boots and closes cleanly", async () => {
    const app = buildApp(testConfig);

    await app.ready();
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);

    await expect(app.close()).resolves.toBeUndefined();
  });
});
