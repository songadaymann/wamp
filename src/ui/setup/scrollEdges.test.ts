import { afterEach, describe, expect, it, vi } from 'vitest';
import { hiddenScrollEdges, trackScrollEdges } from './scrollEdges';

describe('phone dock scroll cue (F367)', () => {
  it('reports which side of a sideways row still hides buttons', () => {
    expect(hiddenScrollEdges(0, 390, 390)).toEqual({ before: false, after: false });
    expect(hiddenScrollEdges(0, 358, 320)).toEqual({ before: false, after: true });
    expect(hiddenScrollEdges(19, 358, 320)).toEqual({ before: true, after: true });
    // Browsers can stop a fraction of a pixel short of either end.
    expect(hiddenScrollEdges(37.6, 358, 320)).toEqual({ before: true, after: false });
    expect(hiddenScrollEdges(0.4, 358, 320)).toEqual({ before: false, after: true });
  });

  describe('tracking a row', () => {
    const observed: unknown[] = [];
    let resize: () => void = () => {};
    afterEach(() => { observed.length = 0; });

    function fixture() {
      const scroller = Object.assign(new EventTarget(), {
        scrollLeft: 0, scrollWidth: 358, clientWidth: 320, children: ['terrain', 'room'],
        ownerDocument: { defaultView: { ResizeObserver: class {
          constructor(callback: () => void) { resize = callback; }
          observe(element: unknown) { observed.push(element); }
          disconnect = vi.fn();
        } } },
      });
      const host = { dataset: {} as Record<string, string> };
      const stop = trackScrollEdges(scroller as unknown as HTMLElement, host as unknown as HTMLElement);
      return { scroller, host, stop };
    }

    it('marks the dock as the row scrolls or resizes, and clears the marks on stop', () => {
      const { scroller, host, stop } = fixture();
      expect(host.dataset).toEqual({ scrollBefore: 'false', scrollAfter: 'true' });
      expect(observed).toEqual([scroller, 'terrain', 'room']);
      scroller.scrollLeft = 38;
      scroller.dispatchEvent(new Event('scroll'));
      expect(host.dataset).toEqual({ scrollBefore: 'true', scrollAfter: 'false' });
      scroller.scrollLeft = 0;
      scroller.clientWidth = 390;
      scroller.scrollWidth = 390;
      resize();
      expect(host.dataset).toEqual({ scrollBefore: 'false', scrollAfter: 'false' });
      stop();
      expect(host.dataset).toEqual({});
      scroller.scrollLeft = 38;
      scroller.dispatchEvent(new Event('scroll'));
      expect(host.dataset).toEqual({});
    });
  });
});
