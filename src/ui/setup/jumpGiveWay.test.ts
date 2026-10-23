import { describe, expect, it, vi } from 'vitest';

const bridge = vi.hoisted(() => ({ scene: null as Record<string, unknown> | null }));
vi.mock('phaser', () => ({ default: {} }));
vi.mock('./sceneBridge', () => ({ getActiveOverworldScene: () => bridge.scene }));

import { OverworldHudBridge, configureOverworldHudBridgeRuntime, type OverworldOnlineRosterViewEntry } from '../../scenes/overworld/hud';
import { createProfileCollectionController } from './profileCollection';

const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

class FakeElement extends EventTarget {
  dataset: Record<string, string> = {};
  className = ''; type = ''; title = ''; textContent = ''; disabled = false;
  append(): void {}
}

// A jump that an active Room Rush took over resolves false: the Rush ended with its
// result, so playing afterwards would start the Rush's return room under that dialog (F383).
describe('callers that jump and then act stop when a Room Rush result took the jump', () => {
  function joinRow(jumped: boolean) {
    const onPlayRoom = vi.fn();
    const onJumpToCoordinates = vi.fn(async () => jumped);
    configureOverworldHudBridgeRuntime({ onJumpToCoordinates, onPlayRoom });
    const hud = Object.assign(Object.create(OverworldHudBridge.prototype), {
      doc: { createElement: () => new FakeElement() },
      setPlayersOnlinePopoverOpen: vi.fn(),
    }) as { createPlayersOnlineEntry(entry: OverworldOnlineRosterViewEntry): FakeElement };
    const row = hud.createPlayersOnlineEntry({
      key: 'pat', userId: 'pat', displayName: 'Pat', roomText: '3, 1', roomCoordinates: { x: 3, y: 1 },
      mode: 'play', isSelf: false, multiplayerInviteDisabled: false,
    });
    return { row, onPlayRoom, onJumpToCoordinates };
  }

  it('online players Join does not play after the Rush ended in its place', async () => {
    const h = joinRow(false);
    h.row.dispatchEvent(new Event('click'));
    await flush();
    expect(h.onJumpToCoordinates).toHaveBeenCalledWith({ x: 3, y: 1 });
    expect(h.onPlayRoom).not.toHaveBeenCalled();
  });

  it('online players Join still plays the room after an ordinary jump', async () => {
    const h = joinRow(true);
    h.row.dispatchEvent(new Event('click'));
    await flush();
    expect(h.onPlayRoom).toHaveBeenCalledOnce();
  });

  it('the collection shelf does not play the selected room after the Rush ended', async () => {
    const playSelectedRoom = vi.fn();
    bridge.scene = {
      jumpToCoordinates: vi.fn(async () => false),
      // Even when the Rush return room happens to be the shelf's room.
      getSelectedRoomContext: () => ({ coordinates: { x: 3, y: 1 } }),
      playSelectedRoom,
    };
    const close = vi.fn();
    const shelf = createProfileCollectionController({ getElementById: () => null } as unknown as Document, {} as never, close);
    (shelf as unknown as { onPlay(coordinates: { x: number; y: number }): void }).onPlay({ x: 3, y: 1 });
    await flush();
    expect(close).toHaveBeenCalledOnce();
    expect(playSelectedRoom).not.toHaveBeenCalled();
  });
});
