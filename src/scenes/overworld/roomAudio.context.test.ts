import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import type { OverworldMode } from '../sceneData';
import { OverworldRoomAudioController } from './roomAudio';
import { playSfx } from '../../audio/sfx';
vi.mock('phaser', () => ({ default: {} }));
vi.mock('../../audio/sfx', () => ({ playSfx: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
function fixture() {
  const state = { mode: 'play' as OverworldMode, room: { x: -3, y: 7 } };
  const timers: Array<{ delay: number; run(): void; remove: ReturnType<typeof vi.fn> }> = [];
  const scene = { time: { delayedCall: (delay: number, run: () => void) => {
    const timer = { delay, run, remove: vi.fn() }; timers.push(timer); return timer;
  } } } as unknown as Phaser.Scene;
  const controller = new OverworldRoomAudioController({ scene, runtime: {
    mode: { get: () => state.mode }, get currentRoomCoordinates() { return state.room; },
  } });
  return { controller, state, timers };
}
describe('room audio with live runtime location', () => {
  it('routes current/adjacent/distant sounds against the room after a transition, without rebuilding the controller', () => {
    const f = fixture();
    expect(f.controller.getPlaybackOptionsForRoom({ x: -3, y: 7 })).toBeUndefined();
    expect(f.controller.getPlaybackOptionsForRoom({ x: -2, y: 7 })).toMatchObject({ volumeMultiplier: 0.26 });
    expect(f.controller.getPlaybackOptionsForRoom({ x: -1, y: 7 })).toBeNull();
    f.state.room = { x: -1, y: 7 };
    expect(f.controller.getPlaybackOptionsForRoom({ x: -1, y: 7 })).toBeUndefined();
    expect(f.controller.getPlaybackOptionsForRoom({ x: -2, y: 7 })).toMatchObject({ volumeMultiplier: 0.26 });
    expect(f.controller.getPlaybackOptionsForRoom({ x: -3, y: 7 })).toBeNull();
    f.state.mode = 'browse'; expect(f.controller.getPlaybackOptionsForRoom({ x: -3, y: 7 })).toBeUndefined();
  });
  it('preserves adjacent primary/echo playback and cancels only pending echoes at teardown', () => {
    const f = fixture(); f.controller.playRoomSfx('jump', { x: -2, y: 7 });
    expect(playSfx).toHaveBeenCalledExactlyOnceWith('jump', expect.objectContaining({ volumeMultiplier: 0.26 }));
    expect(f.timers.map(t => t.delay)).toEqual([110, 210]);
    f.timers[0].run(); expect(playSfx).toHaveBeenLastCalledWith('jump', expect.objectContaining({ volumeMultiplier: 0.1, ignoreCooldown: true }));
    f.controller.destroy(); expect(f.timers[0].remove).not.toHaveBeenCalled(); expect(f.timers[1].remove).toHaveBeenCalledExactlyOnceWith(false);
    expect(f.controller.getDebugSnapshot().pendingEchoCount).toBe(0);
  });
  it('records the source by value and keeps ignored sounds and browse defaults unchanged', () => {
    const f = fixture(), source = { x: 10, y: 10 }; f.controller.playRoomSfx('jump', source); source.x = 99;
    expect(playSfx).not.toHaveBeenCalled(); expect(f.controller.getDebugSnapshot()).toMatchObject({ lastSourceRoom: { x: 10, y: 10 }, lastDistance: 16, lastRoute: 'ignored' });
    const debug = f.controller.getDebugSnapshot(); debug.lastSourceRoom!.y = 99;
    expect(f.controller.getDebugSnapshot().lastSourceRoom).toEqual({ x: 10, y: 10 });
    f.state.mode = 'browse'; f.controller.playRoomSfx('jump', source); expect(playSfx).toHaveBeenCalledExactlyOnceWith('jump');
  });
});
