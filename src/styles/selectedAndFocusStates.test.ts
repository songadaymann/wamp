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
const tokens = readFileSync(`${stylesRoot}tokens.css`, 'utf8');
const token = (name: string) => tokens.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6});`, 'i'))![1];
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(at => Number.parseInt(hex.slice(at, at + 2), 16) / 255)
    .map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('player names show a keyboard focus ring (F477)', () => {
  it('rings a focused name in its own colour, and hover leaves a focused name alone', () => {
    const [focus] = rulesFor('.profile-trigger:focus-visible');
    expect(focus.selectors).toEqual(['.profile-trigger:focus-visible']);
    expect(declarations(focus)).toMatchObject({ outline: '2px solid currentColor', 'outline-offset': '2px' });
    expect(declarations(focus).color).toBeUndefined();
    // The mouse hover look is unchanged; it just doesn't apply to a name that has keyboard focus.
    const [hover] = rulesFor('.profile-trigger:hover:not(:where(:focus-visible))');
    expect(declarations(hover)).toEqual({ color: 'var(--accent-cool)', 'text-decoration': 'underline' });
    expect(rulesFor('.profile-trigger:hover')).toEqual([]);
  });

  it('turns a hovered Explore builder name a colour that still reads, ring included', () => {
    const [hover] = rulesFor('#explore-modal .explore-room-builder-name:hover');
    expect(declarations(hover).color).toBe('var(--wamp-green)');
    for (const panel of ['--wamp-paper', '--wamp-cream']) {
      expect(contrast(token('--wamp-green'), token(panel))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('lets no player-name rule hide the ring or recolour a focused name', () => {
    const focusRules = allRules.filter(rule => rule.selectors.some(selector => !selector.includes(':not(')
      && /(?:profile-trigger|explore-room-builder-name|leaderboard-primary|collection-person|chat-message-author)[^,\s]*:focus/.test(selector)));
    expect(focusRules.map(rule => rule.selector)).toContain('.profile-trigger:focus-visible');
    for (const rule of focusRules) {
      expect(declarations(rule).outline, rule.selector).not.toMatch(/^(?:none|0)$/);
      if (rule.selector !== '.profile-trigger:focus-visible') expect(declarations(rule).color, rule.selector).toBeUndefined();
    }
  });
});

describe('selected choices in Explore, Leaderboard and Profile look selected (F464)', () => {
  const skin = parse(fileURLToPath(new URL('./sections/modals/leaderboard-profile-explore/shared-modal-skin.css', import.meta.url)));
  const paperActions = parse(fileURLToPath(new URL('./sections/modals/paper-actions.css', import.meta.url)));
  const find = (selector: string) => skin.find(rule => rule.selectors.includes(selector))!;
  const selected = find('#explore-modal .leaderboard-discover-filters .bar-btn.active');
  const tick = find('#explore-modal .leaderboard-discover-filters .bar-btn.active::before');

  it('frames every selected tab, filter, sort and vote in ink, and ticks the choices', () => {
    expect(selected.selectors).toEqual(expect.arrayContaining([
      '#leaderboard-modal .leaderboard-tabs .bar-btn.active',
      '#leaderboard-modal .leaderboard-difficulty-actions .bar-btn.active',
      '#profile-modal .profile-tabs .bar-btn.active',
    ]));
    expect(declarations(selected)['box-shadow']).toContain('inset 0 0 0 2px var(--wamp-ink)');
    expect(tick.selectors).toContain('#leaderboard-modal .leaderboard-difficulty-actions .bar-btn.active::before');
    // Empty alt text: the tick is seen but not read, since screen readers already hear 'pressed'.
    expect(declarations(tick).content).toBe("'\\2713' / ''");
  });

  it('keeps the tick in the padding, so choosing a button never changes its size', () => {
    expect(declarations(tick)).toMatchObject({ position: 'absolute', left: '2px' });
    for (const host of ['#explore-modal .leaderboard-discover-filters .bar-btn', '#leaderboard-modal .leaderboard-difficulty-actions .bar-btn']) {
      expect(skin.some(rule => rule.selectors.includes(host) && declarations(rule).position === 'relative'), host).toBe(true);
    }
  });

  it('keeps a flat frame on a disabled selected button and drops the look-alike difficulty rules', () => {
    const disabled = find('#explore-modal .leaderboard-discover-filters .bar-btn.active:disabled');
    expect(disabled.selectors).toContain('#leaderboard-modal .leaderboard-difficulty-actions .bar-btn.active:disabled');
    expect(declarations(disabled)['box-shadow']).toBe('inset 0 0 0 2px var(--wamp-ink)');
    const plainDisabled = paperActions.find(rule => rule.selectors.includes('#explore-modal .leaderboard-discover-filters .bar-btn:disabled'))!;
    expect(declarations(plainDisabled)['box-shadow']).toBe('none');
    // The common action sheet loads before the selected-state owner.
    const imports = readFileSync(`${stylesRoot}sections/modals.css`, 'utf8');
    expect(imports.indexOf('paper-actions.css')).toBeLessThan(imports.indexOf('leaderboard-profile-explore.css'));
    expect(skin.some(rule => rule.selectors.some(selector => selector.includes('.active[data-explore-difficulty')))).toBe(false);
    expect(skin.some(rule => rule.selectors.includes('#leaderboard-modal .leaderboard-quality-actions .bar-btn.active'))).toBe(false);
  });
});
