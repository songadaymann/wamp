import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The checkup checklists ask whoever ticks an item to update the Progress count by hand.
// This catches a count that disagrees with the ticks, and status notes pushed above the title (F493).
const CHECKLISTS = ['docs/review/wamp-checkup-2026-10.md', 'docs/review/wamp-checkup-round-2.md'];

describe.each(CHECKLISTS)('%s', (path) => {
  const text = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

  it('opens with its title', () => {
    expect(text.split('\n')[0]).toMatch(/^# /);
  });

  it('has a Progress line that matches the ticked items', () => {
    const done = text.match(/^- \[x\] /gm)?.length ?? 0;
    const open = text.match(/^- \[ \] /gm)?.length ?? 0;
    const progress = text.match(/^\*\*Progress: (\d+) of (\d+) done\.\*\*$/m);
    expect(progress?.slice(1).map(Number), 'update "**Progress: N of M done.**" to the ticked count').toEqual([done, done + open]);
  });
});
