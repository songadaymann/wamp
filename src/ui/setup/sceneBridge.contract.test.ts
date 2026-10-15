// Required per-scene capabilities and coordinator command types reject missing or renamed methods.
import { describe, expect, it } from 'vitest';
import type { CourseEditorScene } from '../../scenes/CourseEditorScene';
import type { CourseComposerScene } from '../../scenes/CourseComposerScene';
import type { EditorScene } from '../../scenes/EditorScene';
import type { OverworldPlayScene } from '../../scenes/OverworldPlayScene';
import type { CourseWorkspaceSceneBridge, CourseComposerSceneBridge, RoomEditorSceneBridge, OverworldSceneBridge, EditorMusicCommands } from './sceneBridge';

type Assert<T extends true> = T;
type OptionalKeys<T> = { [K in keyof T]-?: object extends Pick<T, K> ? K : never }[keyof T];
export type RoomCapabilitiesAreRequired = Assert<OptionalKeys<RoomEditorSceneBridge> extends never ? true : false>;
export type CourseCapabilitiesAreRequired = Assert<OptionalKeys<CourseWorkspaceSceneBridge> extends never ? true : false>;
export type OverworldCapabilitiesAreRequired = Assert<OptionalKeys<OverworldSceneBridge> extends never ? true : false>;
export type ComposerCapabilitiesAreRequired = Assert<OptionalKeys<CourseComposerSceneBridge> extends never ? true : false>;
export type MusicCommandsAreRequired = Assert<OptionalKeys<EditorMusicCommands> extends never ? true : false>;

export function editorSceneKeepsItsBridge(scene: EditorScene): RoomEditorSceneBridge { return scene; }
export function courseEditorSceneKeepsItsBridge(scene: CourseEditorScene): CourseWorkspaceSceneBridge { return scene; }
export function overworldSceneKeepsItsBridge(scene: OverworldPlayScene): OverworldSceneBridge { return scene; }
export function composerSceneKeepsItsBridge(scene: CourseComposerScene): CourseComposerSceneBridge { return scene; }

// These counterexamples must remain compile errors: missing methods, wrong parameters and
// a course editor pretending to support room history cannot silently become valid contracts.
export function rejectCapabilityDrift(room: RoomEditorSceneBridge, course: CourseWorkspaceSceneBridge, music: EditorMusicCommands): void {
  const { getMusicWorkflow: removed, ...missing } = room;
  void removed;
  // @ts-expect-error The music accessor is required.
  const renamed: RoomEditorSceneBridge = missing;
  void renamed;
  // @ts-expect-error Course workspaces do not supply room history.
  course.getHistoryState();
  // @ts-expect-error Tempo commands require a number.
  music.shiftRoomMusicTempo('fast');
  // @ts-expect-error The old scene music delegates have been replaced by the required accessor.
  room.shiftRoomMusicTempo(5);
}

describe('scene bridge contract (F062)', () => {
  it('has compile-checked concrete scene and command contracts', () => {
    expect(typeof editorSceneKeepsItsBridge).toBe('function');
    expect(typeof courseEditorSceneKeepsItsBridge).toBe('function');
    expect(typeof overworldSceneKeepsItsBridge).toBe('function');
    expect(typeof composerSceneKeepsItsBridge).toBe('function');
  });
});
