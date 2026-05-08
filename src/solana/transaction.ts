import {
  Connection,
  Keypair,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  Commitment,
  SendTransactionError
} from "@solana/web3.js";

export type SendTransactionOptions = {
  connection: Connection;
  payer: Keypair;
  instructions: TransactionInstruction[];
  signers?: Keypair[];
  commitment?: Commitment;
  timeoutMs?: number;
};

export async function buildAndSendTransaction(options: SendTransactionOptions): Promise<string> {
  const { connection, payer, instructions, signers = [], commitment = "confirmed" } = options;

  const transaction = new Transaction();
  for (const ix of instructions) {
    transaction.add(ix);
  }

  const allSigners = [payer, ...signers];
  const txId = await sendAndConfirmTransaction(connection, transaction, allSigners, {
    commitment
  });

  return txId;
}

export function extractTxError(error: unknown): string {
  if (error instanceof SendTransactionError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "transaction_failed";
}
