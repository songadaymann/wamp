export type WorldTileLevel = 0 | 1 | 2 | 3 | 4;

export interface WorldTileCoordinate {
  level: WorldTileLevel;
  x: number;
  y: number;
}

export interface WorldTileAddress extends WorldTileCoordinate {
  rendererVersion: string;
}

export interface WorldTileManifestReady {
  generation: number;
  contentHash: string;
  url: string;
  width: 642;
  height: 354;
  overlap: 1;
  byteLength: number;
}

export interface WorldTileManifestEntry {
  address: WorldTileAddress;
  desiredGeneration: number;
  desiredEmpty: boolean;
  ready: WorldTileManifestReady | null;
  staleRoomIds: string[];
}

export interface WorldTileBounds {
  minTileX: number;
  maxTileX: number;
  minTileY: number;
  maxTileY: number;
}

export interface WorldRoomBounds {
  minRoomX: number;
  maxRoomX: number;
  minRoomY: number;
  maxRoomY: number;
}

export interface WorldRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface WorldVelocity {
  x: number;
  y: number;
}

export function worldTileAddressKey(address: WorldTileAddress): string {
  return `${address.rendererVersion}:${address.level}:${address.x}:${address.y}`;
}

export function worldTileCoordinateKey(address: WorldTileCoordinate): string {
  return `${address.level}:${address.x}:${address.y}`;
}
