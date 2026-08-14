import type { RoomCoordinates, RoomSnapshot } from '../persistence/roomModel';

export const TUTORIAL_PROGRESS_VERSION = 1 as const;
export const TUTORIAL_PROGRESS_STORAGE_KEY = 'wamp_dream_builder_tutorial_v1';
export const LEGACY_WELCOME_SEEN_STORAGE_KEY = 'wamp_welcome_modal_seen_v1';

export type TutorialStage =
  | 'dream'
  | 'wake'
  | 'room_traversal'
  | 'bridge_prompt'
  | 'bridge_edit'
  | 'bridge_playtest'
  | 'bridge_complete'
  | 'creative_edit'
  | 'awaiting_claim'
  | 'completed'
  | 'dismissed';

export type TutorialTerminalStatus = 'active' | 'completed' | 'dismissed';
export type TutorialRuntimeMode =
  | 'traversal'
  | 'private_editor'
  | 'private_playtest'
  | 'awaiting_claim';

export type CreativeChecklistItem =
  | 'background'
  | 'ground'
  | 'decoration'
  | 'collectible'
  | 'enemy'
  | 'spawn_and_goal';

export type CreativeChecklistItemState = 'pending' | 'done' | 'skipped';
export type CreativeChecklistState = Record<CreativeChecklistItem, CreativeChecklistItemState>;

export interface TutorialTemplateVersionsV1 {
  wakeRoom: number;
  bridgeRoom: number;
}

export interface TutorialProgressV1 {
  version: typeof TUTORIAL_PROGRESS_VERSION;
  sessionId: string;
  stage: TutorialStage;
  templateVersions: TutorialTemplateVersionsV1;
  workingSnapshot: RoomSnapshot | null;
  bridgeBackupSnapshot: RoomSnapshot | null;
  creativeChecklist: CreativeChecklistState;
  selectedClaimCoordinates: RoomCoordinates | null;
  terminalStatus: TutorialTerminalStatus;
  updatedAt: string;
}

export interface TutorialSceneContext {
  sessionId: string;
  stage: TutorialStage;
  mode: TutorialRuntimeMode;
  private: boolean;
  inputLocked: boolean;
  templateVersions: TutorialTemplateVersionsV1;
  checklist: CreativeChecklistState;
}

export const CREATIVE_CHECKLIST_ITEMS: readonly CreativeChecklistItem[] = [
  'background',
  'ground',
  'decoration',
  'collectible',
  'enemy',
  'spawn_and_goal',
] as const;

export function createEmptyCreativeChecklist(): CreativeChecklistState {
  return {
    background: 'pending',
    ground: 'pending',
    decoration: 'pending',
    collectible: 'pending',
    enemy: 'pending',
    spawn_and_goal: 'pending',
  };
}

export function cloneCreativeChecklist(
  checklist: CreativeChecklistState,
): CreativeChecklistState {
  return { ...checklist };
}

export function cloneTutorialSceneContext(
  context: TutorialSceneContext | null | undefined,
): TutorialSceneContext | null {
  if (!context) return null;
  return {
    ...context,
    templateVersions: { ...context.templateVersions },
    checklist: cloneCreativeChecklist(context.checklist),
  };
}

export function isTerminalTutorialStage(stage: TutorialStage): boolean {
  return stage === 'completed' || stage === 'dismissed';
}

export function getTutorialTerminalStatus(stage: TutorialStage): TutorialTerminalStatus {
  if (stage === 'completed') return 'completed';
  if (stage === 'dismissed') return 'dismissed';
  return 'active';
}
