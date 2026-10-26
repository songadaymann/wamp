import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { NIGHTLY_GROUPS, SMOKES } from './lib/smokeManifest.mjs';
import { classifySmokeResult } from './lib/smokeReports.mjs';

const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const makeDir = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'wamp-smoke-report-')); directories.push(dir); return dir;
};
const rowsFor = (group: string) => SMOKES.filter((entry) => entry.runs === 'nightly' && entry.group === group)
  .map((entry) => ({ name: entry.name ?? entry.file, file: entry.file, status: 'pass', seconds: 1, tail: '' }));
const writeGroup = (dir: string, group: string, results = rowsFor(group)) => {
  const target = path.join(dir, `nightly-smokes-${group}`); mkdirSync(target, { recursive: true });
  writeFileSync(path.join(target, 'results.json'), JSON.stringify({ group, results }));
};
const report = (dir: string, group = 'all') => spawnSync(process.execPath,
  ['scripts/smoke_nightly.mjs', '--report', dir, '--group', group], { encoding: 'utf8' });

describe('nightly report integrity', () => {
  it('fails when a group has no artifact, including an entirely missing run', () => {
    const dir = makeDir(); expect(report(dir).status).toBe(1);
    for (const group of NIGHTLY_GROUPS.slice(1)) writeGroup(dir, group);
    const result = report(dir); expect(result.status).toBe(1); expect(result.stdout).toContain('No results from: editor.');
  });
  it('accepts a complete night and an explicitly selected single group', () => {
    const dir = makeDir(); writeGroup(dir, 'stack'); expect(report(dir, 'stack').status).toBe(0);
    for (const group of NIGHTLY_GROUPS) writeGroup(dir, group);
    expect(report(dir).status).toBe(0);
  });
  it('fails for an incomplete group rather than reporting a partial set as green', () => {
    const dir = makeDir(); writeGroup(dir, 'stack', rowsFor('stack').slice(1));
    expect(report(dir, 'stack').status).toBe(1);
  });
  it('fails for a timeout, corrupt artifact, or unknown result status', () => {
    const dir = makeDir(); const rows = rowsFor('stack'); rows[0].status = 'timeout';
    writeGroup(dir, 'stack', rows); expect(report(dir, 'stack').status).toBe(1);
    rows[0].status = 'unknown'; writeGroup(dir, 'stack', rows); expect(report(dir, 'stack').status).toBe(1);
    writeFileSync(path.join(dir, 'nightly-smokes-stack/results.json'), '{');
    expect(report(dir, 'stack').status).toBe(1);
  });
});

describe('acknowledged smoke regressions', () => {
  const known = { match: 'The expected old regression', note: 'Tracked product issue' };
  it('matches only the thrown error, never a phrase from earlier diagnostic output', () => {
    expect(classifySmokeResult(1, false, 'AssertionError [ERR_ASSERTION]: The expected old regression\n at test', known)).toBe('known');
    expect(classifySmokeResult(1, false, 'The expected old regression\nError: New failure\n at test', known)).toBe('fail');
    expect(classifySmokeResult(1, false, 'AssertionError: The expected old regression\nError: New failure', known)).toBe('fail');
  });
  it('keeps timeouts, signals, and missing error signatures as failures', () => {
    expect(classifySmokeResult(1, true, 'Error: The expected old regression', known)).toBe('timeout');
    expect(classifySmokeResult(null, false, 'Error: The expected old regression', known)).toBe('fail');
    expect(classifySmokeResult(1, false, 'The expected old regression', known)).toBe('fail');
    expect(classifySmokeResult(0, false, '', known)).toBe('fixed');
  });
});
