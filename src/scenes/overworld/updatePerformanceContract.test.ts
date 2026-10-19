import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sceneSource = readFileSync(new URL('../OverworldPlayScene.ts', import.meta.url), 'utf8');
const pipelineSource = readFileSync(new URL('./framePipeline.ts', import.meta.url), 'utf8');
const metadataRenderSource = readFileSync(new URL('../../mint/roomMetadataRender.ts', import.meta.url), 'utf8');

const CONTROLLER_SEGMENTS = [
  'controller.worldStreaming',
  'controller.backdrop',
  'controller.gridOverlay',
  'controller.liveObjects',
  'controller.signs',
  'controller.ghosts',
  'controller.pvpPresentation',
  'controller.roomChat',
  'controller.roomComments',
  'controller.presenceOverlay',
  'controller.roomMusic',
  'controller.movement',
  'controller.presencePvp',
  'controller.environment',
  'controller.specialTiles',
  'controller.portals',
  'controller.combat',
  'controller.roomTransition',
  'controller.playerPresentation',
  'controller.objectiveRoomRush',
] as const;

describe('overworld update performance contract', () => {
  it('reuses one movement-input snapshot across update, reset, and teardown', () => {
    expect(sceneSource).toContain('private readonly lastMovementInput = {');
    expect(sceneSource.match(/this\.lastMovementInput\s*=/g)).toBeNull();
    expect(sceneSource.match(/this\.setLastMovementInput\(/g)).toHaveLength(3);
    expect(pipelineSource.match(/host\.setLastMovementInput\(/g)).toHaveLength(1);
  });

  it('keeps controller-level profiler coverage inside the coarse update segments', () => {
    const stages = [...pipelineSource.matchAll(/profiled\('[^']+', (\d+), '([^']+)'/g)];
    expect(stages).toHaveLength(20);
    for (const [, slot, label] of stages) {
      expect(label).toBe(CONTROLLER_SEGMENTS[Number(slot)]);
    }
    for (const slot of [3, 14]) {
      expect(sceneSource).toContain(`endSegment('${CONTROLLER_SEGMENTS[slot]}'`);
    }
    const labels = new Set(stages.map(stage => stage[2]));
    expect(CONTROLLER_SEGMENTS.every((label, slot) => slot === 3 || slot === 14 || labels.has(label))).toBe(true);
    for (const group of ['update.world', 'update.noPlayer', 'update.player']) {
      expect(pipelineSource).toContain(`label: '${group}'`);
    }
    expect(pipelineSource).toContain('endSegment(group.label, startedAt)');
    expect(pipelineSource).toContain('endSegment(stage.profile.label, startedAt)');
  });

  it('samples controller segments round-robin instead of timing every controller every frame', () => {
    expect(sceneSource).toContain("get('mobilePerfControllers') === '1'");
    expect(sceneSource).toContain('profiler && this.mobilePerformanceControllerProfilingEnabled');
    expect(sceneSource).toContain('mobilePerformanceControllerProfileSlot = 0');
    expect(pipelineSource).toContain('OVERWORLD_CONTROLLER_PROFILE_SLOTS = 20');
    expect(pipelineSource).toContain('(frame.profileSlot + 1) % OVERWORLD_CONTROLLER_PROFILE_SLOTS');
    expect(pipelineSource).toContain('frame.profileSlot === stage.profile.slot');
    expect(sceneSource.match(/controllerProfileSlot === \d+ \? profiler\?\.beginSegment\(\) : undefined/g))
      .toHaveLength(3);
  });

  it('keeps canvas-only render entries outside the Phaser runtime graph', () => {
    expect(metadataRenderSource).toContain("from '../customTiles/draw'");
    expect(metadataRenderSource).toContain("from '../visuals/starfieldCanvas'");
    expect(metadataRenderSource).not.toContain("from '../customTiles/runtime'");
    expect(metadataRenderSource).not.toContain("from '../visuals/starfield'");
  });
});
