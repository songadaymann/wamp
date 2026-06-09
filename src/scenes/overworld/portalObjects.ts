import Phaser from 'phaser';
import {
  getOppositePortalObjectId,
  isPortalObjectId,
  type PortalObjectId,
} from '../../config';
import type { RoomCoordinates } from '../../persistence/roomModel';
import type { LoadedFullRoom } from './worldStreaming';
import type { LoadedRoomObject } from './liveObjects';

const PORTAL_TELEPORT_COOLDOWN_MS = 220;

interface PortalObjectMatch<TEdgeWall> {
  loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>;
  liveObject: LoadedRoomObject;
  objectId: PortalObjectId;
}

interface PortalTeleportDestination<TEdgeWall> extends PortalObjectMatch<TEdgeWall> {
  x: number;
  y: number;
  roomCoordinates: RoomCoordinates;
}

interface OverworldPortalObjectControllerHost<TEdgeWall> {
  getMode: () => 'browse' | 'edit' | 'play' | string;
  getCurrentTime: () => number;
  getPlayerBody: () => Phaser.Physics.Arcade.Body | null;
  getLoadedFullRooms: () => Iterable<LoadedFullRoom<LoadedRoomObject, TEdgeWall>>;
  getLoadedFullRoomById: (roomId: string) => LoadedFullRoom<LoadedRoomObject, TEdgeWall> | null;
  teleportPlayerTo: (
    x: number,
    y: number,
    velocity: { x: number; y: number },
  ) => void;
  playPortalFx: (
    x: number,
    y: number,
    roomCoordinates: RoomCoordinates,
  ) => void;
}

export class OverworldPortalObjectController<TEdgeWall = unknown> {
  private portalCooldownUntil = 0;
  private suppressedPortalObjectKey: string | null = null;

  constructor(
    private readonly host: OverworldPortalObjectControllerHost<TEdgeWall>,
  ) {}

  update(): void {
    if (this.host.getMode() !== 'play') {
      this.suppressedPortalObjectKey = null;
      return;
    }

    this.maybeTeleportPlayerThroughPortal();
  }

  handleFullRoomDestroyed(roomId: string): void {
    if (this.suppressedPortalObjectKey?.startsWith(`${roomId}:`)) {
      this.suppressedPortalObjectKey = null;
    }
  }

  resetAll(): void {
    this.portalCooldownUntil = 0;
    this.suppressedPortalObjectKey = null;
  }

  resetForRoom(loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>): void {
    if (this.suppressedPortalObjectKey?.startsWith(`${loadedRoom.room.id}:`)) {
      this.suppressedPortalObjectKey = null;
    }
    this.portalCooldownUntil = 0;
  }

  private maybeTeleportPlayerThroughPortal(): void {
    const playerBody = this.host.getPlayerBody();
    if (!playerBody) {
      this.suppressedPortalObjectKey = null;
      return;
    }

    const portalMatches = this.findPortalObjectsOverlappingBody(playerBody);
    if (portalMatches.length === 0) {
      this.suppressedPortalObjectKey = null;
      return;
    }

    if (
      this.suppressedPortalObjectKey &&
      portalMatches.some((match) => this.getPortalObjectKey(match) === this.suppressedPortalObjectKey)
    ) {
      return;
    }

    this.suppressedPortalObjectKey = null;
    if (this.host.getCurrentTime() < this.portalCooldownUntil) {
      return;
    }

    const source = this.pickNearestPortalObjectMatch(
      portalMatches,
      playerBody.center.x,
      playerBody.center.y,
    );
    const destination = this.resolvePortalDestination(source);
    if (!destination) {
      return;
    }

    this.host.teleportPlayerTo(destination.x, destination.y, {
      x: playerBody.velocity.x,
      y: playerBody.velocity.y,
    });
    this.portalCooldownUntil = this.host.getCurrentTime() + PORTAL_TELEPORT_COOLDOWN_MS;
    this.suppressedPortalObjectKey = this.getPortalObjectKey(destination);
    this.host.playPortalFx(destination.x, destination.y, destination.roomCoordinates);
  }

  private findPortalObjectsOverlappingBody(
    body: Phaser.Physics.Arcade.Body,
  ): Array<PortalObjectMatch<TEdgeWall>> {
    const bodyBounds = new Phaser.Geom.Rectangle(body.x, body.y, body.width, body.height);
    const matches: Array<PortalObjectMatch<TEdgeWall>> = [];

    for (const loadedRoom of this.host.getLoadedFullRooms()) {
      for (const liveObject of loadedRoom.liveObjects) {
        const objectId = isPortalObjectId(liveObject.config.id) ? liveObject.config.id : null;
        if (!objectId || !liveObject.sprite.active) {
          continue;
        }

        if (Phaser.Geom.Intersects.RectangleToRectangle(bodyBounds, liveObject.sprite.getBounds())) {
          matches.push({ loadedRoom, liveObject, objectId });
        }
      }
    }

    return matches;
  }

  private pickNearestPortalObjectMatch(
    matches: Array<PortalObjectMatch<TEdgeWall>>,
    worldX: number,
    worldY: number,
  ): PortalObjectMatch<TEdgeWall> {
    let best = matches[0];
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const match of matches) {
      const distance = Phaser.Math.Distance.Squared(
        worldX,
        worldY,
        match.liveObject.sprite.x,
        match.liveObject.sprite.y,
      );
      if (distance < bestDistance) {
        best = match;
        bestDistance = distance;
      }
    }
    return best;
  }

  private resolvePortalDestination(
    source: PortalObjectMatch<TEdgeWall>,
  ): PortalTeleportDestination<TEdgeWall> | null {
    const directTarget = this.getLinkedPortalTarget(source);
    if (directTarget) {
      return this.getPortalDestination(directTarget);
    }

    if (source.liveObject.linkedTargetInstanceId || source.liveObject.linkedTargetRoomId) {
      return null;
    }

    const reverseTarget = this.findPortalLinkedTo(source);
    return reverseTarget ? this.getPortalDestination(reverseTarget) : null;
  }

  private getLinkedPortalTarget(
    source: PortalObjectMatch<TEdgeWall>,
  ): PortalObjectMatch<TEdgeWall> | null {
    if (!source.liveObject.linkedTargetInstanceId || !source.liveObject.linkedTargetRoomId) {
      return null;
    }

    const targetRoom = this.host.getLoadedFullRoomById(source.liveObject.linkedTargetRoomId);
    if (!targetRoom) {
      return null;
    }

    const oppositeObjectId = getOppositePortalObjectId(source.objectId);
    const target = targetRoom.liveObjects.find(
      (liveObject) =>
        liveObject.placedInstanceId === source.liveObject.linkedTargetInstanceId &&
        liveObject.config.id === oppositeObjectId,
    );
    if (!target || !isPortalObjectId(target.config.id)) {
      return null;
    }

    return { loadedRoom: targetRoom, liveObject: target, objectId: target.config.id };
  }

  private findPortalLinkedTo(
    target: PortalObjectMatch<TEdgeWall>,
  ): PortalObjectMatch<TEdgeWall> | null {
    const targetInstanceId = target.liveObject.placedInstanceId;
    if (!targetInstanceId) {
      return null;
    }

    const oppositeObjectId = getOppositePortalObjectId(target.objectId);
    for (const loadedRoom of this.host.getLoadedFullRooms()) {
      for (const liveObject of loadedRoom.liveObjects) {
        if (
          liveObject.config.id === oppositeObjectId &&
          liveObject.linkedTargetRoomId === target.loadedRoom.room.id &&
          liveObject.linkedTargetInstanceId === targetInstanceId &&
          isPortalObjectId(liveObject.config.id)
        ) {
          return { loadedRoom, liveObject, objectId: liveObject.config.id };
        }
      }
    }

    return null;
  }

  private getPortalDestination(
    target: PortalObjectMatch<TEdgeWall>,
  ): PortalTeleportDestination<TEdgeWall> {
    return {
      ...target,
      x: target.liveObject.sprite.x,
      y: target.liveObject.sprite.y,
      roomCoordinates: { ...target.loadedRoom.room.coordinates },
    };
  }

  private getPortalObjectKey(match: PortalObjectMatch<TEdgeWall>): string {
    return [
      match.loadedRoom.room.id,
      match.liveObject.placedInstanceId ?? match.liveObject.key,
      match.objectId,
    ].join(':');
  }
}
