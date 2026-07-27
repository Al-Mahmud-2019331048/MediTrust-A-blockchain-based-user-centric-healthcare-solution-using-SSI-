#!/usr/bin/env node
// Checks (and, unless --check-only is passed, auto-fixes) whether the
// bundled BCovrin genesis in agents/shared/network/network-config.ts is
// stale — i.e. missing newer validator transactions than what's live on the
// network right now.
//
// Why this exists: for most of this project's history, every "ledger pool
// blocked" result was misdiagnosed as a network/firewall issue. The real
// cause (found 2026-07-22) was that the bundled genesis only contained
// BCovrin's *original* 4 validator transactions, which have since been
// decommissioned — every ledger call was silently trying to reach dead
// servers. See CLAUDE.md's "Ledger Connectivity" section for the full story.
// This script exists so that failure mode can never silently recur.
//
// Usage: node scripts/check-genesis.js [--check-only]

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.resolve(__dirname, '../agents/shared/network/network-config.ts');
const GENESIS_URL = 'https://test.bcovrin.vonx.io/genesis';
const CHECK_ONLY = process.argv.includes('--check-only');

function maxSeqNo(genesisText) {
  let max = 0;
  const re = /"seqNo":(\d+)/g;
  let m;
  while ((m = re.exec(genesisText)) !== null) {
    const n = parseInt(m[1], 10);
    if (n > max) max = n;
  }
  return max;
}

// Escapes anything that would break out of a template literal if the fetched
// genesis text (plain JSON lines) ever contained a backtick, backslash, or
// ${ sequence — extremely unlikely in real validator-transaction data, but
// cheap to guard against rather than assume.
function escapeForTemplateLiteral(text) {
  return text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

async function main() {
  let bundled;
  try {
    bundled = fs.readFileSync(CONFIG_PATH, 'utf8');
  } catch (err) {
    console.log(`genesis check: could not read ${CONFIG_PATH} (${err.message}) — skipping`);
    process.exit(0);
  }
  const bundledMax = maxSeqNo(bundled);

  let live;
  try {
    const res = await fetch(GENESIS_URL, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    live = (await res.text()).trim();
  } catch (err) {
    console.log(`genesis check: could not reach ${GENESIS_URL} (${err.message}) — skipping, using whatever's already bundled`);
    process.exit(0);
  }
  const liveMax = maxSeqNo(live);

  if (liveMax <= bundledMax) {
    console.log(`genesis check: OK (bundled has up to seqNo ${bundledMax}, live network has ${liveMax})`);
    process.exit(0);
  }

  console.log(`genesis check: STALE — bundled genesis only has up to seqNo ${bundledMax}, live network is at ${liveMax}`);

  if (CHECK_ONLY) {
    console.log('genesis check: not fixing (--check-only) — run `node scripts/check-genesis.js` without that flag, or restart via npm run dev:all, to refresh it');
    process.exit(1);
  }

  const newBlock = 'export const BCOVRIN_GENESIS = `' + escapeForTemplateLiteral(live) + '`';
  const updated = bundled.replace(/export const BCOVRIN_GENESIS = `[\s\S]*?`/, newBlock);

  if (updated === bundled) {
    console.log('genesis check: found a newer genesis but could not locate the BCOVRIN_GENESIS block to replace — leaving the file untouched, update it manually (see CLAUDE.md Known Constraints)');
    process.exit(1);
  }

  fs.writeFileSync(CONFIG_PATH, updated);
  console.log(`genesis check: FIXED — ${CONFIG_PATH} refreshed to seqNo ${liveMax}. Restart any already-running agents to pick this up.`);
}

main();
