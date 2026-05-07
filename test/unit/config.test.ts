import { describe, expect, it } from "vitest";
import { loadEnvConfig } from "../../src/config.js";
import { createBaseEnv } from "../helpers/config.js";

describe("loadEnvConfig", () => {
  it("loads expected defaults for optional fields", () => {
    const config = loadEnvConfig(
      createBaseEnv({
        HOST: undefined,
        PORT: undefined,
        MARKET_REFRESH_INTERVAL_MS: undefined
      })
    );

    expect(config).toMatchObject({
      nodeEnv: "test",
      host: "0.0.0.0",
      port: 3000,
      adminSecret: "test-secret"
    });

    expect(config.intervals.marketRefreshMs).toBe(3_600_000);
  });

  it("parses and applies overrides", () => {
    const config = loadEnvConfig(
      createBaseEnv({
        HOST: "10.0.0.3",
        PORT: "4321",
        BUY_CHANCE: "74",
        VAULT_SUPPORTED_MINTS: "MintA, MintB, MintC"
      })
    );

    expect(config).toMatchObject({
      nodeEnv: "test",
      host: "10.0.0.3",
      port: 4321,
      adminSecret: "test-secret"
    });

    expect(config.runtimeDefaults.buyChance).toBe(74);
    expect(config.runtimeDefaults.vaultSupportedMints).toEqual(["MintA", "MintB", "MintC"]);
  });

  it("fails fast when required env value is missing", () => {
    expect(() =>
      loadEnvConfig(
        createBaseEnv({
          DEKANT_BACKEND_URL: undefined
        })
      )
    ).toThrow();
  });

  it("fails fast when chance value is invalid", () => {
    expect(() =>
      loadEnvConfig(
        createBaseEnv({
          BUY_CHANCE: "140"
        })
      )
    ).toThrow();
  });
});
