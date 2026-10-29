import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: {} }));
import { EditorObjectLinkCopy } from './objectLinkCopy';
import type { PlacedObject } from '../../config';

const plate: PlacedObject = { id: 'floor_trigger', instanceId: 'plate', x: 8, y: 16 };

describe('shared object-link guidance', () => {
  it.each(['room', 'expanded room'] as const)('includes barricades in every pressure-plate prompt (%s)', scope => {
    const copy = new EditorObjectLinkCopy(() => ({ scope, videoAnchor: false }));
    for (const text of [copy.beginStatus(plate, true), copy.beginStatus(plate, false),
      copy.pickTargetStatus(plate), copy.noTargetsStatus(plate), copy.noTargetsTitle(plate)]) {
      expect(text).toContain('barricade');
    }
  });

  it.each(['room', 'expanded room'] as const)('offers an available video even with no object targets (%s)', scope => {
    const copy = new EditorObjectLinkCopy(() => ({ scope, videoAnchor: true }));
    expect(copy.connectStatus(plate, 0)).toContain('video anchor');
    expect(copy.connectStatus(plate, 0)).not.toContain('No door');
    expect(copy.beginStatus(plate, true)).toContain('video anchor');
    expect(copy.noTargetsStatus(plate)).toContain(scope === 'room' ? 'anchor on the video' : "this cell's video anchor");
  });

  it('reads the current source-cell capabilities rather than caching selection state', () => {
    let videoAnchor = false;
    const copy = new EditorObjectLinkCopy(() => ({ scope: 'expanded room', videoAnchor }));
    expect(copy.connectStatus(plate, 0)).toContain('No door');
    videoAnchor = true;
    expect(copy.connectStatus(plate, 0)).toContain("this cell's video anchor");
  });

  it('uses one target-name table for narrow doors, barricades and locked trapdoors', () => {
    const copy = new EditorObjectLinkCopy(() => ({ scope: 'room', videoAnchor: false }));
    expect(copy.targetLabel('door_locked_narrow')).toBe('narrow wooden door');
    expect(copy.targetLabel('trapdoor_locked')).toBe('locked trapdoor');
    expect(copy.targetLabel('barricade')).toBe('barricade');
  });

  it.each(['moving_platform', 'portal_a'])('does not offer a room video to an incompatible source (%s)', id => {
    const copy = new EditorObjectLinkCopy(() => ({ scope: 'expanded room', videoAnchor: true }));
    const source = { ...plate, id };
    expect(copy.connectStatus(source, 0)).not.toContain('video');
    expect(copy.beginStatus(source, true)).not.toContain('video');
  });
});
