import {
  BotPositionMemoryEntry,
  BotPositionMemoryFile
} from "./types.js";
import type { StateStore } from "../storage/state-store.js";

function makeKey(botPubkey: string, marketId: string): string {
  return `${botPubkey}::${marketId}`;
}

export class BotPositionMemory {
  private readonly entries = new Map<string, BotPositionMemoryEntry>();
  private readonly store: StateStore;
  private readonly now: () => Date;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(options: { store: StateStore; now?: () => Date }) {
    this.store = options.store;
    this.now = options.now ?? (() => new Date());
  }

  async load(): Promise<void> {
    const file = await this.store.loadBotPositionMemory();
    if (!file) return;
    for (const entry of file.entries) {
      this.entries.set(makeKey(entry.botPubkey, entry.marketId), entry);
    }
  }

  lookup(botPubkey: string, marketId: string): BotPositionMemoryEntry | null {
    return this.entries.get(makeKey(botPubkey, marketId)) ?? null;
  }

  /** Records a buy and persists asynchronously. Persists are serialized. */
  record(input: {
    botPubkey: string;
    marketId: string;
    center: number;
    spread: number;
  }): void {
    const entry: BotPositionMemoryEntry = {
      botPubkey: input.botPubkey,
      marketId: input.marketId,
      center: input.center,
      spread: input.spread,
      ts: this.now().toISOString()
    };
    this.entries.set(makeKey(entry.botPubkey, entry.marketId), entry);
    this.writeQueue = this.writeQueue.then(() => this.persist()).catch(() => {});
  }

  private async persist(): Promise<void> {
    const file: BotPositionMemoryFile = {
      version: 1,
      updatedAt: this.now().toISOString(),
      entries: [...this.entries.values()]
    };
    await this.store.saveBotPositionMemory(file);
  }

  /** Awaits any pending writes (used for shutdown / tests). */
  async flush(): Promise<void> {
    await this.writeQueue;
  }
}
