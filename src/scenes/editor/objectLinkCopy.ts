import { canPlacedObjectTriggerOtherObjects, getObjectById, isMovingPlatformEndpointObjectId,
  isMovingPlatformObjectId, isPortalObjectId, type PlacedObject } from '../../config';
import { canPlacedObjectUseObjectPath } from '../../placedObjects/objectPaths';
import { isRoomVideoLinkTarget } from '../../roomVideo/link';

interface ObjectLinkCopyContext { scope: 'room' | 'expanded room'; videoAnchor: boolean }

/** Link guidance uses the source cell's capabilities, independently of inspector layout. */
export class EditorObjectLinkCopy {
  constructor(private readonly context: (source: PlacedObject) => ObjectLinkCopyContext) {}

  sourceLabel(source: PlacedObject | null): string {
    if (source && isMovingPlatformObjectId(source.id)) return 'Moving platform';
    if (source && isPortalObjectId(source.id)) return getObjectById(source.id)?.name ?? 'Portal';
    return 'Pressure plate';
  }

  targetLabel(objectId: string): string {
    if (isMovingPlatformEndpointObjectId(objectId)) return 'Moving Platform Anchor';
    if (isPortalObjectId(objectId)) return getObjectById(objectId)?.name ?? 'Portal';
    const labels: Record<string, string> = {
      door_locked: 'door', door_locked_narrow: 'narrow wooden door',
      door_metal: 'metal door', door_metal_narrow: 'narrow metal door',
      treasure_chest: 'treasure chest', cage: 'cage', trapdoor_metal: 'metal trapdoor',
      trapdoor_locked: 'locked trapdoor', blast_door: 'blast door', barricade: 'barricade',
      wooden_bridge: 'wooden bridge',
    };
    return labels[objectId] ?? getObjectById(objectId)?.name ?? 'object';
  }

  linkedStatus(source: PlacedObject, targets: readonly PlacedObject[]): string {
    if (canPlacedObjectUseObjectPath(source)) {
      return `Moving platform path has ${targets.length} ${targets.length === 1 ? 'stop' : 'stops'}.`;
    }
    if (isRoomVideoLinkTarget(source.triggerTargetInstanceId)) return `${this.sourceLabel(source)} linked to the video.`;
    return targets[0] ? `${this.sourceLabel(source)} linked to ${this.targetLabel(targets[0].id)}.`
      : `${this.sourceLabel(source)} is not linked yet.`;
  }

  connectStatus(source: PlacedObject, eligibleTargetCount: number): string {
    return eligibleTargetCount > 0 || this.hasVideo(source) ? this.pickTargetStatus(source) : this.noTargetsStatus(source);
  }

  beginStatus(source: PlacedObject, autoPlaced: boolean): string {
    if (isMovingPlatformObjectId(source.id)) return autoPlaced
      ? 'Moving platform placed. Click Moving Platform Anchors to add path stops.'
      : 'Click Moving Platform Anchors to add or remove path stops.';
    if (isPortalObjectId(source.id)) return autoPlaced
      ? `${this.sourceLabel(source)} placed. Click the opposite portal to connect it.`
      : `Click the opposite portal to connect this ${this.sourceLabel(source)}.`;
    const targets = this.targetList(source);
    return autoPlaced ? `Pressure plate placed. Click ${targets} to link it.`
      : `Click ${targets} to link this pressure plate.`;
  }

  pickTargetStatus(source: PlacedObject): string {
    const scope = this.context(source).scope;
    if (isMovingPlatformObjectId(source.id)) return `Pick Moving Platform Anchors in this ${scope}.`;
    if (isPortalObjectId(source.id)) return `Pick the opposite portal in this ${scope}.`;
    return `Pick ${this.targetList(source)} in this ${scope}.`;
  }

  noTargetsStatus(source: PlacedObject): string {
    const scope = this.context(source).scope;
    if (isMovingPlatformObjectId(source.id)) return `No Moving Platform Anchor is in this ${scope} yet. You can link this moving platform later.`;
    if (isPortalObjectId(source.id)) return `No opposite portal is in this ${scope} yet. You can link this portal later.`;
    if (this.hasVideo(source)) return scope === 'expanded room'
      ? "Click this cell's video anchor to link this pressure plate."
      : 'Click the anchor on the video to link this pressure plate.';
    return `No door, barricade, cage, or chest is in this ${scope} yet. You can link this pressure plate later.`;
  }

  noTargetsTitle(source: PlacedObject): string {
    const scope = this.context(source).scope;
    if (isMovingPlatformObjectId(source.id)) return `Add a Moving Platform Anchor to this ${scope} first.`;
    if (isPortalObjectId(source.id)) return `Add the opposite portal to this ${scope} first.`;
    if (this.hasVideo(source)) return scope === 'expanded room' ? "Link to this cell's video anchor." : 'Link to the video anchor.';
    return `Add a door, barricade, cage, or chest to this ${scope} first.`;
  }

  private hasVideo(source: PlacedObject): boolean {
    return canPlacedObjectTriggerOtherObjects(source) && this.context(source).videoAnchor;
  }

  private targetList(source: PlacedObject): string {
    if (!this.hasVideo(source)) return 'a door, barricade, cage, or chest';
    return this.context(source).scope === 'expanded room'
      ? "a door, barricade, cage, chest, or this cell's video anchor"
      : 'a door, barricade, cage, chest, or the video anchor';
  }
}
