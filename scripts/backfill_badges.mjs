import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const baseUrl = readArg('--base-url') ?? process.env.BADGE_BACKFILL_BASE_URL?.trim();
const productionConfirmed = args.includes('--confirm-production');

if (!baseUrl) {
  console.error('Usage: node scripts/backfill_badges.mjs --base-url <safety-url> [--confirm-production]');
  process.exit(2);
}
if (!/safety/i.test(baseUrl) && !productionConfirmed) {
  console.error('Non-safety badge backfills require --confirm-production.');
  process.exit(2);
}

const adminKey = process.env.ADMIN_API_KEY?.trim() || loadDevVar('ADMIN_API_KEY');
if (!adminKey) {
  console.error('Set ADMIN_API_KEY or provide it in .dev.vars.');
  process.exit(2);
}

let cursor = null;
let processed = 0;
for (;;) {
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/admin/progression/badges/backfill`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
    body: JSON.stringify({ cursor, limit: 20 }),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Badge backfill failed (${response.status}): ${text}`);
  const result = JSON.parse(text);
  processed += Number(result.processed ?? 0);
  console.log(`[badge-backfill] processed=${processed} done=${Boolean(result.done)}`);
  if (result.done) break;
  if (typeof result.nextCursor !== 'string' || !result.nextCursor) {
    throw new Error('Badge backfill returned no cursor before completion.');
  }
  cursor = result.nextCursor;
}

function readArg(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1]?.trim() || null : null;
}

function loadDevVar(name) {
  const path = join(process.cwd(), '.dev.vars');
  if (!existsSync(path)) return null;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = new RegExp(`^${name}=(.*)$`).exec(line.trim());
    if (!match) continue;
    const value = match[1]?.trim() ?? '';
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      return value.slice(1, -1);
    }
    return value;
  }
  return null;
}
