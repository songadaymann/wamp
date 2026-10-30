import { describe, expect, it, vi } from 'vitest';
import { getSceneWithCapabilities } from './sceneCapabilityRegistry';
import { sceneCapabilityFixture } from './sceneCapabilityRegistry.testSupport';
import { getActiveOverworldScene, getActiveEditorScene, getActiveRoomEditorScene, getActiveCourseWorkspaceScene, withActiveEditorMusic } from './sceneBridge';
import type { EditorMusicCommands } from './sceneBridge';

function game(scenes: Record<string, unknown>, active: string[] = []) {
  return { scene: { getScene: (key: string) => scenes[key], isActive: (key: string) => active.includes(key) } } as never;
}

describe('required scene capability lookup', () => {
  it('returns null for missing, primitive and throwing scene lookups', () => {
    expect(getSceneWithCapabilities(game({}), 'EditorScene')).toBeNull();
    expect(getSceneWithCapabilities(game({ EditorScene: 'wrong' }), 'EditorScene')).toBeNull();
    expect(getSceneWithCapabilities({ scene: { getScene: () => { throw new Error('missing'); } } } as never, 'EditorScene')).toBeNull();
  });

  it('rejects a course workspace registered as a room editor', () => {
    const course = sceneCapabilityFixture('CourseEditorScene', {});
    expect(getSceneWithCapabilities(game({ EditorScene: course }), 'EditorScene')).toBeNull();
    expect(getSceneWithCapabilities(game({ CourseEditorScene: course }), 'CourseEditorScene')).toBe(course);
  });

  it('rejects a missing or non-function action rather than accepting a partial bridge', () => {
    const scene = sceneCapabilityFixture('OverworldPlayScene', {});
    const { restartCurrentRun: removed, ...missing } = scene;
    void removed;
    expect(getSceneWithCapabilities(game({ OverworldPlayScene: missing }), 'OverworldPlayScene')).toBeNull();
    expect(getSceneWithCapabilities(game({ OverworldPlayScene: { ...scene, restartCurrentRun: true } }), 'OverworldPlayScene')).toBeNull();
  });

  it('validates each registered instance once, without repeated scans on UI refresh', () => {
    const scene = sceneCapabilityFixture('CourseComposerScene', {});
    const read = vi.fn(() => scene.returnToWorld);
    const candidate = { ...scene };
    Object.defineProperty(candidate, 'returnToWorld', { get: read });
    const manager = game({ CourseComposerScene: candidate });
    expect(getSceneWithCapabilities(manager, 'CourseComposerScene')).toBe(candidate);
    expect(getSceneWithCapabilities(manager, 'CourseComposerScene')).toBe(candidate);
    expect(read).toHaveBeenCalledOnce();
  });

  it('preserves the course workspace priority and keeps room-only history unavailable there', () => {
    const room = sceneCapabilityFixture('EditorScene', {});
    const course = sceneCapabilityFixture('CourseEditorScene', {});
    const manager = game({ EditorScene: room, CourseEditorScene: course }, ['EditorScene', 'CourseEditorScene']);
    expect(getActiveEditorScene(manager)).toBe(course);
    expect(getActiveCourseWorkspaceScene(manager)).toBe(course);
    expect(getActiveRoomEditorScene(manager)).toBeNull();
    expect(getActiveEditorScene(game({ EditorScene: room }))).toBeNull();
  });

  it.each(['EditorScene', 'CourseEditorScene'] as const)('routes music to the coordinator for %s with its receiver and arguments intact', key => {
    const music = { tempo: 110, shiftRoomMusicTempo(delta: number) { this.tempo += delta; } };
    const scene = sceneCapabilityFixture(key, { getMusicWorkflow: () => music as unknown as EditorMusicCommands });
    withActiveEditorMusic(game({ [key]: scene }, [key]), coordinator => coordinator.shiftRoomMusicTempo(5));
    expect(music.tempo).toBe(115);
    withActiveEditorMusic(game({ [key]: scene }), coordinator => coordinator.shiftRoomMusicTempo(5));
    expect(music.tempo).toBe(115);
  });
  it('keeps paused overworld menu commands available while excluding sleeping scenes', () => {
    const scene = sceneCapabilityFixture('OverworldPlayScene', {});
    const manager = { scene: { getScene: () => scene, isActive: () => false, isPaused: () => true } } as never;
    expect(getActiveOverworldScene(manager)).toBe(scene);
    expect(getActiveOverworldScene(game({ OverworldPlayScene: scene }))).toBeNull();
  });

});
