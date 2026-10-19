import { EventEmitter } from 'node:events';
import { afterEach, expect, it } from 'vitest';
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
