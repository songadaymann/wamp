import { describe, expect, it, vi } from 'vitest';
import { keepHtmlPointerOutsideGame } from './gamePointerBoundary';

describe('HTML pointer boundary', () => {
  it('keeps a button touch from reaching the game without cancelling its native click', () => {
    const stopPropagation = vi.fn(), preventDefault = vi.fn();
    const event = { target: new EventTarget(), stopPropagation, preventDefault };
    keepHtmlPointerOutsideGame(event, new EventTarget());
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('preserves touch starts on the active game canvas', () => {
    const canvas = new EventTarget(), stopPropagation = vi.fn();
    keepHtmlPointerOutsideGame({ target: canvas, stopPropagation }, canvas);
    expect(stopPropagation).not.toHaveBeenCalled();
  });

  it('ignores events without a target', () => {
    const stopPropagation = vi.fn();
    keepHtmlPointerOutsideGame({ target: null, stopPropagation }, new EventTarget());
    expect(stopPropagation).not.toHaveBeenCalled();
  });
});
