import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postcss, { type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';

const stylesRoot = fileURLToPath(new URL('./', import.meta.url));
const allRules: Rule[] = readdirSync(stylesRoot, { recursive: true, encoding: 'utf8' })
  .filter(file => file.endsWith('.css'))
  .flatMap(file => {
    const rules: Rule[] = [];
    postcss.parse(readFileSync(`${stylesRoot}${file}`, 'utf8'), { from: file }).walkRules(rule => { rules.push(rule); });
    return rules;
  });
const declarations = (rule: Rule): Record<string, string> =>
  Object.fromEntries(rule.nodes.flatMap(node => node.type === 'decl' ? [[node.prop, node.value]] : []));
const rulesFor = (selector: string) => allRules.filter(rule => rule.selectors.includes(selector));
/** Every declaration of a property on rules whose selectors end with the target. */
const valuesOf = (target: RegExp, property: string) => allRules
  .filter(rule => rule.selectors.some(selector => target.test(selector)))
  .flatMap(rule => rule.nodes.flatMap(node => node.type === 'decl' && node.prop === property ? [`${rule.selector} { ${node.value} }`] : []));
const PHONE_DOCK = "body[data-device-class='phone'][data-app-mode='editor'][data-editor-dock-shell='true']";

describe('the phone tileset picker scrolls by touch (F368)', () => {
  it('lets swipes on the picker pan either way while the room canvas keeps its own pinch and pan', () => {
    expect(declarations(rulesFor('#palette-canvas')[0])['touch-action']).toBe('pan-x pan-y');
    expect(valuesOf(/#palette-canvas$/, 'touch-action')).toEqual(['#palette-canvas { pan-x pan-y }']);
    expect(declarations(rulesFor("body[data-coarse-pointer='true'] #game-container canvas")[0])['touch-action']).toBe('none');
    // A long press selects tiles, so it must not open the iOS image callout.
    expect(declarations(rulesFor('#palette-canvas')[0])['-webkit-touch-callout']).toBe('none');
  });

  it('shows the whole tileset in the scrolling sheet instead of a short nested box', () => {
    expect(valuesOf(/#palette-container$/, 'max-height')).toEqual([]);
    const [phone] = rulesFor("body[data-device-class='phone'][data-app-mode='editor'] #palette-container");
    expect(declarations(phone)).toMatchObject({ 'overflow-x': 'auto' });
    const [sheet] = rulesFor("body[data-editor-dock-shell='true'] #editor-sidebar-scroll")
      .filter(rule => declarations(rule)['overflow-y']);
    expect(declarations(sheet)['overflow-y']).toBe('auto');
  });

  it('keeps the tileset section from shrinking under Tile Controls in the phone sheet', () => {
    expect(declarations(rulesFor(`${PHONE_DOCK} #tileset-section`)[0]).flex).toBe('0 0 auto');
  });
});
