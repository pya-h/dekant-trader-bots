import { PublicKey } from "@solana/web3.js";

export function deriveProtocolConfig(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("protocol_config")], programId);
}

export function deriveMarket(programId: PublicKey, marketId: number | bigint): [PublicKey, number] {
  const buf = new Uint8Array(8);
  let n = BigInt(marketId);
  const mask = BigInt(0xff);
  const shift = BigInt(8);
  for (let i = 0; i < 8; i++) {
    buf[i] = Number(n & mask);
    n >>= shift;
  }
  return PublicKey.findProgramAddressSync([Buffer.from("market"), Buffer.from(buf)], programId);
}

export function deriveVaultAuthority(programId: PublicKey, marketPubkey: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault_authority"), marketPubkey.toBuffer()],
    programId
  );
}

export function deriveUserPosition(
  programId: PublicKey,
  marketPubkey: PublicKey,
  userPubkey: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user_position"), marketPubkey.toBuffer(), userPubkey.toBuffer()],
    programId
  );
}

export function deriveLpPosition(
  programId: PublicKey,
  marketPubkey: PublicKey,
  userPubkey: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("lp_position"), marketPubkey.toBuffer(), userPubkey.toBuffer()],
    programId
  );
}
