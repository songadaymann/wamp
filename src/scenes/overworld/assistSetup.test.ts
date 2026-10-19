import { OverworldLostSongController } from './lostSongs';
import { LostSongService } from '../../lostSongs/service';
import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { createDefaultRoomSnapshot } from '../../persistence/roomModel';
import { updateAssistSettings } from '../../settings/assistSettings';
import { createOverworldAssist } from './assistSetup';
afterEach(() => updateAssistSettings({ speed: 1, safeRespawn: false }));
it('detects assistance before Play starts, excludes live modes/co-op and tears down every listener', () => {
  updateAssistSettings({ speed: 0.8, safeRespawn: true });
  const scene = { events: new EventEmitter(), physics: { world: { timeScale: 1 } }, time: { now: 0, timeScale: 1 }, tweens: { timeScale: 1 }, anims: { globalTimeScale: 1 } };
  const room = createDefaultRoomSnapshot(); let playing = false, live = false;
  const host = { isPlaying: () => playing, hasLiveMode: () => live, getRoomRun: () => null, getExpandedRun: () => null,
    getRoom: () => ({ room }), findRoom: () => null, allRooms: () => [], getBody: () => null, getOrigin: () => ({ x: 0, y: 0 }), standingHeight: 40,
    clearTrace: () => {}, renderHud: () => {} };
  const assist = createOverworldAssist(scene as never, host as never);
  expect(assist.requestedForRun()).toBe(true); expect(assist.runtime.isActive()).toBe(false);
  playing = true; scene.events.emit('preupdate', 100, 100); expect(assist.runtime.speed).toBe(0.8);
  live = true; scene.events.emit('preupdate', 200, 100); expect(assist.requestedForRun()).toBe(false); expect(assist.runtime.speed).toBe(1);
  live = false; room.placedObjects.push({ id: 'floor_trigger', instanceId: 'coop', x: 80, y: 288, layer: 'terrain', coopPlate: true });
  scene.events.emit('preupdate', 300, 100); expect(assist.runtime.isActive()).toBe(false); expect(assist.runtime.speed).toBe(1);
  assist.destroy(); expect(scene.events.eventNames()).toEqual([]);
});


it('keeps goal-free pickups in practice after Assist is disabled until a fresh visit', () => {
  const scene = { events: new EventEmitter(), physics: { world: { timeScale: 1 } }, time: { now: 0, timeScale: 1 }, tweens: { timeScale: 1 }, anims: { globalTimeScale: 1 } };
  const room = createDefaultRoomSnapshot(); let playing = true;
  const host = { isPlaying: () => playing, hasLiveMode: () => false, getRoomRun: () => null, getExpandedRun: () => null,
    getRoom: () => ({ room }), findRoom: () => null, allRooms: () => [], getBody: () => null, getOrigin: () => ({ x: 0, y: 0 }), standingHeight: 40,
    clearTrace: () => {}, renderHud: () => {} };
  const assist = createOverworldAssist(scene as never, host as never);
  expect(assist.isPracticeFind()).toBe(false);
  updateAssistSettings({ speed: 0.6 }); updateAssistSettings({ speed: 1 });
  expect(assist.runtime.isActive()).toBe(false); expect(assist.isPracticeFind()).toBe(true);
  const repository = { progress: vi.fn(), claim: vi.fn(), play: vi.fn(), find: vi.fn() };
  const service = new LostSongService(repository as never, null, () => ({ userId: null, guest: { guestUserId: 'assist', recoveryToken: 'r'.repeat(64) } }));
  const pickups = new OverworldLostSongController({
    getContext: () => ({ target: { roomId: room.id, roomVersion: 1 }, practice: assist.isPracticeFind(), position: { x: 100, y: 100 } }),
    showStatus: vi.fn(), onFoundChanged: vi.fn(),
  }, service);
  pickups.collect(room.id);
  expect(repository.play).not.toHaveBeenCalled(); expect(repository.find).not.toHaveBeenCalled(); expect(service.snapshot().total).toBe(0); pickups.destroy();
  // Respawning in this room retains the visit; a different room starts a fresh one.
  scene.events.emit('preupdate', 100, 100); expect(assist.isPracticeFind()).toBe(true);
  room.id = '1,0'; scene.events.emit('preupdate', 200, 100); expect(assist.isPracticeFind()).toBe(false);
  updateAssistSettings({ safeRespawn: true }); updateAssistSettings({ safeRespawn: false }); expect(assist.isPracticeFind()).toBe(true);
  playing = false; scene.events.emit('preupdate', 300, 100); playing = true; scene.events.emit('preupdate', 400, 100);
  expect(assist.isPracticeFind()).toBe(false); assist.destroy();
});
