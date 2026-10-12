// Fails when the JavaScript a cold game visit downloads before its first frame grows
// past the startup budget (brotli bytes, as served). Run after `vite build`, which
// writes the list of boot files to output/build/boot-bundle.json.
//
// Raise WAMP_BOOT_JS_BUDGET_KB deliberately, with a note in the commit, when a
// feature really needs the weight; otherwise lazy-load the new code.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';

// 2026-10-10 baseline: 745.7 KB across 14 files. Ratchet down as boot code moves out.
// 2026-10-11: 658 KB after the builder UI moved out of boot (F019).
const BUDGET_KB = Number(process.env.WAMP_BOOT_JS_BUDGET_KB ?? 700);
const report = JSON.parse(readFileSync(resolve('output/build/boot-bundle.json'), 'utf8'));
const rows = report.files.map((file) => {
  const bytes = readFileSync(resolve('dist', file));
  const brotli = brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
  return { file, rawKb: bytes.length / 1024, brotliKb: brotli / 1024 };
}).sort((a, b) => b.brotliKb - a.brotliKb);
const totalKb = rows.reduce((sum, row) => sum + row.brotliKb, 0);
for (const row of rows.slice(0, 8)) {
  console.log(`${row.brotliKb.toFixed(1).padStart(8)} KB br  ${row.rawKb.toFixed(0).padStart(6)} KB  ${row.file}`);
}
console.log(`Boot JavaScript: ${totalKb.toFixed(1)} KB brotli across ${rows.length} files (budget ${BUDGET_KB} KB).`);
if (totalKb > BUDGET_KB) {
  console.error(`Boot JavaScript is over budget by ${(totalKb - BUDGET_KB).toFixed(1)} KB. Lazy-load the new code, or raise WAMP_BOOT_JS_BUDGET_KB on purpose.`);
  process.exit(1);
}
