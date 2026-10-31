import { canObjectBeStoredInContainer, editorState, getObjectById, type GameObjectConfig, type PlacedObject } from '../../config';
import { isCustomSpriteObjectId } from '../../customSprites/model';
import { getRollingBallGraphic, normalizePlacedRollingBall } from '../../config/rollingBall';
import {
  normalizePlacedTriangle,
  parseHexColor,
  triangleFlipFromLegs,
  DEFAULT_TRIANGLE_FILL,
  DEFAULT_TRIANGLE_STROKE,
} from '../../config/trianglePiece';
import type { EditorInspectorState } from './uiBridge';

export interface PressurePlateInspectorOptions {
  statusText: string;
  connectMode: boolean;
  targetSummary: string | null;
  eligibleTargetCount: number;
  connectTitle: string;
  allowReconnectWithTarget?: boolean;
  coopAvailable?: boolean;
  coopPlate?: boolean;
}

export interface ContainerInspectorOptions {
  containerObjectId: string;
  statusText: string | null;
  selectedObject: GameObjectConfig | null;
  selectedLooksLikeContents: boolean;
  canStoreSelected: boolean;
  currentContentsLabel: string | null;
  hasContents: boolean;
}

export function createEmptyEditorInspectorState(): EditorInspectorState {
  return {
    visible: false,
    pinned: false,
    connecting: false,
    selectionId: null,
    pressureVisible: false,
    pressureStatusText: '',
    pressureCoopVisible: false,
    pressureCoopChecked: false,
    pressureConnectHidden: true,
    pressureConnectDisabled: true,
    pressureConnectTitle: '',
    pressureClearHidden: true,
    pressureClearDisabled: true,
    pressureDoneLaterHidden: true,
    containerVisible: false,
    containerStatusText: '',
    containerClearDisabled: true,
    containerClearTitle: '',
    swordsmanVisible: false,
    swordsmanStatusText: '',
    swordsmanObjectiveModeValue: 'duel',
    swordsmanObjectiveModeDisabled: true,
    swordsmanDefeatModeValue: 'defeatable',
    swordsmanDefeatModeDisabled: true,
    policeVisible: false,
    policeStatusText: '',
    policeBehaviorModeValue: 'hunter',
    policeBehaviorModeDisabled: true,
    policePatrolShootsChecked: false,
    policePatrolShootsHidden: true,
    bossVisible: false,
    bossChecked: false,
    bossHitPointsValue: 5,
    npcVisible: false,
    npcStatusText: '',
    npcModeValue: 'idle',
    npcModeDisabled: true,
    npcPushableChecked: false,
    npcPushableHidden: true,
    npcJumpFallChecked: false,
    npcJumpFallHidden: true,
    npcPlayerCollisionChecked: true,
    npcFriendlyFireChecked: true,
    npcNameValue: '',
    npcDialogueValue: '',
    npcDefeatModeValue: 'defeatable',
    ballVisible: false,
    ballStatusText: '',
    ballGraphicValue: 'basic',
    ballWeightValue: '1',
    ballHurtEnemiesChecked: false,
    ballHurtFriendliesChecked: false,
    ballHurtPlayerChecked: false,
    ballPushableChecked: true,
    triangleVisible: false,
    trianglePaintMode: false,
    triangleStatusText: '',
    triangleFlipX: false,
    triangleFlipY: false,
    triangleFillValue: '#8A8F98',
    triangleStrokeValue: '#2C3138',
  };
}

export function buildBallInspectorState(
  placed: PlacedObject,
  statusText: string | null = null,
): EditorInspectorState | null {
  const ball = normalizePlacedRollingBall(placed);
  if (!ball) return null;
  const graphic = getRollingBallGraphic(ball.graphicId);
  return {
    ...createEmptyEditorInspectorState(),
    visible: true,
    ballVisible: true,
    ballStatusText: statusText ?? graphic.name,
    ballGraphicValue: graphic.id,
    ballWeightValue: String(ball.weight),
    ballHurtEnemiesChecked: ball.hurtEnemies,
    ballHurtFriendliesChecked: ball.hurtFriendlies,
    ballHurtPlayerChecked: ball.hurtPlayer,
    ballPushableChecked: ball.pushable,
  };
}

export function buildTriangleInspectorState(
  placed: PlacedObject,
  statusText: string | null = null,
): EditorInspectorState | null {
  const geometry = normalizePlacedTriangle(placed);
  if (!geometry) return null;
  const flip = triangleFlipFromLegs(geometry.legX, geometry.legY);
  return {
    ...createEmptyEditorInspectorState(),
    visible: true,
    triangleVisible: true,
    trianglePaintMode: false,
    triangleStatusText: statusText ?? 'Drag a square handle to move or resize this ramp.',
    triangleFlipX: flip.flipX,
    triangleFlipY: flip.flipY,
    triangleFillValue: geometry.fill,
    triangleStrokeValue: geometry.stroke,
  };
}

export function buildTriangleStampInspectorState(statusText: string | null = null): EditorInspectorState {
  return {
    ...createEmptyEditorInspectorState(),
    visible: true,
    triangleVisible: true,
    trianglePaintMode: editorState.trianglePaintMode,
    triangleStatusText: statusText ?? 'Click empty space to place. Click a ramp to select it.',
    triangleFlipX: editorState.triangleStampFlipX,
    triangleFlipY: editorState.triangleStampFlipY,
    triangleFillValue: parseHexColor(editorState.triangleStampFill, DEFAULT_TRIANGLE_FILL),
    triangleStrokeValue: parseHexColor(editorState.triangleStampStroke, DEFAULT_TRIANGLE_STROKE),
  };
}

export function buildPressurePlateInspectorState(
  options: PressurePlateInspectorOptions,
): EditorInspectorState {
  const targetExists = Boolean(options.targetSummary);
  const canConnect = options.eligibleTargetCount > 0;

  return {
    ...createEmptyEditorInspectorState(),
    visible: true,
    pressureVisible: true,
    pressureCoopVisible: options.coopAvailable === true,
    pressureCoopChecked: options.coopPlate === true,
    pressureStatusText: options.statusText,
    pressureConnectHidden:
      options.connectMode || (targetExists && !options.allowReconnectWithTarget),
    pressureConnectDisabled: options.connectMode || !canConnect,
    pressureConnectTitle: canConnect
      ? ''
      : options.connectTitle,
    pressureClearHidden: options.connectMode,
    pressureClearDisabled: !targetExists,
    pressureDoneLaterHidden: !options.connectMode,
  };
}

export function buildContainerInspectorState(
  options: ContainerInspectorOptions,
): EditorInspectorState {
  return {
    ...createEmptyEditorInspectorState(),
    visible: true,
    containerVisible: true,
    containerStatusText: options.statusText ?? getContainerInspectorStatusText(options),
    containerClearDisabled: !options.hasContents,
    containerClearTitle: options.hasContents ? '' : 'This container is empty.',
  };
}

export function getContainerLabel(objectId: string): string {
  switch (objectId) {
    case 'cage':
      return 'cage';
    case 'brick_box':
      return 'brick box';
    case 'crate':
      return 'crate';
    default:
      return 'treasure chest';
  }
}

export function getContainerName(objectId: string): string {
  switch (objectId) {
    case 'cage':
      return 'This cage';
    case 'brick_box':
      return 'This brick box';
    case 'crate':
      return 'This crate';
    default:
      return 'This treasure chest';
  }
}

export function getContainerAcceptedContentsLabel(objectId: string): string {
  return objectId === 'cage' ? 'enemies or crates' : 'collectibles';
}

/** Save normalization, command validation and gameplay currently use built-in contents. */
export function canStoreEditorContainerContents(containerId: string, selected: GameObjectConfig | null): boolean {
  return canObjectBeStoredInContainer(containerId, selected ? getObjectById(selected.id) : null);
}

export function unsupportedContainerSelectionText(selected: GameObjectConfig | null): string | null {
  return selected && isCustomSpriteObjectId(selected.id)
    ? 'Custom sprites cannot go inside containers yet. Choose built-in contents.' : null;
}

function getContainerInspectorStatusText(options: ContainerInspectorOptions): string {
  const selectedObject = options.selectedObject;
  const containerLabel = getContainerLabel(options.containerObjectId);
  const containerName = getContainerName(options.containerObjectId);
  const acceptedContentsLabel = getContainerAcceptedContentsLabel(options.containerObjectId);

  const unsupported = unsupportedContainerSelectionText(selectedObject);
  if (unsupported) return unsupported;
  if (options.canStoreSelected && selectedObject) {
    return `Click this ${containerLabel} to stash ${selectedObject.name} inside.`;
  }
  if (options.selectedLooksLikeContents && selectedObject) {
    return `${containerName} can only hold ${acceptedContentsLabel}.`;
  }
  if (options.currentContentsLabel) {
    return `${containerName} currently holds ${options.currentContentsLabel}. Select a ${acceptedContentsLabel} and click it to change the contents.`;
  }
  return `${containerName} is empty. Select a ${acceptedContentsLabel} from the object list, then click it to fill the container.`;
}
