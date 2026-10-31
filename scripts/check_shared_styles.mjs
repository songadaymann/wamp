// Keep the shared UI palette and exact font stacks in one place (F113).
// Specialty colors and different fallback stacks remain with their owning surface.
import fs from 'node:fs/promises';
import postcss from 'postcss';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../src/styles/', import.meta.url));
const tokenFile = path.join(root, 'tokens.css');
const tokens = await fs.readFile(tokenFile, 'utf8');
const withoutComments = source => source.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '));
// Ignore strings, including data URLs, while keeping offsets for diagnostics.
const withoutStrings = source => source.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, match => match.replace(/[^\n]/g, ' '));
const normalizeFont = value => value.replace(/["']/g, '').replace(/\s+/g, ' ').replace(/\s*,\s*/g, ',').trim().toLowerCase();
const normalizeHex = value => {
  const hex = value.slice(1).toLowerCase();
  return hex.length === 3 ? [...hex].map(c => c + c).join('') : hex;
};
const palette = new Map([...tokens.matchAll(/(--wamp-[\w-]+):\s*(#[a-f\d]+);/gi)]
  .map(([, name, hex]) => [normalizeHex(hex), name]));
const fonts = new Map([...tokens.matchAll(/(--font-[\w-]+):\s*([^;]+);/g)]
  .filter(([, , stack]) => !stack.trim().startsWith('var('))
  .map(([, name, stack]) => [normalizeFont(stack), name]));
const sharedNames = new Set([...tokens.matchAll(/(--(?:wamp|font|shadow|z)-[\w-]+):/g)].map(([, name]) => name));
const errors = [];
let checked = 0;
function report(file, source, index, message) {
  errors.push(`${path.relative(path.dirname(root), file)}:${source.slice(0, index).split('\n').length}: ${message}`);
}


// Modal skin defaults live on the shared classes. Layout and intentional visual
// variants remain local; copying a default back under a dialog ID is rejected.
const modalDefaults = new Map();
for (const file of ['sections/modals/room-course.css', 'sections/modals/history.css']) {
  postcss.parse(await fs.readFile(path.join(root, file), 'utf8')).walkRules(rule => {
    if (/^\.history-modal-(panel|title|kicker|meta|error)$/.test(rule.selector)) {
      modalDefaults.set(rule.selector, new Map(rule.nodes.filter(n => n.type === 'decl')
        .map(d => [d.prop, d.value.replace(/\s+/g, '')])));
    }
  });
}
function checkModalSkin(file, source) {
  postcss.parse(source).walkRules(rule => {
    for (const selector of rule.selectors) {
      const match = selector.match(/#(?:[\w-]+-modal|mobile-jump-sheet)\s+(\.history-modal-(?:panel|title|kicker|meta|error))$/);
      if (!match) continue;
      for (const decl of rule.nodes.filter(n => n.type === 'decl')) {
        if (!/^(?:--|color$|background|border|box-shadow$|font|line-height$|letter-spacing$|text-transform$|-webkit-font-smoothing$)/.test(decl.prop)) continue;
        if (modalDefaults.get(match[1])?.get(decl.prop) === decl.value.replace(/\s+/g, '')) {
          report(file, source, decl.source.start.offset, 'Use the shared ' + match[1] + ' skin; keep only layout or intentional variants here.');
        }
      }
    }
  });
}

async function checkDirectory(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) { await checkDirectory(file); continue; }
    if (!entry.name.endsWith('.css') || file === tokenFile) continue;
    checked++;
    const source = withoutComments(await fs.readFile(file, 'utf8'));
    checkModalSkin(file, source);
    const values = withoutStrings(source);
    for (const match of values.matchAll(/#[a-f\d]{3,8}\b/gi)) {
      const token = palette.get(normalizeHex(match[0]));
      if (token) report(file, source, match.index, `Use var(${token}) instead of ${match[0]}.`);
    }
    for (const match of values.matchAll(/rgba?\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)(?=\s*[,/)])/gi)) {
      const hex = match.slice(1).map(v => Number(v).toString(16).padStart(2, '0')).join('');
      const token = palette.get(hex);
      if (token) report(file, source, match.index, `Use var(${token}-rgb) for shared RGB channels.`);
    }
    for (const match of source.matchAll(/(?:font(?:-family)?|--[\w-]*font)\s*:\s*([^;{}]+)/g)) {
      const value = normalizeFont(match[1].replace(/\s*!important\s*$/, ''));
      const token = [...fonts].find(([stack]) => value === stack || value.endsWith(` ${stack}`))?.[1];
      if (token) report(file, source, match.index, `Use var(${token}) for this font stack.`);
    }
    for (const match of values.matchAll(/(--(?:wamp|font|shadow|z)-[\w-]+)\s*:/g)) {
      if (sharedNames.has(match[1])) report(file, source, match.index, `Define ${match[1]} only in tokens.css.`);
    }
  }
}

const main = await fs.readFile(path.join(root, 'main.css'), 'utf8');
if (!/^@layer base, components, editor-skin, responsive, overrides;\s*@import '\.\/tokens\.css';/.test(withoutComments(main).trimStart())) errors.push('styles/main.css: Import tokens.css first.');
await checkDirectory(root);
const reporterFile = path.join(root, '../bugReports/reporter.css');
checkModalSkin(reporterFile, withoutComments(await fs.readFile(reporterFile, 'utf8')));
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Shared styles OK: ${checked} CSS files use the central palette and font stacks.`);
}
