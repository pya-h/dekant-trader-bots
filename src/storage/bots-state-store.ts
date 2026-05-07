import { BotsStateFile, botsStateFileSchema } from "../state/types.js";
import { readJsonFile, writeJsonFileAtomic } from "./json-file.js";

function nowIso(): string {
  return new Date().toISOString();
}

function makeInitialBotsState(): BotsStateFile {
  return {
    version: 1,
    updatedAt: nowIso(),
    bots: []
  };
}

export async function ensureBotsState(filePath: string): Promise<BotsStateFile> {
  const existing = await readJsonFile<unknown>(filePath);

  if (existing === null) {
    const initial = makeInitialBotsState();
    await writeJsonFileAtomic(filePath, initial);
    return initial;
  }

  return botsStateFileSchema.parse(existing);
}

export async function saveBotsState(filePath: string, botsState: BotsStateFile): Promise<void> {
  const validated = botsStateFileSchema.parse(botsState);
  await writeJsonFileAtomic(filePath, validated);
}
