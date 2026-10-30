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

  it('puts the gestures above the picker on phones, worded for the pointer last used', () => {
    expect(declarations(rulesFor("body[data-device-class='phone'][data-app-mode='editor'] #tileset-section .palette-hint")[0]).order).toBe('-1');
    const [fine] = allRules.filter(rule => rule.selector.endsWith('.fine-pointer-hint'));
    const [coarse] = allRules.filter(rule => rule.selector.endsWith('.coarse-pointer-hint'));
    // A touchscreen laptop gets the touch wording after a tap; a tablet with a trackpad, the mouse one.
    expect(fine.selector).toContain("[data-last-pointer='touch']");
    expect(fine.selector).toContain("[data-coarse-pointer='true']:not([data-last-pointer])");
    expect(coarse.selector).toContain("[data-last-pointer='mouse']");
  });
});

describe('the phone Draw/Erase switch stays on the stage (F369)', () => {
  const shown = allRules.find(rule => rule.selector.endsWith('#editor-phone-draw-switch:not([hidden])') && declarations(rule).position === 'fixed')!;

  it('is phone-only and sits just above the bottom of the stage while the library sheet is hidden', () => {
    expect(declarations(rulesFor('#editor-phone-draw-switch')[0]).display).toBe('none');
    expect(shown.selector.startsWith(`${PHONE_DOCK}[data-mobile-editor-collapsed='true']`)).toBe(true);
    expect(declarations(shown).top)
      .toBe('calc(var(--editor-phone-bar-height) + var(--phone-editor-stage-height) - var(--phone-draw-switch-height, 44px) - 8px)');
  });

  it('steps aside for focused modes that bring their own Cancel or Done, and while hidden under a menu or dialog', () => {
    for (const mode of ['music-mode', 'sprite-mode', 'spawn-placement', 'phone-inspector', 'phone-linking']) {
      expect(shown.selector).toContain(`[data-editor-${mode}='true']`);
    }
    expect(shown.selector).toContain(':not([hidden])');
  });

  it('stands in the empty margin beside the room in landscape', () => {
    const landscape = allRules.find(rule => rule.parent?.type === 'atrule' && (rule.parent as { params?: string }).params === '(orientation: landscape)'
      && rule.selector === `${PHONE_DOCK} #editor-phone-draw-switch`)!;
    expect(declarations(landscape)).toMatchObject({ 'flex-direction': 'column', '--phone-draw-switch-height': '92px' });
  });

  it('keeps 44px touch targets', () => {
    const [button] = rulesFor(`${PHONE_DOCK} #editor-phone-draw-switch > button`);
    expect(declarations(button)).toMatchObject({ 'min-width': '56px', 'min-height': '44px' });
  });
});

describe('the phone dock shows every library button at a glance (F367)', () => {
  const html = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8');
  const grid = html.slice(html.indexOf('<div class="editor-shell-dock-grid">'), html.indexOf('id="editor-markers-popover"'));
  const labels = [...grid.matchAll(/<span>([^<]+)<\/span><\/button>/g)].map(([, label]) => label);
  const px = (value: string) => Number.parseFloat(/(-?[\d.]+)px/.exec(value)![1]);
  const row = declarations(rulesFor(`${PHONE_DOCK} .editor-shell-dock-grid`)[0]);
  const button = declarations(rulesFor(`${PHONE_DOCK} .editor-shell-dock-grid > button`)[0]);

  it('fits Markers and Room Setup on screen from 360px up, without scrolling', () => {
    expect(labels).toEqual(['Terrain', 'Stuff', 'Characters', 'Hazards', 'Deco', 'Markers', 'Room Setup']);
    expect(button.flex).toBe('1 0 auto');
    expect(declarations(rulesFor(`${PHONE_DOCK} .editor-shell-dock-grid > button[data-editor-shell-action='room']`)[0])['flex-shrink']).toBe('1');
    const border = px(rulesFor("body[data-editor-dock-shell='true'] .editor-shell-dock-grid > button")
      .map(declarations).find(values => values.border)!.border);
    // Labels are 10px IBM Plex Mono, 0.6em a character. Room Setup can wrap onto two lines.
    const character = 0.6 * px(button['font-size']);
    const widths = labels.map(label => Math.max(px(button['min-width']),
      Math.max(...(label === 'Room Setup' ? label.split(' ') : [label]).map(word => word.length)) * character
        + 2 * px(button.padding.split(' ')[1]) + 2 * border));
    const rowWidth = widths.reduce((sum, width) => sum + width, 0)
      + (labels.length - 1) * px(row.gap) + 2 * px(row.padding.split(' ')[1]);
    expect(rowWidth).toBeLessThanOrEqual(360);
  });

  it('scrolls only the button row, and fades and points at a side that hides buttons', () => {
    expect(row['overflow-x']).toBe('auto');
    expect(valuesOf(/#editor-shell-dock$/, 'overflow-x')).toEqual([]);
    const cue = (side: 'before' | 'after') => rulesFor(`${PHONE_DOCK} :is(#editor-shell-dock, #editor-phone-tools)[data-scroll-${side}='true']::${side}`)
      .map(declarations).find(values => values.content)!;
    expect(cue('after')).toMatchObject({ content: "'\\25B6' / ''", background: 'linear-gradient(to left, #0b0b0b 12px, transparent)' });
    expect(cue('before')).toMatchObject({ content: "'\\25C0' / ''", background: 'linear-gradient(to right, #0b0b0b 12px, transparent)' });
    // Safari before 17.4 drops the alt-text form, so a plain arrow comes first.
    const contents = (side: 'before' | 'after') => rulesFor(`${PHONE_DOCK} :is(#editor-shell-dock, #editor-phone-tools)[data-scroll-${side}='true']::${side}`)
      .flatMap(rule => rule.nodes.flatMap(node => node.type === 'decl' && node.prop === 'content' ? [node.value] : []));
    expect(contents('after')).toEqual(["'\\25B6'", "'\\25B6' / ''"]);
    expect(contents('before')).toEqual(["'\\25C0'", "'\\25C0' / ''"]);
    // The sheet is already inset from the notch; only the dock's arrows take the safe area.
    const toolRow = (side: 'before' | 'after') => declarations(rulesFor(`${PHONE_DOCK} #editor-phone-tools:is([data-scroll-before='true'], [data-scroll-after='true'])::${side}`)[0]);
    expect(toolRow('before').left).toBe('0');
    expect(toolRow('after').right).toBe('0');
    // A mask on the tool row would also hide the Fill options that open from inside it.
    expect(allRules.filter(rule => declarations(rule)['mask-image'] && /editor-shell-(?:tools|dock-grid)/.test(rule.selector))).toEqual([]);
  });
});
