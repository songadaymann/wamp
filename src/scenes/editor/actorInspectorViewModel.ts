import { getObjectById, type PlacedObject } from '../../config';
import { SWORDSMAN_AI_OBJECT_ID } from '../../enemies/swordsmanAi';
import { DEFAULT_POLICE_BEHAVIOR_MODE, getPlacedPoliceBehaviorMode, getPlacedPolicePatrolShoots, isPoliceEnemyObjectId } from '../../enemies/policeEnemy';
import { DEFAULT_SWORDSMAN_OBJECTIVE_MODE, DEFAULT_SWORDSMAN_DEFEAT_MODE, SWORDSMAN_OBJECTIVE_MODE_LABELS, SWORDSMAN_DEFEAT_MODE_LABELS, normalizeSwordsmanObjectiveMode, normalizeSwordsmanDefeatMode } from '../../enemies/swordsmanObjectives';
import { NPC_MODE_LABELS, getPlacedNpcMode, isNpcObjectId, normalizeNpcPushable, normalizeNpcCanJumpFall, normalizeNpcPlayerCollision, normalizeNpcFriendlyFire, normalizeNpcName, normalizeNpcDefeatMode } from '../../npcs/model';
import { getPlacedObjectSignText } from '../../signs/model';
import { createEmptyEditorInspectorState } from './inspectorViewModel';
import type { EditorInspectorState } from './uiBridge/model';

export function isInspectorActor(placed: PlacedObject): boolean {
  return placed.id === SWORDSMAN_AI_OBJECT_ID || isPoliceEnemyObjectId(placed.id) || isNpcObjectId(placed.id);
}

/** Actor settings shared by ordinary and expanded rooms. */
export function buildActorInspectorState(placed: PlacedObject, statusText: string | null = null): EditorInspectorState | null {
  const hiddenState = createEmptyEditorInspectorState();
  const focusedSwordsman = placed.id === SWORDSMAN_AI_OBJECT_ID ? placed : null;
  if (focusedSwordsman) {
    const objectiveMode =
      normalizeSwordsmanObjectiveMode(focusedSwordsman.swordsmanObjectiveMode)
      ?? DEFAULT_SWORDSMAN_OBJECTIVE_MODE;
    const defeatMode =
      normalizeSwordsmanDefeatMode(focusedSwordsman.swordsmanDefeatMode)
      ?? DEFAULT_SWORDSMAN_DEFEAT_MODE;
    return {
      ...hiddenState,
      visible: true,
      swordsmanVisible: true,
      swordsmanStatusText:
        statusText
        ?? `This Sword Hunter is set to ${SWORDSMAN_OBJECTIVE_MODE_LABELS[objectiveMode]} / ${SWORDSMAN_DEFEAT_MODE_LABELS[defeatMode]}.`,
      swordsmanObjectiveModeValue: objectiveMode,
      swordsmanObjectiveModeDisabled: false,
      swordsmanDefeatModeValue: defeatMode,
      swordsmanDefeatModeDisabled: false,
    };
  }

  const focusedPolice = isPoliceEnemyObjectId(placed.id) ? placed : null;
  if (focusedPolice) {
    const mode = getPlacedPoliceBehaviorMode(focusedPolice) ?? DEFAULT_POLICE_BEHAVIOR_MODE;
    const patrolShoots = getPlacedPolicePatrolShoots(focusedPolice);
    const objectName = getObjectById(focusedPolice.id)?.name ?? 'Police enemy';
    return {
      ...hiddenState,
      visible: true,
      policeVisible: true,
      policeStatusText:
        statusText
        ?? (mode === 'hunter'
          ? `${objectName} will chase and shoot the player.`
          : `${objectName} will patrol ${patrolShoots ? 'and shoot on sight' : 'without shooting'}.`),
      policeBehaviorModeValue: mode,
      policeBehaviorModeDisabled: false,
      policePatrolShootsChecked: patrolShoots,
      policePatrolShootsHidden: mode !== 'patrol',
    };
  }

  const focusedNpc = isNpcObjectId(placed.id) ? placed : null;
  if (focusedNpc) {
    const mode = getPlacedNpcMode(focusedNpc);
    const objectName = getObjectById(focusedNpc.id)?.name ?? 'NPC';
    return {
      ...hiddenState,
      visible: true,
      npcVisible: true,
      npcStatusText: statusText ?? `${objectName} is set to ${NPC_MODE_LABELS[mode]}.`,
      npcModeValue: mode,
      npcModeDisabled: false,
      npcPushableChecked: normalizeNpcPushable(focusedNpc.npcPushable, mode),
      npcPushableHidden: mode !== 'idle',
      npcJumpFallChecked: normalizeNpcCanJumpFall(focusedNpc.npcCanJumpFall, mode),
      npcJumpFallHidden: mode === 'idle' || mode === 'follow',
      npcPlayerCollisionChecked: normalizeNpcPlayerCollision(
        focusedNpc.npcPlayerCollision,
      ),
      npcFriendlyFireChecked: normalizeNpcFriendlyFire(focusedNpc.npcFriendlyFire),
      npcNameValue: normalizeNpcName(focusedNpc.npcName, objectName),
      npcDialogueValue: getPlacedObjectSignText(focusedNpc) ?? '',
      npcDefeatModeValue: normalizeNpcDefeatMode(focusedNpc.npcDefeatMode),
    };
  }

  return null;
}
