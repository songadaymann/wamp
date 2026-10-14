import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
const { FakeGroup } = vi.hoisted(() => ({ FakeGroup: class {
  entries: object[] = [];
  add(child: object) { if (!this.contains(child)) { this.entries.push(child); this.createCallbackHandler(child); } return this; }
  remove(child: object) { this.entries = this.entries.filter(value => value !== child); this.removeCallbackHandler(child); return this; }
  contains(child: object) { return this.entries.includes(child); }
  createCallbackHandler(child: object) { (child as { body: { velocity: { x: number } } }).body.velocity.x = 0; }
  removeCallbackHandler(child: object) { (child as { body: { enable: boolean } }).body.enable = false; }
  getLength() { return this.entries.length; }
  // Phaser clears children directly, without invoking its remove callback.
  destroy() { this.entries = []; }
} }));
vi.mock('phaser', () => ({ default: { Physics: { Arcade: { Group: FakeGroup } } } }));
import { createExistingBodyGroup } from './existingBodyGroup';
it('indexes existing bodies without resetting velocity, mass, sleep or removal state', () => {
  const scene = { physics: { world: {} } } as never;
  const group = createExistingBodyGroup(scene, 1)!;
  const first = { body: { enable: false, mass: 2, velocity: { x: 42 } } }, second = { body: { enable: true, mass: 3, velocity: { x: -13 } } };
  group.add(first as never);group.add(second as never);
  expect(first.body).toEqual({ enable: false, mass: 2, velocity: { x: 42 } });
  expect(group.physicsType).toBe(1);expect(group.collisionCategory).toBe(0xffffffff);expect(group.collisionMask).toBe(0xffffffff);
  expect(group.contains(first as never)).toBe(true);expect(group.getLength()).toBe(2);
  group.remove(second as never);expect(second.body.enable).toBe(true);expect(group.contains(second as never)).toBe(false);
  group.destroy(false, false);expect(first.body.velocity.x).toBe(42);expect(first.body.enable).toBe(false);expect(group.getLength()).toBe(0);
  expect(group.contains(first as never)).toBe(false);
});

it('cleans membership on scene shutdown and unregisters an early-destroyed group', () => {
  const events = new EventEmitter(), scene = { events, physics: { world: {} } } as never;
  const group = createExistingBodyGroup(scene, 0)!;const child = { body: { enable: true, velocity: { x: 7 } } };
  group.add(child as never);expect(events.listenerCount('shutdown')).toBe(1);
  events.emit('shutdown');expect(group.getLength()).toBe(0);expect(child.body.enable).toBe(true);
  expect(events.listenerCount('shutdown')).toBe(0);
  const next = createExistingBodyGroup(scene, 0)!;next.destroy(false,false);expect(events.listenerCount('shutdown')).toBe(0);
});
