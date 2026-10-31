import {
  TILE_SIZE,
  editorState,
  getObjectPlacementPointForTile,
  createPlacedObjectInstanceId,
  isRollingBallObjectId,
  isTrianglePieceObjectId,
  rollingBallSettingsFromGraphic,
  normalizeRollingBallWeight,
  type GameObjectConfig,
  type PlacedObject,
} from '../../config';
import {
  DEFAULT_TRIANGLE_FILL,
  DEFAULT_TRIANGLE_STROKE,
  TRIANGLE_PIECE_OBJECT_ID,
  applyTriangleStampOrientation,
  defaultTriangleLegs,
  normalizePlacedTriangle,
  parseHexColor,
  snapTriangleLeg,
  triangleBitmapLayout,
} from '../../config/trianglePiece';
import { stampedTriangleFields } from './triangleStamp';
import { getEditorObjectConfigById } from '../../customSprites/objectConfig';
import { getCustomSpriteDefinitionByObjectId } from '../../customSprites/registry';
import { SWORDSMAN_AI_OBJECT_ID } from '../../enemies/swordsmanAi';
import {
  DEFAULT_POLICE_BEHAVIOR_MODE,
  DEFAULT_POLICE_PATROL_SHOOTS,
  isPoliceEnemyObjectId,
} from '../../enemies/policeEnemy';
import {
  DEFAULT_SWORDSMAN_DEFEAT_MODE,
  DEFAULT_SWORDSMAN_OBJECTIVE_MODE,
} from '../../enemies/swordsmanObjectives';
import {
  DEFAULT_NPC_DEFEAT_MODE,
  DEFAULT_NPC_FRIENDLY_FIRE,
  DEFAULT_NPC_MODE,
  DEFAULT_NPC_PLAYER_COLLISION,
  isNpcObjectId,
} from '../../npcs/model';

interface UtilityObjectEditHost {
  getPlacedObjects(): PlacedObject[];
  setPlacedObjects(objects: PlacedObject[]): void;
  clonePlacedObjects(objects?: PlacedObject[]): PlacedObject[];
  rebuildObjectSprites(): void;
  markRoomDirty(): void;
  recordObjects(previous: PlacedObject[], next: PlacedObject[]): void;
  getRoomOrigin(): { x: number; y: number };
  getPlacedObjectByInstanceId(instanceId: string | null | undefined): PlacedObject | null;
}

export function resolveEditorPlaceObjectConfig(): GameObjectConfig | null {
  const placingTriangleTool = editorState.activeTool === 'triangle';
  if (!editorState.selectedObjectId && !placingTriangleTool) return null;
  const id = placingTriangleTool ? TRIANGLE_PIECE_OBJECT_ID : editorState.selectedObjectId;
  return getEditorObjectConfigById(id) ?? null;
}

export function createEditorPlacedObject(objectConfig: GameObjectConfig, tileX: number, tileY: number): PlacedObject {
  const placingTriangleTool = editorState.activeTool === 'triangle';
  const selectedId = editorState.selectedObjectId;
  const triangle = isTrianglePieceObjectId(objectConfig.id);
  const ball = isRollingBallObjectId(objectConfig.id) ? rollingBallSettingsFromGraphic('basic') : null;
  const legs = triangle
    ? defaultTriangleLegs(
      placingTriangleTool ? editorState.triangleStampFlipX : editorState.tileFlipXMode === 'on',
      placingTriangleTool ? editorState.triangleStampFlipY : editorState.tileFlipYMode === 'on',
    )
    : null;
  const placementPoint = triangle
    ? { x: tileX * TILE_SIZE, y: (tileY + 1) * TILE_SIZE }
    : getObjectPlacementPointForTile(objectConfig, tileX, tileY);
  return {
    id: objectConfig.id,
    x: placementPoint.x,
    y: placementPoint.y,
    instanceId: createPlacedObjectInstanceId(),
    customSpriteKind: getCustomSpriteDefinitionByObjectId(objectConfig.id)?.kind ?? null,
    facing: objectConfig.facingDirection ? editorState.objectFacing : undefined,
    layer: editorState.activeLayer,
    triggerTargetInstanceId: null,
    linkedTargetInstanceIds: null,
    containedObjectId: null,
    signText: null,
    swordsmanObjectiveMode: selectedId === SWORDSMAN_AI_OBJECT_ID ? DEFAULT_SWORDSMAN_OBJECTIVE_MODE : null,
    swordsmanDefeatMode: selectedId === SWORDSMAN_AI_OBJECT_ID ? DEFAULT_SWORDSMAN_DEFEAT_MODE : null,
    policeBehaviorMode: isPoliceEnemyObjectId(selectedId) ? DEFAULT_POLICE_BEHAVIOR_MODE : null,
    policePatrolShoots: isPoliceEnemyObjectId(selectedId) ? DEFAULT_POLICE_PATROL_SHOOTS : null,
    npcMode: isNpcObjectId(objectConfig.id) ? DEFAULT_NPC_MODE : null,
    npcPushable: isNpcObjectId(objectConfig.id) ? false : null,
    npcCanJumpFall: isNpcObjectId(objectConfig.id) ? false : null,
    npcPlayerCollision: isNpcObjectId(objectConfig.id) ? DEFAULT_NPC_PLAYER_COLLISION : null,
    npcFriendlyFire: isNpcObjectId(objectConfig.id) ? DEFAULT_NPC_FRIENDLY_FIRE : null,
    npcName: isNpcObjectId(objectConfig.id) ? objectConfig.name : null,
    npcDefeatMode: isNpcObjectId(objectConfig.id) ? DEFAULT_NPC_DEFEAT_MODE : null,
    ballGraphic: ball?.graphicId ?? null,
    ballWeight: ball?.weight ?? null,
    ballHurtEnemies: ball ? ball.hurtEnemies : null,
    ballHurtFriendlies: ball ? ball.hurtFriendlies : null,
    ballHurtPlayer: ball ? ball.hurtPlayer : null,
    ballPushable: ball ? ball.pushable : null,
    triangleLegX: legs?.legX ?? null,
    triangleLegY: legs?.legY ?? null,
    triangleFill: triangle
      ? (placingTriangleTool
        ? parseHexColor(editorState.triangleStampFill, DEFAULT_TRIANGLE_FILL)
        : DEFAULT_TRIANGLE_FILL)
      : null,
    triangleStroke: triangle
      ? (placingTriangleTool
        ? parseHexColor(editorState.triangleStampStroke, DEFAULT_TRIANGLE_STROKE)
        : DEFAULT_TRIANGLE_STROKE)
      : null,
  };
}

export function triangleSelectionBounds(
  placed: PlacedObject,
  origin: { x: number; y: number },
): { x: number; y: number; width: number; height: number } | null {
  const triangle = normalizePlacedTriangle(placed);
  if (!triangle) return null;
  const layout = triangleBitmapLayout(triangle.legX, triangle.legY);
  const left = origin.x + triangle.anchorX - layout.anchorX;
  const top = origin.y + triangle.anchorY - layout.anchorY;
  return { x: left - 4, y: top - 4, width: layout.width + 8, height: layout.height + 8 };
}

export class UtilityObjectEditor {
  private triangleDragBaseline: PlacedObject[] | null = null;

  constructor(private readonly host: UtilityObjectEditHost) {}

  setRollingBallGraphic(instanceId: string, graphicId: string): boolean {
    const preset = rollingBallSettingsFromGraphic(graphicId);
    return this.updateUtilityObject(instanceId, isRollingBallObjectId, (placed) => ({
      ...placed,
      ballGraphic: preset.graphicId,
      ballWeight: preset.weight,
      ballHurtEnemies: preset.hurtEnemies,
      ballHurtFriendlies: preset.hurtFriendlies,
      ballHurtPlayer: preset.hurtPlayer,
      ballPushable: preset.pushable,
    }));
  }

  setRollingBallWeight(instanceId: string, weight: number): boolean {
    return this.updateUtilityObject(instanceId, isRollingBallObjectId, (placed) => ({
      ...placed,
      ballWeight: normalizeRollingBallWeight(weight, placed.ballWeight ?? 1),
    }));
  }

  setRollingBallHurtEnemies(instanceId: string, enabled: boolean): boolean {
    return this.updateUtilityObject(instanceId, isRollingBallObjectId, (placed) => ({ ...placed, ballHurtEnemies: enabled }));
  }

  setRollingBallHurtFriendlies(instanceId: string, enabled: boolean): boolean {
    return this.updateUtilityObject(instanceId, isRollingBallObjectId, (placed) => ({ ...placed, ballHurtFriendlies: enabled }));
  }

  setRollingBallHurtPlayer(instanceId: string, enabled: boolean): boolean {
    return this.updateUtilityObject(instanceId, isRollingBallObjectId, (placed) => ({ ...placed, ballHurtPlayer: enabled }));
  }

  setRollingBallPushable(instanceId: string, enabled: boolean): boolean {
    return this.updateUtilityObject(instanceId, isRollingBallObjectId, (placed) => ({ ...placed, ballPushable: enabled }));
  }

  setTriangleColors(instanceId: string, fill: string | null, stroke: string | null): boolean {
    return this.updateUtilityObject(instanceId, isTrianglePieceObjectId, (placed) => ({
      ...placed,
      triangleFill: fill == null ? placed.triangleFill : parseHexColor(fill, placed.triangleFill ?? DEFAULT_TRIANGLE_FILL),
      triangleStroke: stroke == null ? placed.triangleStroke : parseHexColor(stroke, placed.triangleStroke ?? DEFAULT_TRIANGLE_STROKE),
    }));
  }

  applyTriangleStamp(instanceId: string): boolean {
    return this.updateUtilityObject(instanceId, isTrianglePieceObjectId, (placed) => ({
      ...placed,
      ...stampedTriangleFields(placed),
    }));
  }

  setTriangleOrientation(instanceId: string, flipX: boolean, flipY: boolean): boolean {
    return this.updateUtilityObject(instanceId, isTrianglePieceObjectId, (placed) => {
      const geometry = normalizePlacedTriangle(placed);
      if (!geometry) return placed;
      const next = applyTriangleStampOrientation(geometry.legX, geometry.legY, flipX, flipY);
      return { ...placed, triangleLegX: next.legX, triangleLegY: next.legY };
    });
  }

  flipTriangle(instanceId: string, axis: 'x' | 'y'): boolean {
    return this.updateUtilityObject(instanceId, isTrianglePieceObjectId, (placed) => {
      const geometry = normalizePlacedTriangle(placed);
      if (!geometry) return placed;
      return {
        ...placed,
        triangleLegX: axis === 'x' ? snapTriangleLeg(-geometry.legX) : geometry.legX,
        triangleLegY: axis === 'y' ? snapTriangleLeg(-geometry.legY) : geometry.legY,
      };
    });
  }

  beginTriangleDrag(instanceId: string): boolean {
    if (!isTrianglePieceObjectId(this.host.getPlacedObjectByInstanceId(instanceId)?.id)) return false;
    this.triangleDragBaseline = this.host.clonePlacedObjects();
    return true;
  }

  applyTriangleDrag(
    instanceId: string,
    next: { anchorX: number; anchorY: number; legX: number; legY: number },
  ): boolean {
    const origin = this.host.getRoomOrigin();
    return this.updateUtilityObject(instanceId, isTrianglePieceObjectId, (placed) => ({
      ...placed,
      x: next.anchorX - origin.x,
      y: next.anchorY - origin.y,
      triangleLegX: snapTriangleLeg(next.legX),
      triangleLegY: snapTriangleLeg(next.legY),
    }), false);
  }

  commitTriangleDrag(): void {
    const previous = this.triangleDragBaseline;
    this.triangleDragBaseline = null;
    if (!previous) return;
    const next = this.host.clonePlacedObjects();
    if (JSON.stringify(previous) === JSON.stringify(next)) return;
    this.host.recordObjects(previous, next);
    this.host.markRoomDirty();
  }

  private updateUtilityObject(
    instanceId: string,
    matches: (id: string) => boolean,
    update: (placed: PlacedObject) => PlacedObject,
    recordHistory = true,
  ): boolean {
    const placedObjects = this.host.getPlacedObjects();
    const objectIndex = placedObjects.findIndex((placed) => placed.instanceId === instanceId);
    if (objectIndex < 0 || !matches(placedObjects[objectIndex]?.id ?? '')) return false;
    const previous = this.host.clonePlacedObjects();
    const nextObject = update(previous[objectIndex]);
    if (JSON.stringify(previous[objectIndex]) === JSON.stringify(nextObject)) return true;
    const next = previous.map((placed, index) => index === objectIndex ? nextObject : placed);
    this.host.setPlacedObjects(next);
    this.host.rebuildObjectSprites();
    if (recordHistory) {
      this.host.recordObjects(previous, this.host.clonePlacedObjects(next));
      this.host.markRoomDirty();
    }
    return true;
  }
}
