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

describe('selected choices in Explore, Leaderboard and Profile look selected (F464)', () => {
  const skin = parse(fileURLToPath(new URL('./sections/modals/leaderboard-profile-explore/shared-modal-skin.css', import.meta.url)));
  const selected = skin.find(rule => rule.selectors.includes('#explore-modal .leaderboard-discover-filters .bar-btn.active'))!;
  const tick = skin.find(rule => rule.selectors.includes('#explore-modal .leaderboard-discover-filters .bar-btn.active::before'))!;

  it('frames every selected tab, filter, sort and vote in ink, and ticks the choices', () => {
    expect(selected.selectors).toEqual(expect.arrayContaining([
      '#leaderboard-modal .leaderboard-tabs .bar-btn.active',
      '#leaderboard-modal .leaderboard-difficulty-actions .bar-btn.active',
      '#profile-modal .profile-tabs .bar-btn.active',
    ]));
    expect(declarations(selected)['box-shadow']).toContain('inset 0 0 0 2px var(--wamp-ink)');
    expect(tick.selectors).toContain('#leaderboard-modal .leaderboard-difficulty-actions .bar-btn.active::before');
    // Empty alt text: the tick is seen but not read, since screen readers already hear 'pressed'.
    expect(declarations(tick).content).toBe("'\\2713\\00a0' / ''");
  });

  it('keeps the selected frame on a disabled button and drops the look-alike difficulty rules', () => {
    const disabled = skin.find(rule => rule.selectors.includes('#explore-modal .leaderboard-discover-filters .bar-btn:disabled'))!;
    expect(disabled.source!.start!.line).toBeLessThan(selected.source!.start!.line);
    expect(skin.some(rule => rule.selectors.some(selector => selector.includes('.active[data-explore-difficulty')))).toBe(false);
    expect(skin.some(rule => rule.selectors.includes('#leaderboard-modal .leaderboard-quality-actions .bar-btn.active'))).toBe(false);
  });
});
