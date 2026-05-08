import { randomUUID } from "node:crypto";
import { BotRecord, BotsStateFile } from "../state/types.js";
import { saveBotsState } from "../storage/bots-state-store.js";
import { generateSolanaKeypair } from "../solana/keypair.js";

export type GenerateKeypairFn = () => {
  publicKey: string;
  secretKey: string;
};

export type GenerateIdFn = () => string;
export type NowFn = () => Date;

export type BotLifecycleDependencies = {
  now?: NowFn;
  generateKeypair?: GenerateKeypairFn;
  generateBotId?: GenerateIdFn;
};

export type ReconcileBotsResult = {
  updatedState: BotsStateFile;
  createdBots: BotRecord[];
  hadExistingBots: boolean;
};

function defaultNow(): Date {
  return new Date();
}

function defaultGenerateBotId(): string {
  return randomUUID();
}

function defaultGenerateKeypair(): { publicKey: string; secretKey: string } {
  return generateSolanaKeypair();
}

export function createBotRecord(
  deps: Required<Pick<BotLifecycleDependencies, "now" | "generateBotId" | "generateKeypair">>
): BotRecord {
  const keypair = deps.generateKeypair();
  return {
    id: deps.generateBotId(),
    publicKey: keypair.publicKey,
    secretKey: keypair.secretKey,
    createdAt: deps.now().toISOString(),
    lastActiveAt: null
  };
}

export function reconcileBotsToTarget(
  botsState: BotsStateFile,
  targetCount: number,
  deps: BotLifecycleDependencies = {}
): ReconcileBotsResult {
  const now = deps.now ?? defaultNow;
  const generateBotId = deps.generateBotId ?? defaultGenerateBotId;
  const generateKeypair = deps.generateKeypair ?? defaultGenerateKeypair;

  const existingBots = [...botsState.bots];
  const hadExistingBots = existingBots.length > 0;

  if (existingBots.length >= targetCount) {
    return {
      updatedState: botsState,
      createdBots: [],
      hadExistingBots
    };
  }

  const missingCount = targetCount - existingBots.length;
  const createdBots: BotRecord[] = Array.from({ length: missingCount }, () =>
    createBotRecord({ now, generateBotId, generateKeypair })
  );

  const updatedState: BotsStateFile = {
    ...botsState,
    updatedAt: now().toISOString(),
    bots: [...existingBots, ...createdBots]
  };

  return {
    updatedState,
    createdBots,
    hadExistingBots
  };
}

export async function reconcileAndPersistBots(options: {
  botsStatePath: string;
  botsState: BotsStateFile;
  targetCount: number;
  deps?: BotLifecycleDependencies;
}): Promise<ReconcileBotsResult> {
  const result = reconcileBotsToTarget(options.botsState, options.targetCount, options.deps);

  if (result.createdBots.length > 0) {
    await saveBotsState(options.botsStatePath, result.updatedState);
  }

  return result;
}

export async function addBotsAndPersist(options: {
  botsStatePath: string;
  botsState: BotsStateFile;
  count: number;
  deps?: BotLifecycleDependencies;
}): Promise<{ updatedState: BotsStateFile; addedBots: BotRecord[] }> {
  if (options.count <= 0) {
    throw new Error("count_must_be_positive");
  }

  const now = options.deps?.now ?? defaultNow;
  const generateBotId = options.deps?.generateBotId ?? defaultGenerateBotId;
  const generateKeypair = options.deps?.generateKeypair ?? defaultGenerateKeypair;

  const addedBots: BotRecord[] = Array.from({ length: options.count }, () =>
    createBotRecord({ now, generateBotId, generateKeypair })
  );

  const updatedState: BotsStateFile = {
    ...options.botsState,
    updatedAt: now().toISOString(),
    bots: [...options.botsState.bots, ...addedBots]
  };

  await saveBotsState(options.botsStatePath, updatedState);

  return {
    updatedState,
    addedBots
  };
}
