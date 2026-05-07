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
});
