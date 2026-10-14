import { expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: {} }));
import { SpecialTileBodySamples } from './specialTileSamples';
import type { SpecialTilePlayerEnvironment } from '../specialTiles';
const environment: SpecialTilePlayerEnvironment = { gravityDirection: 'down', inWater: false, windX: 0, conveyorX: 1,
  onIce: false, onSticky: false, onBounce: false, onDamage: false };
it('retains a current conveyor result, including zero, and invalidates stale geometry or gravity', () => {
  const body = { left: 0, right: 10, top: 0, bottom: 20, center: { x: 5, y: 10 } }, samples = new SpecialTileBodySamples();
  expect(samples.conveyor(body as never, 'down')).toBeNull();
  samples.record(body as never, environment);expect(samples.conveyor(body as never, 'down')).toBe(1);
  expect(samples.conveyor(body as never, 'up')).toBeNull();body.left++;
  expect(samples.conveyor(body as never, 'down')).toBeNull();
  samples.record(body as never, { ...environment, conveyorX: 0 });expect(samples.conveyor(body as never, 'down')).toBe(0);
  samples.invalidate(body as never);expect(samples.conveyor(body as never, 'down')).toBeNull();
});
it('keeps samples separate when multiple bodies share a surface', () => {
  const a = { left: 0, right: 10, top: 0, bottom: 20, center: { x: 5, y: 10 } }, b = { ...a }, samples = new SpecialTileBodySamples();
  samples.record(a as never, environment);samples.record(b as never, { ...environment, conveyorX: -1 });
  expect(samples.conveyor(a as never, 'down')).toBe(1);expect(samples.conveyor(b as never, 'down')).toBe(-1);
});

it('captures conveyor state before the shared environment object is reused by another query', () => {
  const body = { left: 0, right: 10, top: 0, bottom: 20, center: { x: 5, y: 10 } }, samples = new SpecialTileBodySamples();
  const reusable = { ...environment };samples.record(body as never, reusable);reusable.conveyorX = -1;
  expect(samples.conveyor(body as never, 'down')).toBe(1);
  samples.record(body as never, reusable);expect(samples.conveyor(body as never, 'down')).toBe(-1);
});

it('rechecks when the middle contact probe changes despite unchanged bounds', () => {
  const body = { left: 0, right: 10, top: 0, bottom: 20, center: { x: 5, y: 10 } }, samples = new SpecialTileBodySamples();
  samples.record(body as never, environment);body.center.x++;
  expect(samples.conveyor(body as never, 'down')).toBeNull();
});
