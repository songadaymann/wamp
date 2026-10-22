import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  OverworldConnectionNoticeController,
  SEAM_WAIT_NOTICE_DELAY_MS,
  SEAM_WAIT_SLOW_NOTICE_DELAY_MS,
  resolveConnectionNotice,
} from './connectionNotice';

describe('connection notice text', () => {
  it('stays silent for a short seam hold while online', () => {
    expect(resolveConnectionNotice({ online: true, seamWaitMs: null })).toBeNull();
    expect(resolveConnectionNotice({ online: true, seamWaitMs: SEAM_WAIT_NOTICE_DELAY_MS - 1 })).toBeNull();
  });

  it('explains a seam hold that lasts past the delay, then a slow one', () => {
    expect(resolveConnectionNotice({ online: true, seamWaitMs: SEAM_WAIT_NOTICE_DELAY_MS })).toEqual({
      tone: 'loading',
      text: 'Loading next room…',
    });
    expect(resolveConnectionNotice({ online: true, seamWaitMs: SEAM_WAIT_SLOW_NOTICE_DELAY_MS })?.text)
      .toBe('Still loading the next room. Retrying…');
  });

  it('says the player is offline, and why a seam holds while offline', () => {
    expect(resolveConnectionNotice({ online: false, seamWaitMs: null })).toEqual({
      tone: 'offline',
      text: 'Offline. New rooms load when you reconnect.',
    });
    expect(resolveConnectionNotice({ online: false, seamWaitMs: SEAM_WAIT_NOTICE_DELAY_MS })?.text)
      .toBe('No connection. The next room loads when you reconnect.');
  });
});

describe('connection notice controller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function fixture(onLine = true) {
    const classes = new Set(['hidden']);
    const element = {
      textContent: '' as string | null,
      dataset: {} as Record<string, string | undefined>,
      classList: {
        toggle: (name: string, force?: boolean) => {
          if (force) classes.add(name);
          else classes.delete(name);
          return Boolean(force);
        },
      },
    };
    const events = new EventTarget();
    const win = {
      navigator: { onLine },
      addEventListener: (type: 'online' | 'offline', listener: () => void) => events.addEventListener(type, listener),
      removeEventListener: (type: 'online' | 'offline', listener: () => void) => events.removeEventListener(type, listener),
      setTimeout: (handler: () => void, timeout: number) => setTimeout(handler, timeout) as unknown as number,
      clearTimeout: (id: number) => clearTimeout(id),
    };
    const onOnline = vi.fn();
    const controller = new OverworldConnectionNoticeController({
      onOnline,
      win,
      doc: { getElementById: (id: string) => (id === 'play-connection-notice' ? element : null) },
    });
    controller.start();
    return {
      controller,
      element,
      onOnline,
      visible: () => !classes.has('hidden'),
      fire: (type: 'online' | 'offline') => events.dispatchEvent(new Event(type)),
    };
  }

  it('shows the loading notice only after the seam hold lasts 600 ms', () => {
    const { controller, element, visible } = fixture();

    controller.setSeamWaiting(true);
    vi.advanceTimersByTime(SEAM_WAIT_NOTICE_DELAY_MS - 1);
    expect(visible()).toBe(false);

    vi.advanceTimersByTime(1);
    expect(visible()).toBe(true);
    expect(element.textContent).toBe('Loading next room…');
    expect(element.dataset.tone).toBe('loading');

    vi.advanceTimersByTime(SEAM_WAIT_SLOW_NOTICE_DELAY_MS);
    expect(element.textContent).toBe('Still loading the next room. Retrying…');
  });

  it('hides at once when the room becomes ready and restarts the delay next time', () => {
    const { controller, visible } = fixture();
    controller.setSeamWaiting(true);
    vi.advanceTimersByTime(SEAM_WAIT_NOTICE_DELAY_MS);

    controller.setSeamWaiting(false);
    expect(visible()).toBe(false);

    controller.setSeamWaiting(true);
    vi.advanceTimersByTime(SEAM_WAIT_NOTICE_DELAY_MS - 1);
    expect(visible()).toBe(false);
  });

  it('ignores repeated waiting signals within one hold', () => {
    const { controller, visible } = fixture();
    controller.setSeamWaiting(true);
    vi.advanceTimersByTime(SEAM_WAIT_NOTICE_DELAY_MS - 100);
    controller.setSeamWaiting(true);
    vi.advanceTimersByTime(100);

    expect(visible()).toBe(true);
  });

  it('tracks offline and online events and retries streaming on reconnect', () => {
    const { element, fire, onOnline, visible } = fixture();

    fire('offline');
    expect(visible()).toBe(true);
    expect(element.dataset.tone).toBe('offline');
    expect(onOnline).not.toHaveBeenCalled();

    fire('online');
    expect(visible()).toBe(false);
    expect(onOnline).toHaveBeenCalledOnce();
  });

  it('starts from the browser offline state and detaches on destroy', () => {
    const { controller, fire, onOnline, visible } = fixture(false);
    expect(visible()).toBe(true);

    controller.destroy();
    expect(visible()).toBe(false);
    fire('online');
    expect(onOnline).not.toHaveBeenCalled();
  });
});
