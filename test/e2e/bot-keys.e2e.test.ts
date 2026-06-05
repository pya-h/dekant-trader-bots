import request from "supertest";
import { describe, expect, it } from "vitest";
import { createInitializedApp } from "../../src/server.js";
import { createBaseEnv } from "../helpers/config.js";
import { InMemoryStateStore } from "../helpers/memory-state-store.js";
import { decryptBotSecret, reverseSecret } from "../../src/security/key-export.js";

const timer = { setTimeout: () => "handle", clearTimeout: () => {} };

describe("admin bot keys endpoint", () => {
  it("requires admin auth", async () => {
    const appCtx = await createInitializedApp(createBaseEnv(), { store: new InMemoryStateStore(), timer });
    await appCtx.app.ready();

    const res = await request(appCtx.app.server).get("/admin/bots/keys");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "unauthorized" });

    await appCtx.app.close();
  });

  it("returns encrypted secret keys that decrypt with the reversed admin secret", async () => {
    const env = createBaseEnv({ BOT_COUNTS: "3" });
    const appCtx = await createInitializedApp(env, { store: new InMemoryStateStore(), timer });
    await appCtx.app.ready();

    const bots = appCtx.state.botsState.bots;
    expect(bots.length).toBe(3);

    const res = await request(appCtx.app.server)
      .get("/admin/bots/keys")
      .set("x-security", env.ADMIN_SECRET as string);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.cipher).toBe("AES-256-GCM");
    expect(res.body.bots).toHaveLength(3);

    // Plaintext secret keys must never appear in the response.
    const serialized = JSON.stringify(res.body);
    for (const bot of bots) {
      expect(serialized).not.toContain(bot.secretKey);
    }

    // Public keys are passed through; encrypted secrets decrypt back to the real keys.
    const passphrase = reverseSecret(env.ADMIN_SECRET as string);
    const byId = new Map(bots.map((b) => [b.id, b]));
    for (const entry of res.body.bots) {
      const original = byId.get(entry.id);
      expect(original).toBeDefined();
      expect(entry.publicKey).toBe(original!.publicKey);
      const decrypted = decryptBotSecret(entry.encryptedSecretKey, res.body.kdf.salt, passphrase);
      expect(decrypted).toBe(original!.secretKey);
    }

    await appCtx.app.close();
  });

  it("encrypts under BOTS_KEY_GUARD when it is set explicitly", async () => {
    const guard = "an-independent-key-export-passphrase";
    const env = createBaseEnv({ BOT_COUNTS: "2", BOTS_KEY_GUARD: guard });
    const appCtx = await createInitializedApp(env, { store: new InMemoryStateStore(), timer });
    await appCtx.app.ready();

    const bots = appCtx.state.botsState.bots;
    const res = await request(appCtx.app.server)
      .get("/admin/bots/keys")
      .set("x-security", env.ADMIN_SECRET as string);

    expect(res.status).toBe(200);

    const byId = new Map(bots.map((b) => [b.id, b]));
    for (const entry of res.body.bots) {
      // The reversed admin secret must NOT decrypt once a distinct guard is set.
      expect(() =>
        decryptBotSecret(entry.encryptedSecretKey, res.body.kdf.salt, reverseSecret(env.ADMIN_SECRET as string))
      ).toThrow();
      // The configured guard does.
      const decrypted = decryptBotSecret(entry.encryptedSecretKey, res.body.kdf.salt, guard);
      expect(decrypted).toBe(byId.get(entry.id)!.secretKey);
    }

    await appCtx.app.close();
  });
});
