import { describe, expect, it } from "vitest";
import { SendTransactionError } from "@solana/web3.js";
import { extractTxError } from "../../src/solana/transaction.js";

describe("extractTxError", () => {
  it("extracts message from a SendTransactionError", () => {
    const error = new SendTransactionError({
      action: "send",
      signature: "fakesig",
      transactionMessage: "Transaction simulation failed"
    });

    const result = extractTxError(error);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("extracts message from a standard Error", () => {
    const result = extractTxError(new Error("some_failure"));
    expect(result).toBe("some_failure");
  });

  it("returns default string for non-Error values", () => {
    expect(extractTxError("random string")).toBe("transaction_failed");
    expect(extractTxError(42)).toBe("transaction_failed");
    expect(extractTxError(null)).toBe("transaction_failed");
  });
});
