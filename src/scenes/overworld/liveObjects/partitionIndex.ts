import type Phaser from 'phaser';
import {
  getObjectDisplayScale,
  isClimbableObjectConfig,
  isMovingPlatformEndpointObjectId,
  isPushableObjectConfig,
  isSolidRuntimeObjectConfig,
  placedObjectLayerAllowsRuntimeCollision,
  ROOM_PX_HEIGHT,
  ROOM_PX_WIDTH,
  TILE_SIZE,
} from '../../../config';
import type { RoomCoordinates } from '../../../persistence/roomModel';
import type { LoadedFullRoom } from '../worldStreaming';
import {
  getLiveObjectBehavior,
  liveObjectBehaviorUpdatesEveryFrame,
} from './behaviorRegistry';
import type { ArcadeObjectBody } from './bodies';
import { isDynamicArcadeBody } from './bodies';
import type { LoadedRoomObject } from './model';

interface RoomLiveObjectPartition {
  source: LoadedRoomObject[];
  sourceLength: number;
  updating: LoadedRoomObject[];
  ladders: LoadedRoomObject[];
  ladderRoomBoundsPadding: number;
  ladderSpatialIndex: LiveObjectSpatialIndex | null;
  pushables: LoadedRoomObject[];
  pushableRoomBoundsPadding: number;
  pushableSpatialIndex: LiveObjectSpatialIndex | null;
  runtimeSolids: LoadedRoomObject[];
  runtimeSolidRoomBoundsPadding: number;
  runtimeSolidSpatialIndex: LiveObjectSpatialIndex | null;
  pathTargetsByInstanceId: Map<string, LoadedRoomObject>;
}

interface LiveObjectSpatialBinRange {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface LiveObjectSpatialIndex {
  readonly binsByX: Map<number, Map<number, Set<LoadedRoomObject>>>;
  readonly binRangeByObject: Map<LoadedRoomObject, LiveObjectSpatialBinRange>;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

type SpatialCategory = 'ladder' | 'pushable' | 'runtimeSolid';

const LIVE_OBJECT_SPATIAL_BIN_SIZE_PX = TILE_SIZE * 4;

export interface LiveObjectPartitionIndexOptions<TEdgeWall> {
  getLoadedFullRooms: () => Iterable<LoadedFullRoom<LoadedRoomObject, TEdgeWall>>;
  getRoomOrigin: (coordinates: RoomCoordinates) => { x: number; y: number };
}

export class LiveObjectPartitionIndex<TEdgeWall = unknown> {
  private readonly partitionsByRoomId = new Map<string, RoomLiveObjectPartition>();
  private readonly partitionByObject = new WeakMap<LoadedRoomObject, RoomLiveObjectPartition>();
  private readonly spatialQueryMarks = new WeakMap<LoadedRoomObject, number>();
  private spatialQueryGeneration = 0;

  constructor(private readonly options: LiveObjectPartitionIndexOptions<TEdgeWall>) {}

  invalidateRoom(roomId: string): void {
    this.partitionsByRoomId.delete(roomId);
  }

  getUpdatingObjects(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
  ): readonly LoadedRoomObject[] {
    return this.getPartition(loadedRoom).updating;
  }

  getPushableObjects(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
  ): readonly LoadedRoomObject[] {
    return this.getPartition(loadedRoom).pushables;
  }

  getRuntimeSolidObjects(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
  ): readonly LoadedRoomObject[] {
    return this.getPartition(loadedRoom).runtimeSolids;
  }

  getPathTarget(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    instanceId: string,
  ): LoadedRoomObject | null {
    return this.getPartition(loadedRoom).pathTargetsByInstanceId.get(instanceId) ?? null;
  }

  prepareDynamicSpatialIndexes(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
  ): void {
    const partition = this.getPartition(loadedRoom);
    if (partition.pushables.length > 0) {
      this.getOrCreateSpatialIndex(partition, 'pushable');
    }
    if (partition.runtimeSolids.length > 0) {
      this.getOrCreateSpatialIndex(partition, 'runtimeSolid');
    }
  }

  refreshDynamicObject(liveObject: LoadedRoomObject): void {
    const partition = this.partitionByObject.get(liveObject);
    if (!partition) {
      return;
    }
    if (partition.pushableSpatialIndex && isPushableObjectConfig(liveObject.config)) {
      this.refreshSpatialIndexMembership(partition.pushableSpatialIndex, liveObject);
    }
    if (
      partition.runtimeSolidSpatialIndex &&
      isSolidRuntimeObjectConfig(liveObject.config) &&
      placedObjectLayerAllowsRuntimeCollision(liveObject.config, liveObject)
    ) {
      this.refreshSpatialIndexMembership(partition.runtimeSolidSpatialIndex, liveObject);
    }
  }

  *queryLaddersInBounds(
    loadedRooms: Iterable<LoadedFullRoom<LoadedRoomObject, TEdgeWall>>,
    bounds: Phaser.Geom.Rectangle,
  ): IterableIterator<LoadedRoomObject> {
    const queryMark = this.nextSpatialQueryMark();
    for (const loadedRoom of loadedRooms) {
      const partition = this.getPartition(loadedRoom);
      if (
        !partition.ladderSpatialIndex &&
        !this.boundsCouldOverlapRoom(
          bounds,
          loadedRoom.room.coordinates,
          partition.ladderRoomBoundsPadding,
        )
      ) {
        continue;
      }
      yield* this.querySpatialIndex(
        this.getOrCreateSpatialIndex(partition, 'ladder'),
        bounds,
        0,
        0,
        queryMark,
      );
    }
  }

  *queryPushablesInBounds(
    bounds: Phaser.Geom.Rectangle,
    paddingX = 0,
    paddingY = paddingX,
  ): IterableIterator<LoadedRoomObject> {
    yield* this.queryObjectsInBounds('pushable', bounds, paddingX, paddingY);
  }

  *queryRuntimeSolidsInBounds(
    bounds: Phaser.Geom.Rectangle,
    paddingX = 0,
    paddingY = paddingX,
  ): IterableIterator<LoadedRoomObject> {
    yield* this.queryObjectsInBounds('runtimeSolid', bounds, paddingX, paddingY);
  }

  private getPartition(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
  ): RoomLiveObjectPartition {
    const existing = this.partitionsByRoomId.get(loadedRoom.room.id);
    if (
      existing?.source === loadedRoom.liveObjects &&
      existing.sourceLength === loadedRoom.liveObjects.length
    ) {
      return existing;
    }

    const updating: LoadedRoomObject[] = [];
    const ladders: LoadedRoomObject[] = [];
    const pushables: LoadedRoomObject[] = [];
    const runtimeSolids: LoadedRoomObject[] = [];
    let ladderRoomBoundsPadding = 0;
    let pushableRoomBoundsPadding = 0;
    let runtimeSolidRoomBoundsPadding = 0;
    const pathTargetsByInstanceId = new Map<string, LoadedRoomObject>();

    for (const liveObject of loadedRoom.liveObjects) {
      const behavior = getLiveObjectBehavior(liveObject.config.id);
      if (
        liveObjectBehaviorUpdatesEveryFrame(behavior) ||
        isDynamicArcadeBody(liveObject.sprite.body as ArcadeObjectBody | null)
      ) {
        updating.push(liveObject);
      }
      if (isClimbableObjectConfig(liveObject.config)) {
        ladders.push(liveObject);
        ladderRoomBoundsPadding = Math.max(
          ladderRoomBoundsPadding,
          this.getLiveObjectRoomBoundsPadding(liveObject),
        );
      }
      if (isPushableObjectConfig(liveObject.config)) {
        pushables.push(liveObject);
        pushableRoomBoundsPadding = Math.max(
          pushableRoomBoundsPadding,
          this.getLiveObjectRoomBoundsPadding(liveObject),
        );
      }
      if (
        isSolidRuntimeObjectConfig(liveObject.config) &&
        placedObjectLayerAllowsRuntimeCollision(liveObject.config, liveObject)
      ) {
        runtimeSolids.push(liveObject);
        runtimeSolidRoomBoundsPadding = Math.max(
          runtimeSolidRoomBoundsPadding,
          this.getLiveObjectRoomBoundsPadding(liveObject),
        );
      }
      if (
        liveObject.placedInstanceId &&
        isMovingPlatformEndpointObjectId(liveObject.config.id)
      ) {
        pathTargetsByInstanceId.set(liveObject.placedInstanceId, liveObject);
      }
    }

    const partition: RoomLiveObjectPartition = {
      source: loadedRoom.liveObjects,
      sourceLength: loadedRoom.liveObjects.length,
      updating,
      ladders,
      ladderRoomBoundsPadding,
      ladderSpatialIndex: null,
      pushables,
      pushableRoomBoundsPadding,
      pushableSpatialIndex: null,
      runtimeSolids,
      runtimeSolidRoomBoundsPadding,
      runtimeSolidSpatialIndex: null,
      pathTargetsByInstanceId,
    };
    for (const liveObject of loadedRoom.liveObjects) {
      this.partitionByObject.set(liveObject, partition);
    }
    this.partitionsByRoomId.set(loadedRoom.room.id, partition);
    return partition;
  }

  private *queryObjectsInBounds(
    category: 'pushable' | 'runtimeSolid',
    bounds: Phaser.Geom.Rectangle,
    paddingX: number,
    paddingY: number,
  ): IterableIterator<LoadedRoomObject> {
    const safePaddingX = Math.max(0, paddingX);
    const safePaddingY = Math.max(0, paddingY);
    const queryMark = this.nextSpatialQueryMark();
    for (const loadedRoom of this.options.getLoadedFullRooms()) {
      const partition = this.getPartition(loadedRoom);
      const existingIndex = category === 'pushable'
        ? partition.pushableSpatialIndex
        : partition.runtimeSolidSpatialIndex;
      const roomBoundsPadding = category === 'pushable'
        ? partition.pushableRoomBoundsPadding
        : partition.runtimeSolidRoomBoundsPadding;
      if (
        !existingIndex &&
        !this.boundsCouldOverlapRoom(
          bounds,
          loadedRoom.room.coordinates,
          roomBoundsPadding + Math.max(safePaddingX, safePaddingY),
        )
      ) {
        continue;
      }
      yield* this.querySpatialIndex(
        existingIndex ?? this.getOrCreateSpatialIndex(partition, category),
        bounds,
        safePaddingX,
        safePaddingY,
        queryMark,
      );
    }
  }

  private boundsCouldOverlapRoom(
    bounds: Phaser.Geom.Rectangle,
    coordinates: RoomCoordinates,
    padding: number,
  ): boolean {
    const origin = this.options.getRoomOrigin(coordinates);
    return (
      bounds.right >= origin.x - padding &&
      bounds.left <= origin.x + ROOM_PX_WIDTH + padding &&
      bounds.bottom >= origin.y - padding &&
      bounds.top <= origin.y + ROOM_PX_HEIGHT + padding
    );
  }

  private getOrCreateSpatialIndex(
    partition: RoomLiveObjectPartition,
    category: SpatialCategory,
  ): LiveObjectSpatialIndex {
    switch (category) {
      case 'ladder':
        partition.ladderSpatialIndex ??= this.createSpatialIndex(partition.ladders);
        return partition.ladderSpatialIndex;
      case 'pushable':
        partition.pushableSpatialIndex ??= this.createSpatialIndex(partition.pushables);
        return partition.pushableSpatialIndex;
      case 'runtimeSolid':
        partition.runtimeSolidSpatialIndex ??= this.createSpatialIndex(partition.runtimeSolids);
        return partition.runtimeSolidSpatialIndex;
    }
  }

  private createSpatialIndex(liveObjects: LoadedRoomObject[]): LiveObjectSpatialIndex {
    const spatialIndex: LiveObjectSpatialIndex = {
      binsByX: new Map(),
      binRangeByObject: new Map(),
      minX: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    };
    for (const liveObject of liveObjects) {
      this.refreshSpatialIndexMembership(spatialIndex, liveObject);
    }
    return spatialIndex;
  }

  private refreshSpatialIndexMembership(
    spatialIndex: LiveObjectSpatialIndex,
    liveObject: LoadedRoomObject,
  ): void {
    const previousRange = spatialIndex.binRangeByObject.get(liveObject) ?? null;
    const body = liveObject.sprite.body as ArcadeObjectBody | null;
    if (!body) {
      if (previousRange) {
        this.removeSpatialIndexMembership(spatialIndex, liveObject, previousRange);
      }
      return;
    }
    const nextRange = this.getSpatialBinRange(body.left, body.top, body.width, body.height);
    if (
      previousRange &&
      previousRange.minX === nextRange.minX &&
      previousRange.maxX === nextRange.maxX &&
      previousRange.minY === nextRange.minY &&
      previousRange.maxY === nextRange.maxY
    ) {
      return;
    }
    if (previousRange) {
      this.removeSpatialIndexMembership(spatialIndex, liveObject, previousRange);
    }

    spatialIndex.binRangeByObject.set(liveObject, nextRange);
    spatialIndex.minX = Math.min(spatialIndex.minX, nextRange.minX);
    spatialIndex.maxX = Math.max(spatialIndex.maxX, nextRange.maxX);
    spatialIndex.minY = Math.min(spatialIndex.minY, nextRange.minY);
    spatialIndex.maxY = Math.max(spatialIndex.maxY, nextRange.maxY);
    for (let binX = nextRange.minX; binX <= nextRange.maxX; binX += 1) {
      let binsByY = spatialIndex.binsByX.get(binX);
      if (!binsByY) {
        binsByY = new Map();
        spatialIndex.binsByX.set(binX, binsByY);
      }
      for (let binY = nextRange.minY; binY <= nextRange.maxY; binY += 1) {
        let bin = binsByY.get(binY);
        if (!bin) {
          bin = new Set();
          binsByY.set(binY, bin);
        }
        bin.add(liveObject);
      }
    }
  }

  private removeSpatialIndexMembership(
    spatialIndex: LiveObjectSpatialIndex,
    liveObject: LoadedRoomObject,
    range: LiveObjectSpatialBinRange,
  ): void {
    spatialIndex.binRangeByObject.delete(liveObject);
    for (let binX = range.minX; binX <= range.maxX; binX += 1) {
      const binsByY = spatialIndex.binsByX.get(binX);
      if (!binsByY) {
        continue;
      }
      for (let binY = range.minY; binY <= range.maxY; binY += 1) {
        const bin = binsByY.get(binY);
        bin?.delete(liveObject);
        if (bin?.size === 0) {
          binsByY.delete(binY);
        }
      }
      if (binsByY.size === 0) {
        spatialIndex.binsByX.delete(binX);
      }
    }
    if (spatialIndex.binRangeByObject.size === 0) {
      spatialIndex.minX = Number.POSITIVE_INFINITY;
      spatialIndex.maxX = Number.NEGATIVE_INFINITY;
      spatialIndex.minY = Number.POSITIVE_INFINITY;
      spatialIndex.maxY = Number.NEGATIVE_INFINITY;
    }
  }

  private *querySpatialIndex(
    spatialIndex: LiveObjectSpatialIndex,
    bounds: Phaser.Geom.Rectangle,
    paddingX: number,
    paddingY: number,
    queryMark: number,
  ): IterableIterator<LoadedRoomObject> {
    const queryRange = this.getSpatialBinRange(
      bounds.left - paddingX,
      bounds.top - paddingY,
      bounds.width + paddingX * 2,
      bounds.height + paddingY * 2,
    );
    if (
      queryRange.maxX < spatialIndex.minX ||
      queryRange.minX > spatialIndex.maxX ||
      queryRange.maxY < spatialIndex.minY ||
      queryRange.minY > spatialIndex.maxY
    ) {
      return;
    }

    for (let binX = queryRange.minX; binX <= queryRange.maxX; binX += 1) {
      const binsByY = spatialIndex.binsByX.get(binX);
      if (!binsByY) {
        continue;
      }
      for (let binY = queryRange.minY; binY <= queryRange.maxY; binY += 1) {
        const bin = binsByY.get(binY);
        if (!bin) {
          continue;
        }
        for (const liveObject of bin) {
          if (this.spatialQueryMarks.get(liveObject) === queryMark) {
            continue;
          }
          this.spatialQueryMarks.set(liveObject, queryMark);
          yield liveObject;
        }
      }
    }
  }

  private getSpatialBinRange(
    left: number,
    top: number,
    width: number,
    height: number,
  ): LiveObjectSpatialBinRange {
    const right = left + Math.max(0, width);
    const bottom = top + Math.max(0, height);
    return {
      minX: Math.floor(left / LIVE_OBJECT_SPATIAL_BIN_SIZE_PX),
      maxX: Math.floor(Math.max(left, right - 0.001) / LIVE_OBJECT_SPATIAL_BIN_SIZE_PX),
      minY: Math.floor(top / LIVE_OBJECT_SPATIAL_BIN_SIZE_PX),
      maxY: Math.floor(Math.max(top, bottom - 0.001) / LIVE_OBJECT_SPATIAL_BIN_SIZE_PX),
    };
  }

  private nextSpatialQueryMark(): number {
    this.spatialQueryGeneration += 1;
    return this.spatialQueryGeneration;
  }

  private getLiveObjectRoomBoundsPadding(liveObject: LoadedRoomObject): number {
    const displayScale = Math.max(1, Math.abs(getObjectDisplayScale(liveObject.config)));
    return Math.max(
      liveObject.config.frameWidth * displayScale,
      liveObject.config.frameHeight * displayScale,
      liveObject.config.bodyWidth * displayScale,
      liveObject.config.bodyHeight * displayScale,
    );
  }
}
