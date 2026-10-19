import { EventEmitter } from 'node:events';
import { expect, it } from 'vitest';
import { gameplayNow, installGameplayClock } from './gameplayClock';

it('keeps cooldown time aligned to simulation across pauses, sleep and teardown', () => {
  const scene = { time: { now: 1000 }, events: new EventEmitter() };
  const destroy = installGameplayClock(scene);
  scene.events.emit('preupdate', 1016, 16);
  expect(gameplayNow(scene)).toBe(1016);
  // Phaser resumes with an absolute Clock.now, even though no scene frames ran in the break.
  scene.time.now = 61016;
  expect(gameplayNow(scene)).toBe(1016);
  scene.events.emit('preupdate', 61032, 16);
  expect(gameplayNow(scene)).toBe(1032);
  destroy();
  expect(scene.events.listenerCount('preupdate')).toBe(0);
  expect(gameplayNow(scene)).toBe(61016);
});

it('scales cooldown time without jumping when speed changes or the scene pauses', () => {
  const scene = { time: { now: 0 }, events: new EventEmitter() }; let speed = 0.6;
  const destroy = installGameplayClock(scene, () => speed);
  scene.events.emit('preupdate', 1000, 1000); expect(gameplayNow(scene)).toBe(600);
  scene.time.now = 9000; speed = 0.8; scene.events.emit('preupdate', 10000, 1000); expect(gameplayNow(scene)).toBe(1400);
  speed = 1; scene.events.emit('preupdate', 11000, 1000); expect(gameplayNow(scene)).toBe(2400); destroy();
});
