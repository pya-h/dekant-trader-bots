import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonFileParseError, readJsonFile, writeJsonFileAtomic } from "../../src/storage/json-file.js";

const tempRoots: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dtb-json-"));
  tempRoots.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempRoots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tempRoots.length = 0;
});

describe("json-file storage", () => {
  it("writes and reads JSON atomically", async () => {
    const dir = await createTempDir();
    const filePath = path.join(dir, "sample.json");

    await writeJsonFileAtomic(filePath, { ok: true, count: 7 });
    const loaded = await readJsonFile<{ ok: boolean; count: number }>(filePath);

    expect(loaded).toEqual({ ok: true, count: 7 });
  });

  it("throws corruption error on invalid JSON", async () => {
    const dir = await createTempDir();
    const filePath = path.join(dir, "broken.json");

    await fs.writeFile(filePath, "{invalid-json", "utf8");

    await expect(readJsonFile(filePath)).rejects.toBeInstanceOf(JsonFileParseError);
  });
});
