// Parse styles with Stylelint, then enforce reviewed per-file important ceilings
// and named stacking roles. Existing warnings stay visible without flooding CI.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import stylelint from 'stylelint';
import postcss from 'postcss';

const root = fileURLToPath(new URL('../', import.meta.url));
const budget = JSON.parse(await fs.readFile(new URL('./style-cascade-budget.json', import.meta.url), 'utf8'));
const tokenSource = await fs.readFile(path.join(root, 'src/styles/tokens.css'), 'utf8');
const tokens = new Map([...tokenSource.matchAll(/(--z-[\w-]+):\s*(-?\d+);/g)]
  .map(([, name, value]) => [name, Number(value)]));
const errors = [];
const layerNames = ['base', 'components', 'editor-skin', 'responsive', 'overrides'];
const layerOrder = `@layer ${layerNames.join(', ')};`;
for (const file of ['main.css', 'editor-bundle.css']) {
  const source = (await fs.readFile(path.join(root, 'src/styles', file), 'utf8'))
    .replace(/\/\*[\s\S]*?\*\//g, '');
  if (!source.trimStart().startsWith(layerOrder)) {
    errors.push(`${file}: declare the shared cascade order before imports.`);
  }
}
function layerOwner(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.type === 'atrule' && parent.name === 'layer') return parent.params;
  }
  return null;
}
for (const [lower, upper] of [
  ['world-ui', 'hud'], ['hud', 'drawer'], ['drawer', 'modal'], ['modal', 'toast'], ['toast', 'critical'],
]) {
  if (!(tokens.get(`--z-${lower}`) < tokens.get(`--z-${upper}`))) {
    errors.push(`Stacking roles must keep --z-${lower} below --z-${upper}.`);
  }
}

const lint = await stylelint.lint({
  files: 'src/styles/**/*.css',
  cwd: root,
  configFile: path.join(root, 'stylelint.config.mjs'),
  ignoreDisables: true,
});
const seen = new Set();
let importantCount = 0;
for (const result of lint.results) {
  const file = path.relative(root, result.source).split(path.sep).join('/');
  seen.add(file);
  const important = result.warnings.filter(warning => warning.rule === 'declaration-no-important');
  importantCount += important.length;
  const ceiling = budget.important[file] ?? 0;
  if (important.length > ceiling) {
    errors.push(`${file}: ${important.length} !important warnings exceed the reviewed ceiling of ${ceiling}.`);
    for (const warning of important) errors.push(`${file}:${warning.line}:${warning.column}: ${warning.text}`);
  } else if (important.length < ceiling) {
    errors.push(`${file}: lower its !important ceiling from ${ceiling} to ${important.length}.`);
  }
  for (const warning of result.warnings.filter(warning => warning.rule !== 'declaration-no-important')) {
    errors.push(`${file}:${warning.line}:${warning.column}: ${warning.text}`);
  }
  if (result.invalidOptionWarnings.length || result.parseErrors.length) {
    errors.push(`${file}: invalid stylesheet or Stylelint configuration.`);
  }
  const rawSource = await fs.readFile(result.source, 'utf8');
  let ast;
  try {
    ast = postcss.parse(rawSource, { from: result.source });
  } catch (error) {
    errors.push(`${file}: ${error.reason || 'Invalid CSS syntax'}.`);
    continue;
  }
  ast.walkAtRules('layer', node => {
    const names = node.params.split(',').map(name => name.trim());
    if (names.some(name => !layerNames.includes(name)) || (node.nodes && names.length !== 1)) {
      errors.push(`${file}:${node.source.start.line}: use a defined cascade owner.`);
    }
    if (layerOwner(node)) errors.push(`${file}:${node.source.start.line}: keep named owners at the root layer level.`);
  });
  const imports = [];
  ast.walkAtRules('import', node => {
    const specifier = /^['"]([^'"]+\.css)['"]$/.exec(node.params)?.[1];
    if (!specifier) {
      errors.push(`${file}:${node.source.start.line}: import local styles; each rule declares its own layer.`);
      return;
    }
    const target = path.resolve(path.dirname(result.source), specifier);
    const relative = path.relative(path.join(root, 'src/styles'), target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      errors.push(`${file}:${node.source.start.line}: keep imports inside the checked styles directory.`);
    } else imports.push({ target, line: node.source.start.line });
  });
  for (const { target, line } of imports) {
    try {
      await fs.access(target);
    } catch {
      errors.push(`${file}:${line}: imported stylesheet is missing.`);
    }
  }
  ast.walkRules(node => {
    const owner = layerOwner(node);
    if (!layerNames.includes(owner)) errors.push(`${file}:${node.source.start.line}: rule needs a named cascade owner.`);
    if (/data-device-class|data-orientation-state|data-coarse-pointer|data-mobile-touch-play-layout/.test(node.selector)
      && !['components', 'editor-skin', 'responsive', 'overrides'].includes(owner)) {
      errors.push(`${file}:${node.source.start.line}: device adaptations need a component, skin or responsive owner.`);
    }
  });
  ast.walkDecls(node => {
    if (!layerNames.includes(layerOwner(node))) errors.push(`${file}:${node.source.start.line}: declaration needs a named cascade owner.`);
  });
  ast.walkAtRules(node => {
    if (['media', 'supports', 'container'].includes(node.name) && !['components', 'editor-skin', 'responsive', 'overrides'].includes(layerOwner(node))) {
      errors.push(`${file}:${node.source.start.line}: conditional adaptations need a component, skin or responsive owner.`);
    }
  });
  const source = rawSource
    .replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '))
    .replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, match => match.replace(/[^\n]/g, ' '));
  if (/box-shadow\s*:[^;{}]*inset\s+0\s+0\s+0\s+999px/.test(source)) {
    errors.push(`${file}: put the control's fill in its background instead of an inset paint-over shadow.`);
  }
  for (const match of source.matchAll(/(?:^|[;{])\s*z-index\s*:\s*([^;}]+)/g)) {
    const value = match[1].trim();
    const name = /^var\((--z-[\w-]+)\)$/.exec(value)?.[1];
    if (value !== 'auto' && (!name || !tokens.has(name))) {
      errors.push(`${file}:${source.slice(0, match.index).split('\n').length}: use a defined --z- role for z-index.`);
    }
  }
}
for (const file of Object.keys(budget.important)) {
  if (!seen.has(file)) errors.push(`${file}: remove the obsolete !important ceiling.`);
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Cascade checks OK: ${lint.results.length} CSS files; ${importantCount} existing !important warnings within reviewed ceilings; named stacking roles enforced.`);
}
