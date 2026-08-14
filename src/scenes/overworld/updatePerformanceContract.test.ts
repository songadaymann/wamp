import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sceneSource = readFileSync(new URL('../OverworldPlayScene.ts', import.meta.url), 'utf8');
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
    expect(sceneSource.match(/this\.setLastMovementInput\(/g)).toHaveLength(4);
  });

  it('keeps controller-level profiler coverage inside the coarse update segments', () => {
    for (const label of CONTROLLER_SEGMENTS) {
      expect(sceneSource).toContain(`endSegment('${label}'`);
    }

    expect(sceneSource).toContain("endSegment('update.world'");
    expect(sceneSource).toContain("endSegment('update.noPlayer'");
    expect(sceneSource).toContain("endSegment('update.player'");
  });

  it('samples controller segments round-robin instead of timing every controller every frame', () => {
    expect(sceneSource).toContain("get('mobilePerfControllers') === '1'");
    expect(sceneSource).toContain('profiler && this.mobilePerformanceControllerProfilingEnabled');
    expect(sceneSource).toContain('mobilePerformanceControllerProfileSlot = 0');
    expect(sceneSource).toContain('(controllerProfileSlot + 1) % 20');
    expect(sceneSource.match(/controllerProfileSlot === \d+ \? profiler\?\.beginSegment\(\) : undefined/g))
      .toHaveLength(23);
  });

  it('keeps canvas-only render entries outside the Phaser runtime graph', () => {
    expect(metadataRenderSource).toContain("from '../customTiles/draw'");
    expect(metadataRenderSource).toContain("from '../visuals/starfieldCanvas'");
    expect(metadataRenderSource).not.toContain("from '../customTiles/runtime'");
    expect(metadataRenderSource).not.toContain("from '../visuals/starfield'");
  });
});
