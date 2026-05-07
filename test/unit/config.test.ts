import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";

describe("loadConfig", () => {
  it("loads expected defaults", () => {
    const config = loadConfig({});

    expect(config).toEqual({
      nodeEnv: "development",
      host: "0.0.0.0",
      port: 3000,
      adminSecret: "dev-admin-secret"
    });
  });

  it("parses and applies overrides", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: "4321",
      ADMIN_SECRET: "secret"
    });

    expect(config).toEqual({
      nodeEnv: "test",
      host: "127.0.0.1",
      port: 4321,
      adminSecret: "secret"
    });
  });
});
