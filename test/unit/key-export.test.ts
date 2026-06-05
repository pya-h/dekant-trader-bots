import { describe, it, expect } from "vitest";
import { webcrypto } from "node:crypto";
import {
  decryptBotSecret,
  encryptBotSecrets,
  reverseSecret,
  type BotSecretInput
} from "../../src/security/key-export.js";

const bots: BotSecretInput[] = [
  { id: "bot-1", publicKey: "Pub111", secretKey: "5Kabc...secretOne" },
  { id: "bot-2", publicKey: "Pub222", secretKey: "5Kdef...secretTwo" }
];

describe("reverseSecret", () => {
  it("reverses by code point", () => {
    expect(reverseSecret("0JYMI+U^55(")).toBe("(55^U+IMYJ0");
  });
});

describe("encryptBotSecrets", () => {
  it("never leaks the plaintext secret in the payload", () => {
    const out = encryptBotSecrets(bots, "passphrase");
    const serialized = JSON.stringify(out);
    for (const bot of bots) {
      expect(serialized).not.toContain(bot.secretKey);
    }
    expect(out.cipher).toBe("AES-256-GCM");
    expect(out.kdf.algorithm).toBe("PBKDF2");
    expect(out.bots.map((b) => b.id)).toEqual(["bot-1", "bot-2"]);
    expect(out.bots.map((b) => b.publicKey)).toEqual(["Pub111", "Pub222"]);
  });

  it("round-trips through the node reference decryptor", () => {
    const out = encryptBotSecrets(bots, "passphrase");
    for (let i = 0; i < bots.length; i++) {
      const plain = decryptBotSecret(out.bots[i].encryptedSecretKey, out.kdf.salt, "passphrase");
      expect(plain).toBe(bots[i].secretKey);
    }
  });

  it("uses a distinct IV per bot (no GCM nonce reuse)", () => {
    const out = encryptBotSecrets(bots, "passphrase");
    const ivs = out.bots.map((b) => Buffer.from(b.encryptedSecretKey, "base64").subarray(0, 12).toString("hex"));
    expect(new Set(ivs).size).toBe(ivs.length);
  });

  it("fails to decrypt with the wrong passphrase", () => {
    const out = encryptBotSecrets(bots, "passphrase");
    expect(() => decryptBotSecret(out.bots[0].encryptedSecretKey, out.kdf.salt, "wrong")).toThrow();
  });

  it("rejects an empty passphrase", () => {
    expect(() => encryptBotSecrets(bots, "")).toThrow(/passphrase_required/);
  });

  // The panel decrypts with WebCrypto (PBKDF2 + AES-GCM). Prove the exact wire
  // format the browser will parse — iv(12) | ciphertext | tag(16) — interops.
  it("is decryptable by the WebCrypto path the panel uses", async () => {
    const passphrase = reverseSecret("0JYMI+U^55(");
    const out = encryptBotSecrets(bots, passphrase);
    const baseKey = await webcrypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(passphrase),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    const aesKey = await webcrypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: Buffer.from(out.kdf.salt, "base64"),
        iterations: out.kdf.iterations,
        hash: "SHA-256"
      },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );
    for (let i = 0; i < bots.length; i++) {
      const blob = Buffer.from(out.bots[i].encryptedSecretKey, "base64");
      const iv = blob.subarray(0, 12);
      const data = blob.subarray(12);
      const plain = await webcrypto.subtle.decrypt({ name: "AES-GCM", iv }, aesKey, data);
      expect(new TextDecoder().decode(plain)).toBe(bots[i].secretKey);
    }
  });
});
