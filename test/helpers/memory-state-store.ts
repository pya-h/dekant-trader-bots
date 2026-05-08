import {
  BotPositionMemoryFile,
  BotsStateFile,
  RuntimeConfigFile,
  botPositionMemoryFileSchema,
  botsStateFileSchema,
  runtimeConfigFileSchema
} from "../../src/state/types.js";
import type { StateStore } from "../../src/storage/state-store.js";

export class InMemoryStateStore implements StateStore {
  private runtimeConfig: RuntimeConfigFile | null = null;
  private botsState: BotsStateFile | null = null;
  private botPositionMemory: BotPositionMemoryFile | null = null;

  async initialize(): Promise<void> {}

  async close(): Promise<void> {}

  async loadRuntimeConfig(): Promise<RuntimeConfigFile | null> {
    return this.runtimeConfig;
  }

  async saveRuntimeConfig(config: RuntimeConfigFile): Promise<void> {
    this.runtimeConfig = runtimeConfigFileSchema.parse(config);
  }

  async loadBotsState(): Promise<BotsStateFile | null> {
    return this.botsState;
  }

  async saveBotsState(state: BotsStateFile): Promise<void> {
    this.botsState = botsStateFileSchema.parse(state);
  }

  async loadBotPositionMemory(): Promise<BotPositionMemoryFile | null> {
    return this.botPositionMemory;
  }

  async saveBotPositionMemory(memory: BotPositionMemoryFile): Promise<void> {
    this.botPositionMemory = botPositionMemoryFileSchema.parse(memory);
  }
}
