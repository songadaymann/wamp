import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postcss, { type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';
import { PHONE_TOOL_SWITCH_RESERVE_PX, toolSwitchClearArea } from './phoneToolSwitchArea';

const stage = { left: 0, top: 48, width: 740, height: 258 };

describe('room left clear of the landscape Draw/Erase switch (F369)', () => {
  it('keeps the whole stage in portrait and off the phone dock', () => {
    expect(toolSwitchClearArea({ left: 0, top: 48, width: 390, height: 742 }, false, null, 390, 742))
      .toEqual({ x: 0, y: 0, width: 390, height: 742 });
  });

  it('reserves the column at the left edge, even while the hidden library sheet hides it', () => {
    expect(toolSwitchClearArea(stage, true, null, 740, 258)).toEqual({ x: 60, y: 0, width: 680, height: 258 });
    // A canvas drawn at twice its CSS size reports the strip in its own pixels.
    expect(toolSwitchClearArea(stage, true, null, 1480, 516)).toEqual({ x: 120, y: 0, width: 1360, height: 516 });
  });

  it('measures a shown column, so a notch inset or larger text widens the reserve', () => {
    const column = { left: 55, top: 206, width: 56, height: 92 };
    expect(toolSwitchClearArea(stage, true, column, 740, 258)).toEqual({ x: 119, y: 0, width: 621, height: 258 });
  });

  it('matches the switch the phone dock draws: 8px from the edge, 44px wide, 8px clear', () => {
    const rules: Rule[] = [];
    postcss.parse(readFileSync(fileURLToPath(new URL('../../styles/sections/responsive/phone-editor-dock.css', import.meta.url)), 'utf8'))
      .walkRules(rule => { rules.push(rule); });
    const value = (selectorEnd: string, prop: string, landscape: boolean) => rules
      .filter(rule => rule.selector.endsWith(selectorEnd)
        && ((rule.parent as { params?: string } | undefined)?.params === '(orientation: landscape)') === landscape)
      .flatMap(rule => rule.nodes.flatMap(node => node.type === 'decl' && node.prop === prop ? [node.value] : []))[0];
    expect(value('#editor-phone-draw-switch:not([hidden])', 'left', false)).toBe('calc(8px + var(--safe-left))');
    expect(value('#editor-phone-draw-switch > button', 'min-width', true)).toBe('44px');
    expect(PHONE_TOOL_SWITCH_RESERVE_PX).toBe(8 + 44 + 8);
  });
});
