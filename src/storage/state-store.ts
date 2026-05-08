import { BotPositionMemoryFile, BotsStateFile, RuntimeConfigFile } from "../state/types.js";

export interface StateStore {
  initialize(): Promise<void>;
  close(): Promise<void>;
  loadRuntimeConfig(): Promise<RuntimeConfigFile | null>;
  saveRuntimeConfig(config: RuntimeConfigFile): Promise<void>;
  loadBotsState(): Promise<BotsStateFile | null>;
  saveBotsState(state: BotsStateFile): Promise<void>;
  loadBotPositionMemory(): Promise<BotPositionMemoryFile | null>;
  saveBotPositionMemory(memory: BotPositionMemoryFile): Promise<void>;
}
