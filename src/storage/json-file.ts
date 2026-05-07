import { promises as fs } from "node:fs";
import path from "node:path";

export class JsonFileParseError extends Error {
  constructor(filePath: string, cause: unknown) {
    super(`Failed to parse JSON file at ${filePath}`);
    this.name = "JsonFileParseError";
    this.cause = cause;
  }
}

export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    if (error instanceof SyntaxError) {
      throw new JsonFileParseError(filePath, error);
    }

    throw error;
  }
}

export async function writeJsonFileAtomic(filePath: string, payload: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;

  try {
    await fs.writeFile(tempPath, serialized, "utf8");
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true });
    throw error;
  }
}
