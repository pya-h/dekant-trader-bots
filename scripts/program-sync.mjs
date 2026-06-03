#!/usr/bin/env node
// program-sync — align the Anchor IDL program address with PROGRAM_ID.
//
// Anchor resolves a program's id from `idl.address` (the top-level "address" in
// dekant_pm.json). We run a single codebase/image against two devnet programs
// (staging + main); this script rewrites that address from PROGRAM_ID so
// the IDL, the PDAs (config.ts), and the on-chain calls all target the same
// program. Without it, pointing env at one program while the bundled IDL holds
// the other silently breaks every trade.
//
// It targets the source IDL/type files (for `npm run dev` / builds) and the
// built dist IDL (for the production runtime), skipping whichever are absent.
// Idempotent: safe to run on every startup. Only the program's own address is
// touched — the embedded Token/System program ids are left alone.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Solana addresses are base58, 32–44 chars (no 0 O I l).
const BASE58_PUBKEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
// Matches the FIRST `"address": "<base58>"` in a file — which in both the IDL
// JSON and the IDL type file is the program's own address (it precedes any
// embedded Token/System program ids).
const PROGRAM_ADDRESS = /("address"\s*:\s*")[1-9A-HJ-NP-Za-km-z]{32,44}(")/;

// Files that carry the program address, relative to project root. Missing ones
// are skipped (src/ is absent in the runtime image; dist/ is absent pre-build).
const TARGETS = [
  "src/solana/program/dekant_pm.json",
  "src/solana/program/dekant_pm.ts",
  "dist/solana/program/dekant_pm.json"
];

async function readEnvFileProgramId() {
  let raw;
  try {
    raw = await readFile(resolve(projectRoot, ".env"), "utf8");
  } catch {
    return null;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq).trim() !== "PROGRAM_ID") continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value.trim() || null;
  }
  return null;
}

async function main() {
  // Prefer a real env var (Docker/Coolify); fall back to .env for plain checkouts.
  const programId = process.env.PROGRAM_ID?.trim() || (await readEnvFileProgramId());

  if (!programId) {
    console.warn("[program-sync] PROGRAM_ID not set (env or .env); leaving IDL address unchanged.");
    return;
  }
  if (!BASE58_PUBKEY.test(programId)) {
    console.error(`[program-sync] PROGRAM_ID is not a valid base58 pubkey: "${programId}"`);
    process.exit(1);
  }

  let updated = 0;
  let alreadySynced = 0;
  let missing = 0;

  for (const rel of TARGETS) {
    const file = resolve(projectRoot, rel);
    let content;
    try {
      content = await readFile(file, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") {
        missing += 1;
        continue;
      }
      throw error;
    }

    if (!PROGRAM_ADDRESS.test(content)) {
      console.warn(`[program-sync] no program address field in ${rel}; skipping.`);
      continue;
    }

    const next = content.replace(PROGRAM_ADDRESS, `$1${programId}$2`);
    if (next === content) {
      alreadySynced += 1;
      console.log(`[program-sync] ${rel} already synced.`);
      continue;
    }

    await writeFile(file, next);
    updated += 1;
    console.log(`[program-sync] ${rel} -> ${programId}`);
  }

  console.log(
    `[program-sync] done: ${updated} updated, ${alreadySynced} already synced, ${missing} not present (target=${programId}).`
  );
}

main().catch((error) => {
  console.error("[program-sync] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
