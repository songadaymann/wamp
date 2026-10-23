import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Linter } from 'eslint';
import { afterEach, describe, expect, it } from 'vitest';
import eslintConfig from '../eslint.config.js';
import { CONFIG_FILE, countLines, pinErrors, readPins, writePins } from './check_max_lines_pins.mjs';

type Config = { files?: string[]; rules?: Record<string, unknown> };

let root = '';
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); root = ''; });

// A fixture repo with MAX_LINES = 10, the given pins, and files of the given non-blank sizes.
function fixture(pins: Record<string, number>, sizes: Record<string, number>) {
  root = mkdtempSync(join(tmpdir(), 'max-lines-'));
  const pinLines = Object.entries(pins).map(([file, pin]) => `  '${file}': ${pin},`);
  writeFileSync(join(root, CONFIG_FILE), ['const MAX_LINES = 10;', 'const OVERSIZED_FILE_LINES = {', ...pinLines, '};', 'export default [];', ''].join('\n'));
  for (const [file, size] of Object.entries(sizes)) {
    writeFileSync(join(root, file), `${Array.from({ length: size }, (_, i) => `const v${i} = ${i};`).join('\n\n')}\n`);
  }
  return root;
}

describe('max-lines pins', () => {
  it('pins every oversized file at exactly its size', () => {
    expect(pinErrors()).toEqual([]);
  });

  it('counts lines the way the max-lines rule does with skipBlankLines', () => {
    const sample = `${['const a = 1;', '', '   ', '\t', '// a comment', '/* a block', '', ' */', 'const b = 2;'].join('\r\n')}\u2028const c = 3;\n\n`;
    const linter = new Linter();
    const overLimit = (max: number) => linter.verify(sample, [{ rules: { 'max-lines': ['error', { max, skipBlankLines: true }] } }])
      .filter((message) => message.ruleId === 'max-lines');
    expect(countLines(sample)).toBe(6);
    expect(overLimit(6)).toEqual([]);
    expect(overLimit(5)).toHaveLength(1);
  });

  it('reads the same pins and options ESLint applies', () => {
    const { max, pins } = readPins(readFileSync(new URL(`../${CONFIG_FILE}`, import.meta.url), 'utf8'));
    const settings = (eslintConfig as Config[]).flatMap(({ files, rules }) => {
      const setting = rules?.['max-lines'];
      return setting && setting !== 'off' ? [{ files, setting }] : [];
    });
    expect(settings).toEqual([
      { files: expect.any(Array), setting: ['error', { max, skipBlankLines: true }] },
      ...pins.map(({ file, pin }) => ({ files: [file], setting: ['error', { max: pin, skipBlankLines: true }] })),
    ]);
  });

  it('lowers stale pins, never raises one, and deletes pins the default covers', () => {
    fixture({ 'shrank.ts': 40, 'grew.ts': 45, 'exact.ts': 20, 'small.ts': 12, 'gone.ts': 30 }, { 'shrank.ts': 30, 'grew.ts': 50, 'exact.ts': 20, 'small.ts': 8 });
    expect(pinErrors(root)).toEqual([
      'shrank.ts has 30 lines but is pinned at 40; lower the pin to 30.',
      'small.ts has 8 lines, within the 10 default; delete its pin (12).',
      'gone.ts is gone; delete its pin (30).',
      'npm run max-lines:pins -- --write fixes these in eslint.config.js.',
    ]);
    writePins(root);
    expect(readPins(readFileSync(join(root, CONFIG_FILE), 'utf8')).pins).toEqual([
      { file: 'shrank.ts', pin: 30 },
      { file: 'grew.ts', pin: 45 },
      { file: 'exact.ts', pin: 20 },
    ]);
    expect(pinErrors(root)).toEqual([]);
  });

  it('refuses a pin line it cannot read rather than skipping it', () => {
    expect(() => readPins("const MAX_LINES = 10;\nconst OVERSIZED_FILE_LINES = {\n  'a.ts': 12, // big\n};\n")).toThrow("can't read the pin");
  });
});
