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
  readyEmptyGeneration: number | null;
  ready: WorldTileManifestReady | null;
  staleRoomIds: string[];
}

export interface WorldTileConfig {
  schemaVersion: 1;
  available: boolean;
  rolloutPercentage: number;
  activeRendererVersion: string | null;
}

export interface WorldTileRoomSummary {
  id: string;
  coordinates: { x: number; y: number };
  title: string | null;
  state: 'published';
  goalType: string | null;
  version: number;
  publishedAt: string | null;
  previewUpdatedAt: string | null;
  creatorUserId: string | null;
  creatorDisplayName: string | null;
}

export interface WorldTileManifest {
  schemaVersion: 1;
  rendererVersion: string;
  level: WorldTileLevel;
  targetBounds: WorldTileBounds;
  entries: WorldTileManifestEntry[];
  rooms: WorldTileRoomSummary[];
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
