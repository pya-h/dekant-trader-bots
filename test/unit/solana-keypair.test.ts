import { describe, expect, it } from "vitest";
import { generateSolanaKeypair, keypairFromSecretKey, isValidBase58PublicKey } from "../../src/solana/keypair.js";

describe("generateSolanaKeypair", () => {
  it("returns a valid base58 publicKey and secretKey", () => {
    const kp = generateSolanaKeypair();

    expect(typeof kp.publicKey).toBe("string");
    expect(typeof kp.secretKey).toBe("string");
    expect(kp.publicKey.length).toBeGreaterThan(30);
    expect(kp.secretKey.length).toBeGreaterThan(30);
  });

  it("generates unique keypairs each call", () => {
    const a = generateSolanaKeypair();
    const b = generateSolanaKeypair();

    expect(a.publicKey).not.toBe(b.publicKey);
    expect(a.secretKey).not.toBe(b.secretKey);
  });

  it("roundtrips through keypairFromSecretKey", () => {
    const original = generateSolanaKeypair();
    const restored = keypairFromSecretKey(original.secretKey);

    expect(restored.publicKey.toBase58()).toBe(original.publicKey);
  });
});

describe("keypairFromSecretKey", () => {
  it("restores a keypair from a valid base58 secret key", () => {
    const kp = generateSolanaKeypair();
    const restored = keypairFromSecretKey(kp.secretKey);

    expect(restored.publicKey.toBase58()).toBe(kp.publicKey);
    expect(restored.secretKey).toHaveLength(64);
  });

  it("throws on invalid base58 input", () => {
    expect(() => keypairFromSecretKey("not-valid-base58!!!")).toThrow();
  });
});

describe("isValidBase58PublicKey", () => {
  it("returns true for a valid 32-byte base58 public key", () => {
    const kp = generateSolanaKeypair();
    expect(isValidBase58PublicKey(kp.publicKey)).toBe(true);
  });

  it("returns false for an empty string", () => {
    expect(isValidBase58PublicKey("")).toBe(false);
  });

  it("returns false for an invalid base58 string", () => {
    expect(isValidBase58PublicKey("not-a-key!!!")).toBe(false);
  });

  it("returns false for a string that decodes to wrong length", () => {
    expect(isValidBase58PublicKey("111")).toBe(false);
  });
});
