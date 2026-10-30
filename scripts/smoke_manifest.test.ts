import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NIGHTLY_GROUPS, SMOKES } from './lib/smokeManifest.mjs';

type Entry = { file: string; name?: string; runs: string; group?: string; why?: string; knownIssue?: { match: string } };
const smokes = SMOKES as Entry[];
const groups = NIGHTLY_GROUPS as string[];
const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const scriptFiles = readdirSync(new URL('./', import.meta.url)).filter((name) => /\.(mjs|ts|js)$/.test(name) && !name.includes('.test.'));
const libFiles = readdirSync(new URL('./lib/', import.meta.url)).filter((name) => name.endsWith('.mjs')).map((name) => `lib/${name}`);
// The CI harness, the nightly runner and a probe's helper module are not smokes themselves.
const NOT_SMOKES = new Set(['mobile_smoke_ci.mjs', 'smoke_nightly.mjs', 'overworld_tile_pyramid_probe_helpers.mjs']);
// What the pull-request checks run: quality.yml, the smoke:* npm scripts it calls, and the CI harness.
const quality = read('.github/workflows/quality.yml');
const npmScripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts;
const prChecks = [quality, read('scripts/mobile_smoke_ci.mjs'),
  ...[...quality.matchAll(/npm run (smoke:[\w:-]+)/g)].map((match) => npmScripts[match[1]] ?? '')].join('\n');
const nightlyWorkflow = read('.github/workflows/nightly-smokes.yml');

describe('smoke manifest (F480)', () => {
  it('lists every smoke and probe script exactly once, and nothing that is gone', () => {
    const smokeNamed = scriptFiles.filter((name) => /smoke|probe|_trace\.|load_test|rollout_check/.test(name) && !NOT_SMOKES.has(name));
    const listedFiles = new Set(smokes.map((entry) => entry.file));
    expect([...listedFiles].sort()).toEqual(smokeNamed.sort());
    const names = smokes.map((entry) => entry.name ?? entry.file);
    expect(new Set(names).size).toBe(names.length);
  });

  it('keeps every Playwright script muted', () => {
    const unmuted = [...scriptFiles, ...libFiles]
      .filter((name) => name !== 'lib/mutedBrowsers.mjs')
      .filter((name) => /from ['"]playwright['"]/.test(read(`scripts/${name}`)))
      .filter((name) => !/import ['"]\.\.?\/(lib\/)?mutedBrowsers\.mjs['"]/.test(read(`scripts/${name}`)));
    expect(unmuted).toEqual([]);
  });

  it('matches the pull-request checks: ci entries run there and nothing else does', () => {
    for (const entry of smokes) {
      expect(prChecks.includes(entry.file), `${entry.file} is ${entry.runs}`).toBe(entry.runs === 'ci');
    }
  });

  it('gives every nightly entry a group the nightly workflow runs, and every manual entry a reason', () => {
    const matrix = nightlyWorkflow.match(/group: \$\{\{ fromJSON\(.*'(\[[^']+\])'\) \}\}/)?.[1];
    const choices = nightlyWorkflow.match(/options: \[all, ([^\]]+)\]/)?.[1];
    expect(JSON.parse(matrix ?? '[]')).toEqual(groups);
    expect(choices?.split(', ')).toEqual(groups);
    for (const entry of smokes) {
      if (entry.runs === 'nightly') expect(groups, entry.file).toContain(entry.group);
      else expect(entry.group, entry.file).toBeUndefined();
      if (entry.runs === 'manual') expect(entry.why, entry.file).toBeTruthy();
      if (entry.knownIssue) expect(entry.knownIssue.match.length, entry.file).toBeGreaterThan(10);
    }
  });

  it('labels each developer tool in its header so nobody mistakes it for a check', () => {
    for (const entry of smokes.filter((candidate) => candidate.runs === 'devtool')) {
      expect(read(`scripts/${entry.file}`).split('\n').slice(0, 6).join('\n'), entry.file).toMatch(/Developer tool/);
    }
  });
});
