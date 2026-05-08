import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

export function generateSolanaKeypair(): { publicKey: string; secretKey: string } {
  const keypair = Keypair.generate();
  return {
    publicKey: keypair.publicKey.toBase58(),
    secretKey: bs58.encode(keypair.secretKey)
  };
}

export function keypairFromSecretKey(secretKeyBase58: string): Keypair {
  const secretBytes = bs58.decode(secretKeyBase58);
  return Keypair.fromSecretKey(secretBytes);
}

export function isValidBase58PublicKey(value: string): boolean {
  try {
    const decoded = bs58.decode(value);
    return decoded.length === 32;
  } catch {
    return false;
  }
}
