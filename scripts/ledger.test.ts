import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildLedger, fragmentErrors, ledgerErrors, readFragments } from './ledger.mjs';

const pr = (n: number) => `[#${n}](https://github.com/songadaymann/wamp/pull/${n})`;
const row = (date: string, n: number, summary = 'A thing shipped') =>
  `| ${date} | F${String(n).padStart(3, '0')} | ${pr(n)} | [receipt](docs/review/r.md) | ${summary} |`;

let root = '';
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); root = ''; });

function fixture(entries: Record<string, string>, shown = 2) {
  root = mkdtempSync(join(tmpdir(), 'ledger-'));
  mkdirSync(join(root, 'docs/ledger'), { recursive: true });
  mkdirSync(join(root, 'docs/review'), { recursive: true });
  writeFileSync(join(root, 'docs/review/r.md'), '# Receipt\n');
  for (const [file, text] of Object.entries(entries)) writeFileSync(join(root, 'docs/ledger', file), `${text}\n`);
  writeFileSync(join(root, 'feature-ledger.md'), buildLedger(readFragments(root), { shown }));
  return root;
}

describe('feature ledger', () => {
  it('feature-ledger.md matches the files in docs/ledger/', () => {
    expect(ledgerErrors()).toEqual([]);
  });

  it('lists the newest entries first, ordered by date and then PR number, up to the shown count', () => {
    fixture({ '2026-10-01-a.md': row('2026-10-01', 1), '2026-10-02-z.md': row('2026-10-02', 2), '2026-10-02-b.md': row('2026-10-02', 3) });
    const table = buildLedger(readFragments(root), { shown: 2 }).split('\n').filter((line) => line.startsWith('| 2026'));
    expect(table).toEqual([row('2026-10-02', 3), row('2026-10-02', 2)]);
  });

  it('fails when an entry was added without rebuilding, or a row was typed into the table by hand', () => {
    fixture({ '2026-10-01-a.md': row('2026-10-01', 1) });
    writeFileSync(join(root, 'docs/ledger/2026-10-02-b.md'), `${row('2026-10-02', 2)}\n`);
    expect(ledgerErrors(root, 2).join('\n')).toContain('missing docs/ledger/2026-10-02-b.md');
    writeFileSync(join(root, 'feature-ledger.md'), `${buildLedger(readFragments(root), { shown: 2 })}${row('2026-10-03', 3)}\n`);
    expect(ledgerErrors(root, 2).join('\n')).toContain('row has no matching file');
  });

  it('accepts what a union merge leaves: rows out of order and one extra older row', () => {
    fixture({ '2026-10-01-a.md': row('2026-10-01', 1), '2026-10-02-b.md': row('2026-10-02', 2), '2026-10-03-c.md': row('2026-10-03', 3) });
    const head = buildLedger([], { shown: 2 }).trimEnd();
    writeFileSync(join(root, 'feature-ledger.md'), [head, row('2026-10-02', 2), row('2026-10-03', 3), row('2026-10-01', 1), ''].join('\n'));
    expect(ledgerErrors(root, 2)).toEqual([]);
  });

  it('rejects malformed entries', () => {
    fixture({});
    const errors = (file: string, text: string) => fragmentErrors({ file, text }, root).join('\n');
    expect(errors('2026-10-01_a.md', row('2026-10-01', 1))).toContain('name it');
    expect(errors('2026-10-01-a.md', row('2026-10-02', 1))).toContain('differs from the file name');
    expect(errors('2026-10-01-a.md', row('2026-10-01', 1, 'x'.repeat(121)))).toContain('keep it to 120');
    expect(errors('2026-10-01-a.md', row('2026-10-01', 1).replace('r.md', 'gone.md'))).toContain('does not exist');
    expect(errors('2026-10-01-a.md', row('2026-10-01', 1).replace('pull/1)', 'pull/2)'))).toContain('must be [#N]');
    expect(errors('2026-10-01-a.md', `| 2026-10-01 | — | ${pr(9)}–${pr(3)} | — | Run backwards |`)).toContain('low to high');
    expect(errors('2026-10-01-a.md', `| 2026-10-01 | — | ${pr(3)}–${pr(9)}, ${pr(12)} | — | Fine |`)).toBe('');
  });
});
