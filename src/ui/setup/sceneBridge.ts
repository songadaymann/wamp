import Phaser from 'phaser';
import type { RoomGoalType } from '../../goals/roomGoals';
import type { GoalPlacementMode } from '../../scenes/editor/editRuntime';
import type { RoomCoordinates, RoomRecord, RoomVersionRecord } from '../../persistence/roomModel';

export type EditorHistoryState = {
  roomId: string;
  claimerDisplayName: string | null;
  claimedAt: string | null;
  canRevert: boolean;
  canPublish: boolean;
  canMint: boolean;
  mintedTokenId: string | null;
  mintedOwnerWalletAddress: string | null;
  versions: RoomVersionRecord[];
};

export interface EditorSceneBridge {
  getHistoryState?: () => EditorHistoryState;
  revertToVersion?: (targetVersion: number) => Promise<RoomRecord | null>;
  startPlayMode?: () => void;
  saveDraft?: (force?: boolean) => Promise<RoomRecord | null>;
  publishRoom?: () => Promise<RoomRecord | null>;
  returnToWorld?: () => Promise<void> | void;
  mintRoom?: () => Promise<RoomRecord | null>;
  fitToScreen?: () => void;
  zoomIn?: () => void;
  zoomOut?: () => void;
  setRoomTitle?: (title: string | null) => void;
  setGoalType?: (nextType: RoomGoalType | null) => void;
  setGoalTimeLimitSeconds?: (seconds: number | null) => void;
  setGoalRequiredCount?: (requiredCount: number) => void;
  setGoalSurvivalSeconds?: (seconds: number) => void;
  startGoalMarkerPlacement?: (mode: Exclude<GoalPlacementMode, null>) => void;
  clearGoalMarkers?: () => void;
  undoAction?: () => void;
  redoAction?: () => void;
}

export type OverworldSelectedRoomContext = {
  roomId: string;
  coordinates: RoomCoordinates;
  state: 'published' | 'draft' | 'frontier' | 'empty';
};

export interface OverworldSceneBridge {
  playSelectedRoom?: () => void;
  editSelectedRoom?: () => void;
  buildSelectedRoom?: () => void;
  zoomIn?: () => void;
  zoomOut?: () => void;
  jumpToCoordinates?: (coordinates: RoomCoordinates) => Promise<void> | void;
  fitLoadedWorld?: () => void;
  returnToWorld?: () => void;
  getSelectedRoomContext?: () => OverworldSelectedRoomContext;
}

function getScene<T>(game: Phaser.Game, key: string): T | null {
  try {
    return game.scene.getScene(key) as T;
  } catch {
    return null;
  }
}

export function getEditorScene(game: Phaser.Game): EditorSceneBridge | null {
  return getScene<EditorSceneBridge>(game, 'EditorScene');
}

export function getOverworldScene(game: Phaser.Game): OverworldSceneBridge | null {
  return getScene<OverworldSceneBridge>(game, 'OverworldPlayScene');
}

export function getActiveEditorScene(game: Phaser.Game): EditorSceneBridge | null {
  if (!game.scene.isActive('EditorScene')) {
    return null;
  }

  return getEditorScene(game);
}

export function getActiveOverworldScene(game: Phaser.Game): OverworldSceneBridge | null {
  if (!game.scene.isActive('OverworldPlayScene')) {
    return null;
  }

  return getOverworldScene(game);
}

export function withActiveEditorScene(
  game: Phaser.Game,
  callback: (scene: EditorSceneBridge) => void,
): void {
  const scene = getActiveEditorScene(game);
  if (!scene) {
    return;
  }

  callback(scene);
}

export function withActiveOverworldScene(
  game: Phaser.Game,
  callback: (scene: OverworldSceneBridge) => void,
): void {
  const scene = getActiveOverworldScene(game);
  if (!scene) {
    return;
  }

  callback(scene);
}
