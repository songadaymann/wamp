import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postcss, { type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';

const stylesRoot = fileURLToPath(new URL('./', import.meta.url));
const parse = (file: string): Rule[] => {
  const rules: Rule[] = [];
  postcss.parse(readFileSync(file, 'utf8'), { from: file }).walkRules(rule => { rules.push(rule); });
  return rules;
};
const allRules = readdirSync(stylesRoot, { recursive: true, encoding: 'utf8' })
  .filter(file => file.endsWith('.css')).flatMap(file => parse(`${stylesRoot}${file}`));
const declarations = (rule: Rule): Record<string, string> =>
  Object.fromEntries(rule.nodes.flatMap(node => node.type === 'decl' ? [[node.prop, node.value]] : []));
const rulesFor = (selector: string) => allRules.filter(rule => rule.selectors.includes(selector));

describe('player names show a keyboard focus ring (F477)', () => {
  it('rings a focused name in its own colour, apart from the unchanged hover look', () => {
    const [focus] = rulesFor('.profile-trigger:focus-visible');
    expect(focus.selectors).toEqual(['.profile-trigger:focus-visible']);
    expect(declarations(focus)).toMatchObject({ outline: '2px solid currentColor', 'outline-offset': '2px' });
    expect(declarations(focus).color).toBeUndefined();
    const [hover] = rulesFor('.profile-trigger:hover');
    expect(declarations(hover)).toEqual({ color: 'var(--accent-cool)', 'text-decoration': 'underline' });
  });

  it('lets no player-name rule hide the ring or recolour a focused name', () => {
    const focusRules = allRules.filter(rule => rule.selectors.some(selector =>
      /(?:profile-trigger|explore-room-builder-name|leaderboard-primary|collection-person|chat-message-author)[^,\s]*:focus/.test(selector)));
    expect(focusRules.map(rule => rule.selector)).toContain('.profile-trigger:focus-visible');
    for (const rule of focusRules) {
      expect(declarations(rule).outline, rule.selector).not.toMatch(/^(?:none|0)$/);
      if (rule.selector !== '.profile-trigger:focus-visible') expect(declarations(rule).color, rule.selector).toBeUndefined();
    }
  });
});

