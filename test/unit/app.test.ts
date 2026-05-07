import { describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { createTestAppConfig } from "../helpers/config.js";

const testConfig = createTestAppConfig();

describe("buildApp", () => {
  it("boots and closes cleanly", async () => {
    const app = buildApp(testConfig);

    await app.ready();
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);

    await expect(app.close()).resolves.toBeUndefined();
  });

  it("rejects config patch payloads that attempt interval mutation", async () => {
    const app = buildApp(testConfig, undefined, {
      updateRuntimeConfig: async () => ({})
    });

    await app.ready();
    const response = await app.inject({
      method: "PATCH",
      url: "/admin/config",
      headers: {
        "x-security": testConfig.adminSecret
      },
      payload: {
        intervals: {
          buyMs: 1000
        }
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_payload" });

    await app.close();
  });

  it("rejects invalid add-bots and fund payloads", async () => {
    const app = buildApp(testConfig, undefined, {
      addBots: async () => ({}),
      manualFund: async () => ({})
    });

    await app.ready();

    const addResponse = await app.inject({
      method: "POST",
      url: "/admin/bots/add",
      headers: {
        "x-security": testConfig.adminSecret
      },
      payload: {
        count: 0
      }
    });

    const fundResponse = await app.inject({
      method: "POST",
      url: "/admin/bots/fund",
      headers: {
        "x-security": testConfig.adminSecret
      },
      payload: {
        amount: -10
      }
    });

    expect(addResponse.statusCode).toBe(400);
    expect(fundResponse.statusCode).toBe(400);

    await app.close();
  });
});
