import Phaser from 'phaser';
import { editorState } from '../config';
import { currentBuilderCanUseRoomVideo } from './access';
import { roomHasPressedPressurePlate } from './pressure';
import { normalizeRoomVideo } from './model';
import { RoomVideoFrameController, type RoomVideoFrameSync } from './frameController';
import { getRoomVideo, setRoomVideo } from './editing';

const frames = new WeakMap<Phaser.Scene, RoomVideoFrameController>();
let lastDownKey = '';
let lastDownResult = false;
let upConsumed = false;

function frameFor(scene: Phaser.Scene): RoomVideoFrameController | null {
  const events = scene.events as { once?: unknown } | null;
  if (!events || typeof events.once !== 'function') return null;
  let frame = frames.get(scene);
  if (!frame) {
    frame = new RoomVideoFrameController(scene);
    frames.set(scene, frame);
  }
  return frame;
}

export function syncRoomVideoFrame(scene: Phaser.Scene, sync: RoomVideoFrameSync): void {
  frameFor(scene)?.sync(sync);
}

export function destroyRoomVideoFrame(scene: Phaser.Scene): void {
  const frame = frames.get(scene);
  if (!frame) return;
  frame.destroy();
  frames.delete(scene);
}

export function roomVideoPointerDown(scene: Phaser.Scene, pointer: Phaser.Input.Pointer): boolean {
  if (!currentBuilderCanUseRoomVideo()) return false;
  const key = `${pointer.id}:${pointer.downTime}`;
  if (key === lastDownKey) return lastDownResult;
  upConsumed = false;
  lastDownKey = key;
  lastDownResult = frameFor(scene)?.handlePointerDown(pointer) ?? false;
  return lastDownResult;
}

export function roomVideoPointerMove(scene: Phaser.Scene, pointer: Phaser.Input.Pointer): boolean {
  if (!currentBuilderCanUseRoomVideo()) return false;
  return frameFor(scene)?.handlePointerMove(pointer) ?? false;
}

export function roomVideoPointerUp(scene: Phaser.Scene): boolean {
  if (!currentBuilderCanUseRoomVideo()) return false;
  if (upConsumed) return true;
  upConsumed = frameFor(scene)?.handlePointerUp() ?? false;
  return upConsumed;
}

interface EditorVideoScene {
  editRuntime: object;
  roomId: string;
  musicModeActive: boolean;
}

interface CourseVideoSlice {
  runtime: object;
  origin: { x: number; y: number };
  roomId: string;
}

interface CourseVideoScene {
  getSelectedSlice(): CourseVideoSlice | null;
  musicModeActive: boolean;
}

function videoMenuOpen(musicModeActive: boolean): boolean {
  const body = document.body.dataset;
  return body.editorShellPanel === 'room'
    && body.editorRoomSection === 'video'
    && !musicModeActive
    && !editorState.isPlaying;
}

export function syncEditorRoomVideo(scene: Phaser.Scene): void {
  const editor = scene as unknown as EditorVideoScene;
  const runtime = editor.editRuntime;
  syncRoomVideoFrame(scene, {
    video: getRoomVideo(runtime),
    originX: 0,
    originY: 0,
    playback: editorState.isPlaying ? 'hidden' : 'edit',
    interactive: videoMenuOpen(editor.musicModeActive),
    triggerPressed: false,
    sessionKey: `edit:${editor.roomId}`,
    onChange: (video, commit) => setRoomVideo(runtime, video, !commit),
  });
}

export function syncCourseRoomVideo(scene: Phaser.Scene): void {
  const course = scene as unknown as CourseVideoScene;
  const slice = course.getSelectedSlice();
  syncRoomVideoFrame(scene, {
    video: getRoomVideo(slice?.runtime),
    originX: slice?.origin.x ?? 0,
    originY: slice?.origin.y ?? 0,
    playback: editorState.isPlaying ? 'hidden' : 'edit',
    interactive: Boolean(slice) && videoMenuOpen(course.musicModeActive),
    triggerPressed: false,
    sessionKey: slice ? `course:${slice.roomId}` : 'course:none',
    onChange: (video, commit) => {
      if (slice) setRoomVideo(slice.runtime, video, !commit);
    },
  });
}

interface OverworldVideoScene {
  mode: string;
  currentRoomCoordinates: { x: number; y: number };
  getRoomSnapshotViewForCoordinates(coordinates: { x: number; y: number }): { id: string; video?: unknown } | null;
  getRoomOrigin(coordinates: { x: number; y: number }): { x: number; y: number };
  getCollisionReadyLoadedFullRooms(): Parameters<typeof roomHasPressedPressurePlate>[0];
}

export function syncOverworldRoomVideo(
  scene: Phaser.Scene,
  stackParent: Phaser.GameObjects.Container | Phaser.GameObjects.Layer | null,
): void {
  const world = scene as unknown as OverworldVideoScene;
  const playing = world.mode === 'play';
  const snapshot = playing ? world.getRoomSnapshotViewForCoordinates(world.currentRoomCoordinates) : null;
  const video = normalizeRoomVideo(snapshot?.video);
  const origin = world.getRoomOrigin(world.currentRoomCoordinates);
  syncRoomVideoFrame(scene, {
    video,
    originX: origin.x,
    originY: origin.y,
    playback: playing && video ? 'play' : 'hidden',
    interactive: false,
    triggerPressed: snapshot
      ? roomHasPressedPressurePlate(world.getCollisionReadyLoadedFullRooms(), snapshot.id)
      : false,
    sessionKey: snapshot ? `play:${snapshot.id}` : 'world',
    holeDepth: 9.4,
    stackParent,
  });
}
