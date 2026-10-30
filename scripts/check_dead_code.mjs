// Fails when knip reports dead code that scripts/dead_code_baseline.txt doesn't already list, so
// the pile can shrink but not grow (F497). It tracks unused files, exports, types, duplicate
// exports and unused dependencies. A finding that has gone never fails the check.
//
//   npm run dead-code:check    exit 1 if knip reports anything new
//   npm run dead-code:shrink   drop fixed findings from the baseline (it never adds any)
//   node scripts/check_dead_code.mjs --rebuild
//                              rewrite the baseline from today's report. Only for a knip upgrade
//                              that changes what it reports; say so in the PR.
//
// npm run dead-code:report still prints knip's full report. scripts/check_dead_code.test.ts
// covers the comparison and IGNORE_REASONS in `npm test`.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BASELINE_FILE = 'scripts/dead_code_baseline.txt';
const REPO = resolve(fileURLToPath(import.meta.url), '../..');
const KNIP_ARGS = ['--include', 'files,exports,types,duplicates,dependencies', '--reporter', 'json',
  '--no-progress', '--no-config-hints', '--no-exit-code'];

// knip's report key, and the kind the baseline calls it.
const KINDS = {
  files: 'file',
  exports: 'export',
  types: 'type',
  duplicates: 'duplicate',
  dependencies: 'dependency',
  devDependencies: 'devDependency',
  optionalPeerDependencies: 'optionalPeerDependency',
};

const EXPORT_FIX = 'delete it if nothing uses it; drop `export` if only its own file does; if code outside the import graph uses it on purpose (a window hook, page.evaluate), tag it /** @public <reason> */';
const DEPENDENCY_FIX = 'npm uninstall it; if it is used where knip can\'t see, add it to ignoreDependencies in knip.json';
const FIXES = {
  file: 'delete it; if something runs or loads it by path, list it under entry in knip.json',
  export: EXPORT_FIX,
  type: EXPORT_FIX,
  duplicate: 'keep one name and point the importers at it; if the alias is on purpose, tag it /** @alias <reason> */',
  dependency: DEPENDENCY_FIX,
  devDependency: DEPENDENCY_FIX,
  optionalPeerDependency: DEPENDENCY_FIX,
};

// Every knip.json entry that hides one of the kinds above, and why.
const TEST_HARNESS = 'test harness: it exports a kit of fakes and helpers for tests, and not every test uses all of it';
export const IGNORE_REASONS = {
  'src/partykit/presenceServer.testHarness.ts': TEST_HARNESS,
  'src/scenes/overworld/worldStreaming.testHarness.ts': TEST_HARNESS,
  'src/ui/setup/sceneCapabilityRegistry.testSupport.ts': TEST_HARNESS,
  'src/mint/roomWalletTestFixtures.ts': TEST_HARNESS,
};

const HEADER = [
  '# Dead code knip reported before npm run dead-code:check began (F497), one finding per line:',
  '# <kind> <file> [<name>]. The check fails on a finding that isn\'t listed here and ignores listed',
  '# ones that are gone; npm run dead-code:shrink drops those. Fix new findings; don\'t add lines.',
];

// Finding key ("export src/a.ts name") -> where it is now ("src/a.ts:12"), for the message.
export function findingsFromReport(report) {
  const findings = new Map();
  for (const issue of report.issues) {
    for (const [type, kind] of Object.entries(KINDS)) {
      for (const item of issue[type] ?? []) {
        // A duplicate is a list of names that share one value.
        const symbols = Array.isArray(item) ? item : [item];
        const name = kind === 'file' ? '' : symbols.map((symbol) => symbol.name).sort().join('|');
        const line = symbols[0]?.line;
        findings.set(name ? `${kind} ${issue.file} ${name}` : `${kind} ${issue.file}`, line ? `${issue.file}:${line}` : issue.file);
      }
    }
  }
  return findings;
}

export function readBaseline(text) {
  return new Set(text.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#')));
}

export function formatBaseline(keys) {
  return [...HEADER, ...[...new Set(keys)].sort(), ''].join('\n');
}

export function compare(findings, baseline) {
  return {
    added: [...findings.keys()].filter((key) => !baseline.has(key)).sort(),
    fixed: [...baseline].filter((key) => !findings.has(key)).sort(),
  };
}

export function countByKind(keys) {
  const counts = {};
  for (const key of keys) {
    const kind = key.split(' ')[0];
    counts[kind] = (counts[kind] ?? 0) + 1;
  }
  const plural = (kind, n) => (n === 1 ? kind : kind.replace(/y$/, 'ie') + 's');
  return Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)).map(([kind, n]) => `${n} ${plural(kind, n)}`).join(', ');
}

export function formatFailure(added, findings) {
  const rows = added.map((key) => {
    const [kind, , name = ''] = key.split(' ');
    return { kind, where: findings.get(key), name };
  });
  // One fix line per distinct fix, labelled with every kind it covers ("export, type").
  const fixes = new Map();
  for (const { kind } of rows) fixes.set(FIXES[kind], [...new Set([...(fixes.get(FIXES[kind]) ?? []), kind])]);
  const labels = [...fixes].map(([fix, kinds]) => ({ label: kinds.join(', '), fix }));
  const width = Math.max(...rows.map((row) => row.kind.length));
  const labelWidth = Math.max(...labels.map(({ label }) => label.length));
  return [
    `dead-code: ${added.length} new knip finding${added.length === 1 ? '' : 's'} not in ${BASELINE_FILE}:`,
    ...rows.map(({ kind, where, name }) => `  ${kind.padEnd(width)}  ${where}  ${name}`.trimEnd()),
    'To fix:',
    ...labels.map(({ label, fix }) => `  ${label.padEnd(labelWidth)}  ${fix}`),
    'Anything ignored in knip.json needs a reason in IGNORE_REASONS (scripts/check_dead_code.mjs). Don\'t add lines to the baseline.',
  ].join('\n');
}

function ignoredEntries(config) {
  return [
    ...[config.ignore ?? []].flat(),
    ...[config.ignoreFiles ?? []].flat(),
    ...Object.keys(config.ignoreIssues ?? {}),
    ...[config.ignoreDependencies ?? []].flat(),
  ].map(String);
}

export function ignoreReasonErrors(config, reasons = IGNORE_REASONS) {
  const entries = new Set(ignoredEntries(config));
  return [
    ...[...entries].filter((entry) => !reasons[entry]?.trim())
      .map((entry) => `knip.json ignores ${entry} with no reason: add one to IGNORE_REASONS in scripts/check_dead_code.mjs`),
    ...Object.keys(reasons).filter((entry) => !entries.has(entry))
      .map((entry) => `IGNORE_REASONS lists ${entry}, which knip.json no longer ignores: delete it`),
  ];
}

function runKnip() {
  const knip = join(REPO, 'node_modules/knip/bin/knip.js');
  const result = spawnSync(process.execPath, [knip, ...KNIP_ARGS], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  try {
    if (result.status === 0) return JSON.parse(result.stdout);
  } catch { /* reported below */ }
  process.stderr.write(result.stderr || result.stdout || String(result.error ?? ''));
  console.error('dead-code: knip did not produce a report.');
  process.exit(2);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const started = performance.now();
  const baselinePath = join(REPO, BASELINE_FILE);
  const reasonErrors = ignoreReasonErrors(JSON.parse(readFileSync(join(REPO, 'knip.json'), 'utf8')));
  const findings = findingsFromReport(runKnip());
  let baseline = readBaseline(existsSync(baselinePath) ? readFileSync(baselinePath, 'utf8') : '');
  if (args.includes('--rebuild') || args.includes('--shrink')) {
    const before = baseline.size;
    baseline = args.includes('--rebuild') ? new Set(findings.keys()) : new Set([...baseline].filter((key) => findings.has(key)));
    writeFileSync(baselinePath, formatBaseline(baseline));
    console.log(`Wrote ${BASELINE_FILE}: ${baseline.size} findings (was ${before}).`);
  }
  const { added, fixed } = compare(findings, baseline);
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  for (const error of reasonErrors) console.error(error);
  if (added.length) console.error(formatFailure(added, findings));
  if (added.length || reasonErrors.length) process.exit(1);
  console.log(`dead-code: nothing new (${baseline.size} known: ${countByKind(baseline)}; ${seconds} s).`);
  if (fixed.length) console.log(`${fixed.length} known finding${fixed.length === 1 ? ' is fixed; npm run dead-code:shrink drops it' : 's are fixed; npm run dead-code:shrink drops them'} from the baseline.`);
}
