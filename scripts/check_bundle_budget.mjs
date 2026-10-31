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
// 2026-10-11: 658 KB after the builder UI moved out of boot, 638 KB after four rarely
// opened pop-ups did (F019).
// 2026-10-23: 663.5 KB (from 668.4) after the developer tools and the bug report form moved
// out (F319). The budget stays at 670 so the waiting dialog work has room.
// 2026-10-31: 672.1 KB after rolling-ball physics and triangle ramp collision joined the
// play scene. Those run before the first frame, so the budget is 673.
const BUDGET_KB = Number(process.env.WAMP_BOOT_JS_BUDGET_KB ?? 673);
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

// Preserve the F019 boundary: changing a menu must not put its controller back
// into boot, and the stable catalogs must not depend on the changing runtime.
const graph = JSON.parse(readFileSync(resolve('output/build/chunk-graph.json'), 'utf8'));
const deferredControllers = ['profileModal', 'leaderboardModal', 'exploreModal', 'historyModal',
  'aboutModal', 'controlsModal', 'guestbookModal', 'playlistModal', 'signTextModal', 'wampOGramModal', 'runRatingModal',
  'chatModerationModal', 'roomRushModal', 'roomRushResultModal', 'firstPublishModal',
  'guestBuilderClaimModal', 'guestRoomRecoveryModal', 'guestProgressClaimModal'];
const bootModules = new Set(graph.filter(chunk => report.files.includes(chunk.file)).flatMap(chunk => chunk.modules));
for (const name of deferredControllers) {
  if (bootModules.has(`src/ui/setup/${name}.ts`)) throw new Error(`${name} has returned to the startup bundle.`);
}
// Developer tools load only when their web-address switch is on, and the bug report form on
// its first Report click (F319). Their switches and window hooks live in src/main/debugTools.ts.
const deferredTools = [/^src\/debug\//, /^src\/main\/resourceDebug\.ts$/, /^src\/bugReports\/(reporter|sender)\./,
  /^src\/analytics\/replay\/player\.ts$/];
for (const module of bootModules) {
  if (deferredTools.some(pattern => pattern.test(module))) throw new Error(`${module} has returned to the startup bundle.`);
}
const roomData = graph.find(chunk => chunk.file.includes('/room-data-'));
if (!roomData || roomData.imports.length || roomData.dynamicImports.length
  || roomData.modules.some(module => /^src\/(ui|scenes)\//.test(module))) {
  throw new Error('Stable room data must stay independent of UI and scene runtime chunks.');
}
console.log(`Deferred menu boundary: ${deferredControllers.length} controllers and the developer tools; stable room data has no runtime chunk imports.`);
