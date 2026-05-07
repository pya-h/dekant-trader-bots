import { describe, expect, it } from "vitest";
import { HttpResponseError } from "../../src/clients/http-client.js";
import { classifyError } from "../../src/observability/errors.js";

describe("classifyError", () => {
  it("classifies known upstream and network failures", () => {
    const upstream = classifyError(new HttpResponseError("service down", 503, ""));
    const network = classifyError(new TypeError("socket reset"));

    expect(upstream).toMatchObject({
      type: "upstream_unavailable",
      known: true,
      retryable: true,
      statusCode: 503
    });

    expect(network).toMatchObject({
      type: "network",
      known: true,
      retryable: true
    });
  });

  it("classifies internal known validation errors", () => {
    const validation = classifyError(new Error("invalid_payload"));

    expect(validation).toMatchObject({
      type: "validation",
      known: true,
      retryable: false
    });
  });

  it("routes unknown failures as unknown", () => {
    const unknown = classifyError(new Error("boom_unexpected"));

    expect(unknown).toMatchObject({
      type: "unknown",
      known: false,
      retryable: false
    });
  });
});
