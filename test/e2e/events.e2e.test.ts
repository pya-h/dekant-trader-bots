import request from "supertest";
import { describe, expect, it } from "vitest";
import { createInitializedApp } from "../../src/server.js";
import { createBaseEnv } from "../helpers/config.js";
import { InMemoryStateStore } from "../helpers/memory-state-store.js";

const timer = { setTimeout: () => "handle", clearTimeout: () => {} };

describe("GET /admin/events", () => {
  it("requires admin auth", async () => {
    const env = createBaseEnv();
    const appCtx = await createInitializedApp(env, { store: new InMemoryStateStore(), timer });
    await appCtx.app.ready();

    const res = await request(appCtx.app.server).get("/admin/events");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "unauthorized" });

    await appCtx.app.close();
  });

  it("returns the event-log snapshot shape", async () => {
    const env = createBaseEnv();
    const appCtx = await createInitializedApp(env, { store: new InMemoryStateStore(), timer });
    await appCtx.app.ready();

    const res = await request(appCtx.app.server)
      .get("/admin/events")
      .set("x-security", env.ADMIN_SECRET as string);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(typeof res.body.capacity).toBe("number");
    expect(typeof res.body.total).toBe("number");
    expect(typeof res.body.dropped).toBe("number");
    expect(Array.isArray(res.body.entries)).toBe(true);

    await appCtx.app.close();
  });

  it("rejects a non-positive limit", async () => {
    const env = createBaseEnv();
    const appCtx = await createInitializedApp(env, { store: new InMemoryStateStore(), timer });
    await appCtx.app.ready();

    const res = await request(appCtx.app.server)
      .get("/admin/events?limit=0")
      .set("x-security", env.ADMIN_SECRET as string);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid_limit" });

    await appCtx.app.close();
  });
});
