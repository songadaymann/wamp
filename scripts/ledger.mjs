// Builds feature-ledger.md from docs/ledger/, where each entry is its own file holding one
// table row. Branches that each add an entry never touch the same file (F486).
//
//   npm run ledger              rewrite feature-ledger.md
//   npm run ledger -- --check   list what is wrong, exit 1 if anything is
//   npm run ledger -- --all     print every entry, not just the newest SHOWN
//
// scripts/ledger.test.ts runs the same check in `npm test`.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SHOWN = 80;
export const FRAGMENT_DIR = 'docs/ledger';
export const LEDGER_FILE = 'feature-ledger.md';
const REPO = resolve(fileURLToPath(import.meta.url), '../..');
const NAME = /^(\d{4}-\d{2}-\d{2})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const IDS = /^F\d{3}(?:, F\d{3})*$/;
const PR_LINK = /^\[#(\d+)\]\(https:\/\/github\.com\/songadaymann\/wamp\/pull\/(\d+)\)$/;
const RECEIPT = /^\[receipt\]\((docs\/review\/[\w.-]+\.md)\)$/;
const NONE = new Set(['—', '-']);
export const SUMMARY_MAX = 120;

export function header(shown = SHOWN) {
  return [
    '# Feature ledger',
    '',
    'One row per delivered item, newest first. The full write-up is the receipt in [docs/review/](docs/review/). Open work is in the [round 2 checklist](docs/review/wamp-checkup-round-2.md).',
    '',
    `Don't edit the table by hand. \`npm run ledger\` builds it from one file per entry in [docs/ledger/](docs/ledger/README.md), which explains how to add one. It shows the newest ${shown} entries; \`npm run ledger -- --all\` prints them all.`,
    '',
    'History up to 2026-10-23, in long form: [docs/history/feature-ledger-2026.md](docs/history/feature-ledger-2026.md) (357 KB) and [docs/history/progress-2026.md](docs/history/progress-2026.md) (586 KB). Search them; don\'t read them whole.',
    '',
    '| Date | Items | PR | Receipt | Summary |',
    '|---|---|---|---|---|',
  ];
}

// Newest first: by the date in the file name, then by the highest PR number in the row.
export function readFragments(root = REPO) {
  const dir = join(root, FRAGMENT_DIR);
  const lastPr = (text) => Math.max(0, ...[...text.matchAll(/\/pull\/(\d+)\)/g)].map((m) => Number(m[1])));
  return readdirSync(dir).filter((file) => file !== 'README.md' && !file.startsWith('.'))
    .map((file) => ({ file, text: readFileSync(join(dir, file), 'utf8') }))
    .sort((a, b) => b.file.slice(0, 10).localeCompare(a.file.slice(0, 10)) || lastPr(b.text) - lastPr(a.text) || b.file.localeCompare(a.file));
}

function cells(row) {
  if (!row.startsWith('| ') || !row.endsWith(' |')) return null;
  return row.slice(2, -2).split(' | ');
}

function prErrors(cell) {
  if (NONE.has(cell)) return [];
  return cell.split(', ').flatMap((part) => {
    const links = part.split(/(?<=\))[–-](?=\[)/);
    const numbers = links.map((link) => link.match(PR_LINK)).map((m) => (m && m[1] === m[2] ? Number(m[1]) : null));
    if (links.length > 2 || numbers.includes(null)) return [`PR "${part}" must be [#N](https://github.com/songadaymann/wamp/pull/N), or two of them joined by – for a run`];
    return links.length === 2 && numbers[0] >= numbers[1] ? [`PR run "${part}" must go from low to high`] : [];
  });
}

export function fragmentErrors({ file, text }, root = REPO) {
  const where = `${FRAGMENT_DIR}/${file}`;
  const date = file.match(NAME)?.[1];
  if (!date) return [`${where}: name it <YYYY-MM-DD>-<slug>.md (lowercase letters, digits and dashes)`];
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  if (lines.length !== 1) return [`${where}: hold exactly one table row (found ${lines.length} lines)`];
  const parts = cells(lines[0]);
  if (!parts || parts.length !== 5) return [`${where}: the row needs 5 cells, | date | items | PR | receipt | summary |`];
  const [rowDate, ids, prs, receipt, summary] = parts;
  const errors = [];
  if (rowDate !== date) errors.push(`date ${rowDate} differs from the file name's ${date}`);
  if (!NONE.has(ids) && !IDS.test(ids)) errors.push(`items "${ids}" must be F-IDs separated by ", ", or —`);
  errors.push(...prErrors(prs));
  const receiptPath = receipt.match(RECEIPT)?.[1];
  if (!NONE.has(receipt) && !receiptPath) errors.push(`receipt "${receipt}" must be [receipt](docs/review/<file>.md), or —`);
  if (receiptPath && !existsSync(join(root, receiptPath))) errors.push(`receipt ${receiptPath} does not exist`);
  if (!summary.trim()) errors.push('summary is empty');
  if (summary.length > SUMMARY_MAX) errors.push(`summary is ${summary.length} characters; keep it to ${SUMMARY_MAX}`);
  return errors.map((error) => `${where}: ${error}`);
}

export function buildLedger(fragments, { all = false, shown = SHOWN } = {}) {
  const rows = fragments.map(({ text }) => text.trim());
  return [...header(shown), ...(all ? rows : rows.slice(0, shown)), ''].join('\n');
}

// Tolerates what git's union merge leaves behind (see .gitattributes): rows out of order, or a
// few extra older rows. It still catches a missing entry, a hand-written row and a changed header.
export function ledgerErrors(root = REPO, shown = SHOWN) {
  const fragments = readFragments(root);
  const errors = fragments.flatMap((fragment) => fragmentErrors(fragment, root));
  const lines = readFileSync(join(root, LEDGER_FILE), 'utf8').replace(/\n+$/, '').split('\n');
  const head = header(shown);
  if (lines.slice(0, head.length).join('\n') !== head.join('\n')) errors.push(`${LEDGER_FILE}: the text above the table differs from what npm run ledger writes`);
  const rows = lines.slice(head.length);
  const known = new Set(fragments.map(({ text }) => text.trim()));
  const seen = new Set();
  for (const row of rows) {
    if (!known.has(row)) errors.push(`${LEDGER_FILE}: row has no matching file in ${FRAGMENT_DIR}/: ${row.slice(0, 80)}`);
    if (seen.has(row)) errors.push(`${LEDGER_FILE}: row appears twice: ${row.slice(0, 80)}`);
    seen.add(row);
  }
  for (const { file, text } of fragments.slice(0, shown)) {
    if (!seen.has(text.trim())) errors.push(`${LEDGER_FILE}: missing ${FRAGMENT_DIR}/${file}`);
  }
  return errors.length ? [...errors, 'Fix the files in docs/ledger/, then run npm run ledger.'] : [];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--check')) {
    const errors = ledgerErrors();
    for (const error of errors) console.error(error);
    if (errors.length) process.exit(1);
    console.log(`${LEDGER_FILE} matches ${FRAGMENT_DIR}/.`);
  } else if (args.includes('--all')) {
    process.stdout.write(buildLedger(readFragments(), { all: true }));
  } else {
    const fragments = readFragments();
    const errors = fragments.flatMap((fragment) => fragmentErrors(fragment));
    for (const error of errors) console.error(error);
    if (errors.length) process.exit(1);
    writeFileSync(join(REPO, LEDGER_FILE), buildLedger(fragments));
    console.log(`Wrote ${LEDGER_FILE}: ${Math.min(fragments.length, SHOWN)} of ${fragments.length} entries.`);
  }
}
