import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { createTestAppConfig } from "../helpers/config.js";

const testConfig = createTestAppConfig();

describe("admin auth", () => {
  const app = buildApp(testConfig);

  beforeAll(async () => {
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects request with missing security header", async () => {
    const response = await request(app.server).get("/admin/status");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "unauthorized" });
  });

  it("accepts request when header is valid", async () => {
    const response = await request(app.server)
      .get("/admin/status")
      .set("x-security", testConfig.adminSecret);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "ok",
      service: "dekant-trader-bots",
      runtime: null
    });
  });
});
