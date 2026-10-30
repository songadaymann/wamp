import { describe, expect, it } from 'vitest';
import { shouldDismissColorPopover } from './colorPopover';

function node(inside: Set<unknown> = new Set()) {
  const element = {
    nodeType: 1,
    classList: { contains: (name: string) => name === 'hidden' && (element as { hidden?: boolean }).hidden === true },
    contains: (candidate: unknown) => candidate === element || inside.has(candidate),
    hidden: false,
  };
  return element as unknown as HTMLElement;
}

describe('triangle color popover dismiss', () => {
  it('closes for clicks outside the modal and keeps clicks on the picker or its swatch', () => {
    const inside = node();
    const popover = node(new Set([inside]));
    const swatch = node();
    expect(shouldDismissColorPopover(node(), popover, swatch)).toBe(true);
    expect(shouldDismissColorPopover(inside, popover, swatch)).toBe(false);
    expect(shouldDismissColorPopover(popover, popover, swatch)).toBe(false);
    expect(shouldDismissColorPopover(swatch, popover, swatch)).toBe(false);
    popover.classList.contains = () => true;
    expect(shouldDismissColorPopover(node(), popover, swatch)).toBe(false);
  });
});
