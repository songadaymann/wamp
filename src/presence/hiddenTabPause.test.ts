import { afterEach, describe, expect, it, vi } from 'vitest';

const sockets = vi.hoisted(() => [] as Array<{ room: string; closed: boolean }>);
vi.mock('partysocket', () => {
  class FakePartySocket {
    static OPEN = 1;
    readyState = 0;
    closed = false;
    room: string;
    constructor(options: { room: string }) {
      this.room = options.room;
      sockets.push(this);
    }
    addEventListener(): void {}
    send(): void {}
    close(): void { this.closed = true; }
  }
  return { default: FakePartySocket };
});

import { HIDDEN_TAB_PAUSE_DELAY_MS, installHiddenTabPause } from './hiddenTabPause';
import { WorldRoomChatClient } from './roomChat';
import { WorldPresenceClient } from './worldPresence';

class FakeDocument extends EventTarget {
  hidden = false;
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.dispatchEvent(new Event('visibilitychange'));
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  sockets.length = 0;
});

describe('hidden-tab pause (F095)', () => {
  it('pauses only after the tab stays hidden for the delay, and resumes when visible', () => {
    vi.useFakeTimers();
    const doc = new FakeDocument();
    const pause = vi.fn();
    const resume = vi.fn();
    installHiddenTabPause(pause, resume, 30_000, doc as unknown as Document);
    doc.setHidden(true);
    vi.advanceTimersByTime(29_000);
    doc.setHidden(false);
    vi.advanceTimersByTime(60_000);
    expect(pause).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
    doc.setHidden(true);
    vi.advanceTimersByTime(30_000);
    expect(pause).toHaveBeenCalledTimes(1);
    doc.setHidden(false);
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['presence', (onSnapshot: () => void) => new WorldPresenceClient({ host: 'h', protocol: 'wss', party: 'main', identity: { userId: 'u' } as never, onSnapshot })],
    ['room chat', (onSnapshot: () => void) => new WorldRoomChatClient({ host: 'h', protocol: 'wss', party: 'main', identity: { userId: 'u' } as never, onSnapshot })],
  ] as const)('%s closes its shard sockets after the tab is hidden and reopens them on return', (_name, create) => {
    vi.useFakeTimers();
    const doc = new FakeDocument();
    vi.stubGlobal('document', doc);
    const client = create(() => {});
    client.setSubscribedShards([{ x: 0, y: 0 }, { x: 1, y: 0 }]);
    expect(sockets.filter((socket) => !socket.closed).map((socket) => socket.room)).toEqual(['0,0', '1,0']);

    doc.setHidden(true);
    vi.advanceTimersByTime(HIDDEN_TAB_PAUSE_DELAY_MS);
    expect(sockets.every((socket) => socket.closed)).toBe(true);
    // Panning while paused only updates the subscription.
    client.setSubscribedShards([{ x: 1, y: 0 }, { x: 2, y: 0 }]);
    expect(sockets.filter((socket) => !socket.closed)).toHaveLength(0);

    doc.setHidden(false);
    expect(sockets.filter((socket) => !socket.closed).map((socket) => socket.room).sort()).toEqual(['1,0', '2,0']);
    client.destroy();
  });
});
