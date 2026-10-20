interface ClockScene {
  time: { now: number };
  events: {
    on(event: 'preupdate', callback: (time: number, delta: number) => void): unknown;
    off(event: 'preupdate', callback: (time: number, delta: number) => void): unknown;
  };
}

const clocks = new WeakMap<object, { now: number }>();

/** Phaser Clock.now is absolute frame time and jumps over scene pauses. Mechanics use delta time. */
export function installGameplayClock(scene: ClockScene, getSpeed: () => number = () => 1): () => void {
  const clock = { now: scene.time.now };
  clocks.set(scene, clock);
  const tick = (_time: number, delta: number): void => { clock.now += Math.max(0, delta) * getSpeed(); };
  scene.events.on('preupdate', tick);
  return () => { scene.events.off('preupdate', tick); clocks.delete(scene); };
}

export function gameplayNow(scene: { time: { now: number } }): number {
  return clocks.get(scene)?.now ?? scene.time.now;
}
