// Keeps each max-lines pin in eslint.config.js at the size of the file it pins, so a file that
// shrank can't quietly grow back (F498). Sizes are counted the way max-lines counts them with
// skipBlankLines: every line that holds more than whitespace, comments included.
//
//   npm run max-lines:pins              list stale pins, exit 1 if there are any
//   npm run max-lines:pins -- --write   lower each pin to its file's size, and delete the pins of
//                                       files at or under the default (MAX_LINES)
//
// scripts/check_max_lines_pins.test.ts runs the same check in `npm test`.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CONFIG_FILE = 'eslint.config.js';
// How far a pin may sit above its file. A small shrink needn't touch eslint.config.js, but a pinned
// file can never regrow by more than this.
export const SLACK = 25;
const REPO = resolve(fileURLToPath(import.meta.url), '../..');
const BLOCK = /(const OVERSIZED_FILE_LINES = \{\n)([\s\S]*?)(\};)/;
const PIN = /^ {2}'([^']+)': (\d+),$/;
// The line breaks ESLint splits SourceCode.lines on.
const LINE_BREAK = /\r\n|[\r\n\u2028\u2029]/u;

export function countLines(text) {
  return text.split(LINE_BREAK).filter((line) => line.trim() !== '').length;
}

export function readPins(configText) {
  const max = Number(configText.match(/^const MAX_LINES = (\d+);$/m)?.[1]);
  const block = configText.match(BLOCK);
  if (!max || !block) throw new Error(`${CONFIG_FILE}: can't find MAX_LINES or OVERSIZED_FILE_LINES`);
  const pins = block[2].split('\n').filter((line) => line.trim() !== '').map((line) => {
    const match = line.match(PIN);
    if (!match) throw new Error(`${CONFIG_FILE}: can't read the pin "${line.trim()}"; write it as  'path': 1234,`);
    return { file: match[1], pin: Number(match[2]) };
  });
  return { max, pins };
}

// Each pin's file size and what the pin should be: the size, never above today's pin, and no pin
// at all (null) once the file is gone or fits the default.
export function plannedPins(root = REPO) {
  const { max, pins } = readPins(readFileSync(join(root, CONFIG_FILE), 'utf8'));
  return {
    max,
    rows: pins.map(({ file, pin }) => {
      const path = join(root, file);
      const size = existsSync(path) ? countLines(readFileSync(path, 'utf8')) : null;
      return { file, pin, size, target: size === null || size <= max ? null : Math.min(pin, size) };
    }),
  };
}

export function pinErrors(root = REPO) {
  const { max, rows } = plannedPins(root);
  const errors = rows.flatMap(({ file, pin, size, target }) => {
    if (size === null) return [`${file} is gone; delete its pin (${pin}).`];
    if (target === null) return [`${file} has ${size} lines, within the ${max} default; delete its pin (${pin}).`];
    return pin > size + SLACK ? [`${file} has ${size} lines but is pinned at ${pin}; lower the pin to ${size}.`] : [];
  });
  return errors.length ? [...errors, 'npm run max-lines:pins -- --write fixes these in eslint.config.js.'] : [];
}

export function writePins(root = REPO) {
  const path = join(root, CONFIG_FILE);
  const { rows } = plannedPins(root);
  const body = rows.filter((row) => row.target !== null).map(({ file, target }) => `  '${file}': ${target},\n`).join('');
  writeFileSync(path, readFileSync(path, 'utf8').replace(BLOCK, (_, open, _old, close) => `${open}${body}${close}`));
  return rows.filter((row) => row.target !== row.pin);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--write')) {
    const changed = writePins();
    for (const { file, pin, target } of changed) console.log(`${file}: ${pin} -> ${target ?? 'no pin'}`);
    console.log(`Wrote ${CONFIG_FILE}: ${changed.length} pin${changed.length === 1 ? '' : 's'} changed.`);
  } else {
    const errors = pinErrors();
    for (const error of errors) console.error(error);
    if (errors.length) process.exit(1);
    console.log(`Every max-lines pin in ${CONFIG_FILE} matches its file.`);
  }
}
