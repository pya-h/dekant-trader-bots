import { Connection, Commitment } from "@solana/web3.js";

export type SolanaConnectionOptions = {
  rpcUrl: string;
  commitment?: Commitment;
};

export function createSolanaConnection(options: SolanaConnectionOptions): Connection {
  return new Connection(options.rpcUrl, {
    commitment: options.commitment ?? "confirmed"
  });
}
