import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PvpInviteOffer } from '../../pvp/model';
import { APP_MODE_CHANGED_EVENT } from '../../ui/appMode';

const prompt = vi.hoisted(() => ({ show: vi.fn(async () => 'decline' as const) }));
vi.mock('../../multiplayer/instanceClient', () => ({ MultiplayerInstanceClient: class {} }));
vi.mock('../../pvp/repository', () => ({ createPvpRepository: () => ({ submitMatch: vi.fn() }) }));
vi.mock('../../ui/setup/pvpModal', () => ({
  hidePvpCountdownOverlay: vi.fn(),
  showPvpCountdownOverlay: vi.fn(),
  showPvpGoOverlay: vi.fn(),
  showPvpInvitePrompt: prompt.show,
  showPvpResultModal: vi.fn(),
}));

import { OverworldPvpArenaController } from './pvpArenaController';

const player = (userId: string, displayName: string) => ({ userId, displayName, avatarId: 'default-player' });
const challenge = (inviteId: string, lifetimeMs = 20_000) => ({
  inviteId, matchId: `match-${inviteId}`, mode: 'arena', roomId: '0,0', roomCoordinates: { x: 0, y: 0 }, shardId: 'shard',
  inviterConnectionId: 'rival-connection', inviter: player('rival', 'Rival'), target: player('me', 'Me'),
  createdAt: Date.now(), expiresAt: Date.now() + lifetimeMs,
}) as unknown as PvpInviteOffer;

function setup() {
  let browsing = false;
  const host = {
    getIdentity: () => player('me', 'Me'),
    declinePvpInvite: vi.fn(),
    showTransientStatus: vi.fn(),
    canPromptForInvite: () => browsing,
  };
  const controller = new OverworldPvpArenaController(host as never);
  const backToBrowse = (): void => { browsing = true; window.dispatchEvent(new Event(APP_MODE_CHANGED_EVENT)); };
  return { controller, host, backToBrowse };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', Object.assign(new EventTarget(), { setTimeout, clearTimeout }));
  prompt.show.mockClear();
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('PvP challenges during a run', () => {
  it('never opens the pop-up mid-run: it says who asked and offers the challenge back in browse', async () => {
    const f = setup();
    await f.controller.handleInvite(challenge('first'));
    expect(prompt.show).not.toHaveBeenCalled();
    expect(f.host.showTransientStatus).toHaveBeenCalledWith('Rival invited you to duel. Finish your run to answer.');
    expect(f.host.declinePvpInvite).not.toHaveBeenCalled();

    f.backToBrowse();
    await vi.advanceTimersByTimeAsync(0);
    expect(prompt.show).toHaveBeenCalledOnce();
    expect(prompt.show.mock.calls[0]).toEqual([expect.objectContaining({ inviteId: 'first' })]);
  });

  it('keeps only the latest challenge, and drops it with a decline once it expires', async () => {
    const f = setup();
    await f.controller.handleInvite(challenge('first'));
    await f.controller.handleInvite(challenge('second', 5_000));
    expect(f.host.declinePvpInvite).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ inviteId: 'first' }));

    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.host.declinePvpInvite).toHaveBeenLastCalledWith(expect.objectContaining({ inviteId: 'second' }));
    f.backToBrowse();
    await vi.advanceTimersByTimeAsync(0);
    expect(prompt.show).not.toHaveBeenCalled();
  });
});
