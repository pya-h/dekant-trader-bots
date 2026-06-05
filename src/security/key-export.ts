import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from "node:crypto";

// AES-256-GCM with a PBKDF2-SHA256 derived key. These parameters are mirrored by
// the admin panel's WebCrypto decryption (PBKDF2 + AES-GCM are both natively
// supported there), so any change here must be reflected in panel.html.
const PBKDF2_ITERATIONS = 200_000;
const KEY_LEN = 32; // AES-256
const SALT_LEN = 16;
const IV_LEN = 12; // 96-bit nonce, the standard/most-interoperable GCM IV size
const TAG_LEN = 16; // 128-bit auth tag (WebCrypto default)

export type EncryptedBotKey = {
  id: string;
  publicKey: string;
  /** base64 of [iv(12) | ciphertext | authTag(16)] — see encryptBotSecrets. */
  encryptedSecretKey: string;
};

export type BotKeyExport = {
  cipher: "AES-256-GCM";
  kdf: {
    algorithm: "PBKDF2";
    hash: "SHA-256";
    iterations: number;
    /** base64 salt, shared by every bot in this response (one derived key per batch). */
    salt: string;
  };
  bots: EncryptedBotKey[];
};

export type BotSecretInput = { id: string; publicKey: string; secretKey: string };

/**
 * Encrypt each bot's secret key with AES-256-GCM under a key derived from
 * `passphrase` via PBKDF2-SHA256.
 *
 * A single random salt (→ a single derived key) is shared across the batch so the
 * panel only runs the expensive KDF once; every bot still gets its own random
 * 12-byte IV, so the GCM nonce is never reused under that key. Plaintext secret
 * keys never leave this function and are never logged.
 *
 * Note on the threat model: the panel derives the same key from the same
 * passphrase, so this is confidentiality against passive observers / logs / the
 * plaintext-in-response surface — NOT against a party that already holds the
 * passphrase. That is by design: only an authenticated admin can reach the
 * endpoint, and the admin is authorized to see these keys.
 */
export function encryptBotSecrets(bots: BotSecretInput[], passphrase: string): BotKeyExport {
  if (!passphrase) {
    throw new Error("passphrase_required");
  }

  const salt = randomBytes(SALT_LEN);
  const key = pbkdf2Sync(Buffer.from(passphrase, "utf8"), salt, PBKDF2_ITERATIONS, KEY_LEN, "sha256");

  const encrypted = bots.map((bot) => {
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(Buffer.from(bot.secretKey, "utf8")), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      id: bot.id,
      publicKey: bot.publicKey,
      encryptedSecretKey: Buffer.concat([iv, ciphertext, tag]).toString("base64")
    };
  });

  return {
    cipher: "AES-256-GCM",
    kdf: {
      algorithm: "PBKDF2",
      hash: "SHA-256",
      iterations: PBKDF2_ITERATIONS,
      salt: salt.toString("base64")
    },
    bots: encrypted
  };
}

/**
 * Inverse of {@link encryptBotSecrets} for a single blob. Kept here so the
 * wire format has one authoritative reference implementation that the unit tests
 * exercise and the panel's WebCrypto code mirrors. Not used by the running server.
 */
export function decryptBotSecret(
  encryptedSecretKey: string,
  saltB64: string,
  passphrase: string,
  iterations = PBKDF2_ITERATIONS
): string {
  const salt = Buffer.from(saltB64, "base64");
  const key = pbkdf2Sync(Buffer.from(passphrase, "utf8"), salt, iterations, KEY_LEN, "sha256");
  const blob = Buffer.from(encryptedSecretKey, "base64");
  const iv = blob.subarray(0, IV_LEN);
  const tag = blob.subarray(blob.length - TAG_LEN);
  const ciphertext = blob.subarray(IV_LEN, blob.length - TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** Reverse a string by Unicode code point (so surrogate pairs survive). */
export function reverseSecret(secret: string): string {
  return Array.from(secret).reverse().join("");
}
