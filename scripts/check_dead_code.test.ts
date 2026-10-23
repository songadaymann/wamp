import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BASELINE_FILE, compare, findingsFromReport, formatBaseline, formatFailure, ignoreReasonErrors, readBaseline,
} from './check_dead_code.mjs';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// The shape of `knip --reporter json`, trimmed to what the check reads.
const report = {
  issues: [
    {
      file: 'src/a.ts',
      files: [],
      exports: [{ name: 'helper', line: 3, col: 14, pos: 40 }],
      types: [{ name: 'Shape', line: 9, col: 13, pos: 90 }],
      duplicates: [[{ name: 'second', line: 2, col: 14, pos: 20 }, { name: 'first', line: 1, col: 14, pos: 0 }]],
    },
    { file: 'src/old.ts', files: [{ name: 'src/old.ts' }], exports: [], types: [] },
    { file: 'package.json', devDependencies: [{ name: 'left-pad', line: 40, col: 6, pos: 900 }] },
  ],
};

describe('dead-code check', () => {
  it('keeps the baseline to well-formed findings', () => {
    const lines = [...readBaseline(read(BASELINE_FILE))];
    const wellFormed = /^(?:file \S+|(?:export|type|duplicate|dependency|devDependency|optionalPeerDependency) \S+ \S+)$/;
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.filter((line) => !wellFormed.test(line))).toEqual([]);
  });

  it('gives every knip.json ignore a reason', () => {
    expect(ignoreReasonErrors(JSON.parse(read('knip.json')))).toEqual([]);
  });

  it('keys findings by kind, file and name, so moving code within a file changes nothing', () => {
    expect([...findingsFromReport(report)]).toEqual([
      ['export src/a.ts helper', 'src/a.ts:3'],
      ['type src/a.ts Shape', 'src/a.ts:9'],
      ['duplicate src/a.ts first|second', 'src/a.ts:2'],
      ['file src/old.ts', 'src/old.ts'],
      ['devDependency package.json left-pad', 'package.json:40'],
    ]);
  });

  it('fails on new findings only, never on fixed ones', () => {
    const findings = findingsFromReport(report);
    const baseline = readBaseline(formatBaseline(['type src/a.ts Shape', 'export src/a.ts helper', 'export src/gone.ts removed']));
    expect(compare(findings, baseline)).toEqual({
      added: ['devDependency package.json left-pad', 'duplicate src/a.ts first|second', 'file src/old.ts'],
      fixed: ['export src/gone.ts removed'],
    });
    expect(compare(findings, readBaseline(formatBaseline(findings.keys())))).toEqual({ added: [], fixed: [] });
  });

  it('says where each new finding is and how to fix that kind', () => {
    const message = formatFailure(['export src/a.ts helper', 'file src/old.ts', 'type src/a.ts Shape'], findingsFromReport(report));
    expect(message).toContain('3 new knip findings');
    expect(message).toContain('export  src/a.ts:3  helper');
    expect(message).toContain('export, type  delete it if nothing uses it; drop `export` if only its own file does');
    expect(message).toContain('/** @public <reason> */');
    expect(message).toContain('list it under entry in knip.json');
    expect(message).not.toContain('npm uninstall');
  });

  it('flags a knip.json ignore with no reason, and a reason with no ignore', () => {
    const config = { ignoreIssues: { 'src/harness.ts': ['exports'] }, ignoreDependencies: ['left-pad'] };
    expect(ignoreReasonErrors(config, { 'src/harness.ts': 'test harness', 'src/gone.ts': 'old' })).toEqual([
      'knip.json ignores left-pad with no reason: add one to IGNORE_REASONS in scripts/check_dead_code.mjs',
      'IGNORE_REASONS lists src/gone.ts, which knip.json no longer ignores: delete it',
    ]);
  });
});
