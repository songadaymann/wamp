import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postcss, { type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';

const file = fileURLToPath(new URL('./sections/course-editor.css', import.meta.url));
const rules: Rule[] = [];
postcss.parse(readFileSync(file, 'utf8'), { from: file }).walkRules(rule => { rules.push(rule); });
const declarations = (selector: string): Record<string, string> => Object.assign({}, ...rules
  .filter(rule => rule.selectors.includes(selector))
  .map(rule => Object.fromEntries(rule.nodes.flatMap(node => node.type === 'decl' ? [[node.prop, node.value]] : []))));

const phone = "body[data-device-class='phone']";
const landscape = `${phone}[data-orientation-state='landscape']`;

describe('Expanded Room setup sheet keeps every control reachable on phones (F365)', () => {
  it('scrolls the whole sheet under a sticky handle, with the sections in normal flow', () => {
    expect(declarations(`${phone} .course-editor-panel`)).toMatchObject({ 'overflow-y': 'auto' });
    expect(declarations(`${phone} .course-editor-sheet-handle`)).toMatchObject({ position: 'sticky', top: '0' });
    // An inner scroller would shrink to a few pixels under the fixed header rows.
    expect(declarations(`${phone} .course-editor-scroll`)).toMatchObject({ flex: 'none', overflow: 'visible' });
  });

  it('fits the sheet, open or folded, to the visible viewport in both orientations', () => {
    expect(declarations(`${phone} .course-editor-panel`)['max-height']).toContain('var(--course-sheet-viewport)');
    const column = declarations(`${landscape} .course-editor-panel`);
    expect(column.top).not.toBe('auto');
    expect(column.bottom).not.toBe('auto');
    const folded = declarations(`${landscape} .course-editor-panel[data-sheet='collapsed']`);
    expect(folded).toMatchObject({ bottom: 'auto' });
    expect(folded['max-height']).toContain('var(--course-sheet-viewport)');
  });
});
