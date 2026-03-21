import {
  getPlacedObjectInstanceId,
  LAYER_NAMES,
  ROOM_HEIGHT,
  ROOM_WIDTH,
  decodeTileDataValue,
  encodeTileDataValue,
  getPlacedObjectLayer,
  type LayerName,
  type PlacedObject,
} from '../config';
import { cloneRoomGoal, normalizeRoomGoal, type RoomGoal } from '../goals/roomGoals';
import {
  createDefaultRoomSnapshot,
  normalizeRoomTitle,
  type RoomCoordinates,
  type RoomSnapshot,
  type RoomTileData,
} from '../persistence/roomModel';

export const WAMP_MINTED_ROOM_SCHEMA_VERSION_V1 = 1 as const;
export const WAMP_MINTED_ROOM_SCHEMA_VERSION_V2 = 2 as const;
export const WAMP_MINTED_ROOM_SCHEMA_VERSION = WAMP_MINTED_ROOM_SCHEMA_VERSION_V2;
export const ROOM_TOKEN_METADATA_MIME = 'data:application/json;base64,';

type WampMintedRoomPayloadVersion =
  | typeof WAMP_MINTED_ROOM_SCHEMA_VERSION_V1
  | typeof WAMP_MINTED_ROOM_SCHEMA_VERSION_V2;
type WampV2LayerKey = 'b' | 't' | 'f';
type WampGoalCode = 'e' | 'c' | 'd' | 'k' | 's';

export interface WampMintedRoomObject {
  id: string;
  x: number;
  y: number;
  facing: 'left' | 'right' | null;
  layer: LayerName;
  containedObjectId?: string | null;
}

export interface WampMintedRoomPayload {
  v: WampMintedRoomPayloadVersion;
  roomId: string;
  coordinates: [number, number];
  title: string | null;
  background: string;
  goal: RoomGoal | null;
  spawnPoint: [number, number] | null;
  tiles: Record<LayerName, string>;
  placedObjects: WampMintedRoomObject[];
  version: number;
  publishedAt: string | null;
}

interface WampMintedReachExitGoalV2 {
  t: 'e';
  e?: [number, number];
  l?: number;
}

interface WampMintedCollectTargetGoalV2 {
  t: 'c';
  r: number;
  l?: number;
}

interface WampMintedDefeatAllGoalV2 {
  t: 'd';
  l?: number;
}

interface WampMintedCheckpointSprintGoalV2 {
  t: 'k';
  c?: [number, number][];
  f?: [number, number];
  l?: number;
}

interface WampMintedSurvivalGoalV2 {
  t: 's';
  d: number;
}

type WampMintedRoomGoalV2 =
  | WampMintedReachExitGoalV2
  | WampMintedCollectTargetGoalV2
  | WampMintedDefeatAllGoalV2
  | WampMintedCheckpointSprintGoalV2
  | WampMintedSurvivalGoalV2;

export interface WampMintedRoomPayloadV2 {
  v: typeof WAMP_MINTED_ROOM_SCHEMA_VERSION_V2;
  c: [number, number];
  n?: string;
  b: string;
  g?: WampMintedRoomGoalV2;
  s?: [number, number];
  t?: Partial<Record<WampV2LayerKey, string>>;
  k?: string[];
  o?: Array<[number, number, number, number, number?]>;
  pv: number;
  pt?: string;
}

export type StoredWampMintedRoomPayload = WampMintedRoomPayload | WampMintedRoomPayloadV2;

export interface WampRoomTokenAttribute {
  trait_type: string;
  value: string | number;
  display_type?: 'number';
}

interface WampRoomTokenMetadataBase<TPayload> {
  name: string;
  description: string;
  image: string;
  animation_url: string;
  attributes: WampRoomTokenAttribute[];
  wamp_room: TPayload;
}

export type WampRoomTokenMetadata = WampRoomTokenMetadataBase<WampMintedRoomPayload>;
export type StoredWampRoomTokenMetadata = WampRoomTokenMetadataBase<StoredWampMintedRoomPayload>;

export interface RoomTokenMetadataBuildOptions {
  origin: string;
  chainId: number;
  contractAddress: string;
  tokenId: string;
}

export interface BuiltRoomTokenMetadata {
  payload: WampMintedRoomPayload;
  storedPayload: StoredWampMintedRoomPayload;
  metadata: StoredWampRoomTokenMetadata;
  metadataJson: string;
  tokenUri: string;
  metadataHash: string;
}

export interface RoomMetadataRefreshPrepareRequestBody {
  tokenUri: string;
}

export interface RoomMetadataRefreshPrepareResponse {
  roomId: string;
  roomCoordinates: RoomCoordinates;
  linkedWalletAddress: string;
  contractAddress: string;
  tokenId: string;
  chain: {
    chainId: number;
    name: string;
    rpcUrl: string;
    blockExplorerUrl: string | null;
    nativeCurrency: {
      name: string;
      symbol: string;
      decimals: number;
    };
  };
  transaction: {
    to: string;
    data: string;
    value: string;
    chainId: number;
  };
}

export interface RoomMetadataRefreshConfirmRequestBody {
  txHash: string;
  metadataRoomVersion: number;
  metadataHash: string;
}

export function buildWampMintedRoomPayload(snapshot: RoomSnapshot): WampMintedRoomPayload {
  return {
    v: WAMP_MINTED_ROOM_SCHEMA_VERSION,
    roomId: snapshot.id,
    coordinates: [snapshot.coordinates.x, snapshot.coordinates.y],
    title: normalizeRoomTitle(snapshot.title),
    background: snapshot.background,
    goal: cloneRoomGoal(snapshot.goal),
    spawnPoint: snapshot.spawnPoint ? [snapshot.spawnPoint.x, snapshot.spawnPoint.y] : null,
    tiles: {
      background: encodeTileLayerV2(snapshot.tileData.background),
      terrain: encodeTileLayerV2(snapshot.tileData.terrain),
      foreground: encodeTileLayerV2(snapshot.tileData.foreground),
    },
    placedObjects: snapshot.placedObjects.map((placed) => ({
      id: placed.id,
      x: placed.x,
      y: placed.y,
      facing: placed.facing === 'left' || placed.facing === 'right' ? placed.facing : null,
      layer: getPlacedObjectLayer(placed),
      containedObjectId: placed.containedObjectId ?? null,
    })),
    version: snapshot.version,
    publishedAt: snapshot.publishedAt,
  };
}

export function buildRoomSnapshotFromMintedPayload(
  payload: WampMintedRoomPayload
): RoomSnapshot {
  const coordinates = {
    x: payload.coordinates[0],
    y: payload.coordinates[1],
  };
  const snapshot = createDefaultRoomSnapshot(payload.roomId, coordinates);

  snapshot.title = normalizeRoomTitle(payload.title);
  snapshot.background = payload.background;
  snapshot.goal = normalizeRoomGoal(payload.goal);
  snapshot.spawnPoint = payload.spawnPoint
    ? {
        x: payload.spawnPoint[0],
        y: payload.spawnPoint[1],
      }
    : null;
  snapshot.tileData = decodeMintedTileData(payload.v, payload.tiles);
  snapshot.placedObjects = payload.placedObjects.map((placed, index) => ({
    id: placed.id,
    x: placed.x,
    y: placed.y,
    instanceId: getPlacedObjectInstanceId(
      {
        id: placed.id,
        x: placed.x,
        y: placed.y,
        facing: placed.facing ?? undefined,
        layer: placed.layer,
        instanceId: '',
      },
      index,
    ),
    facing: placed.facing ?? undefined,
    layer: placed.layer,
    triggerTargetInstanceId: null,
    containedObjectId: placed.containedObjectId ?? null,
  }));
  snapshot.version = payload.version;
  snapshot.status = 'published';
  snapshot.createdAt = payload.publishedAt ?? '';
  snapshot.updatedAt = payload.publishedAt ?? '';
  snapshot.publishedAt = payload.publishedAt;

  return snapshot;
}

export async function buildRoomTokenMetadata(
  snapshot: RoomSnapshot,
  imageDataUrl: string,
  options: RoomTokenMetadataBuildOptions
): Promise<BuiltRoomTokenMetadata> {
  const payload = buildWampMintedRoomPayload(snapshot);
  const storedPayload = serializeMintedRoomPayload(payload);
  const metadata: StoredWampRoomTokenMetadata = {
    name: snapshot.title?.trim() || `Room ${snapshot.coordinates.x},${snapshot.coordinates.y}`,
    description: buildRoomTokenDescription(snapshot),
    image: imageDataUrl,
    animation_url: buildMintedRoomAnimationUrl(options),
    attributes: buildRoomTokenAttributes(snapshot),
    wamp_room: storedPayload,
  };
  const metadataJson = JSON.stringify(metadata);
  const tokenUri = `${ROOM_TOKEN_METADATA_MIME}${encodeUtf8ToBase64(metadataJson)}`;

  return {
    payload,
    storedPayload,
    metadata,
    metadataJson,
    tokenUri,
    metadataHash: await sha256Hex(tokenUri),
  };
}

export function parseRoomTokenMetadataUri(tokenUri: string): WampRoomTokenMetadata {
  if (!tokenUri.startsWith(ROOM_TOKEN_METADATA_MIME)) {
    throw new Error('Unsupported tokenURI format.');
  }

  const encoded = tokenUri.slice(ROOM_TOKEN_METADATA_MIME.length);
  const json = decodeBase64ToUtf8(encoded);
  const parsed = JSON.parse(json) as Partial<StoredWampRoomTokenMetadata>;

  if (!parsed || typeof parsed !== 'object' || !parsed.wamp_room) {
    throw new Error('tokenURI metadata does not include a wamp_room payload.');
  }

  return {
    name: typeof parsed.name === 'string' ? parsed.name : 'WAMP Room',
    description: typeof parsed.description === 'string' ? parsed.description : '',
    image: typeof parsed.image === 'string' ? parsed.image : '',
    animation_url: typeof parsed.animation_url === 'string' ? parsed.animation_url : '',
    attributes: Array.isArray(parsed.attributes)
      ? parsed.attributes.filter(isRoomTokenAttribute)
      : [],
    wamp_room: normalizeMintedRoomPayload(parsed.wamp_room),
  };
}

export function extractWampRoomPayloadFromTokenUri(tokenUri: string): WampMintedRoomPayload {
  return parseRoomTokenMetadataUri(tokenUri).wamp_room;
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return bytesToHex(new Uint8Array(digest));
}

function serializeMintedRoomPayload(payload: WampMintedRoomPayload): StoredWampMintedRoomPayload {
  const dictionary: string[] = [];
  const objectIdToIndex = new Map<string, number>();
  const serializedObjects: Array<[number, number, number, number, number?]> = [];

  for (const placed of payload.placedObjects) {
    let dictionaryIndex = objectIdToIndex.get(placed.id);
    if (dictionaryIndex === undefined) {
      dictionaryIndex = dictionary.length;
      dictionary.push(placed.id);
      objectIdToIndex.set(placed.id, dictionaryIndex);
    }

    let containedDictionaryIndex: number | undefined;
    if (typeof placed.containedObjectId === 'string' && placed.containedObjectId.trim()) {
      containedDictionaryIndex = objectIdToIndex.get(placed.containedObjectId);
      if (containedDictionaryIndex === undefined) {
        containedDictionaryIndex = dictionary.length;
        dictionary.push(placed.containedObjectId);
        objectIdToIndex.set(placed.containedObjectId, containedDictionaryIndex);
      }
    }

    serializedObjects.push([
      dictionaryIndex,
      Math.round(placed.x),
      Math.round(placed.y),
      packObjectFlags(placed),
      containedDictionaryIndex,
    ]);
  }

  const tiles = serializeMintedRoomTilesV2(payload.tiles);
  return {
    v: WAMP_MINTED_ROOM_SCHEMA_VERSION_V2,
    c: [...payload.coordinates],
    ...(payload.title ? { n: payload.title } : {}),
    b: payload.background,
    ...(payload.goal ? { g: serializeRoomGoalV2(payload.goal) } : {}),
    ...(payload.spawnPoint ? { s: [...payload.spawnPoint] as [number, number] } : {}),
    ...(tiles ? { t: tiles } : {}),
    ...(dictionary.length > 0 ? { k: dictionary } : {}),
    ...(serializedObjects.length > 0 ? { o: serializedObjects } : {}),
    pv: payload.version,
    ...(payload.publishedAt ? { pt: payload.publishedAt } : {}),
  };
}

function serializeMintedRoomTilesV2(
  tiles: Record<LayerName, string>
): Partial<Record<WampV2LayerKey, string>> | undefined {
  const serialized: Partial<Record<WampV2LayerKey, string>> = {};

  for (const layerName of LAYER_NAMES) {
    const encoded = tiles[layerName];
    if (!encoded) {
      continue;
    }
    serialized[layerNameToV2Key(layerName)] = encoded;
  }

  return Object.keys(serialized).length > 0 ? serialized : undefined;
}

function serializeRoomGoalV2(goal: RoomGoal): WampMintedRoomGoalV2 {
  switch (goal.type) {
    case 'reach_exit':
      return {
        t: 'e',
        ...(goal.exit ? { e: [goal.exit.x, goal.exit.y] } : {}),
        ...(goal.timeLimitMs ? { l: goal.timeLimitMs } : {}),
      };
    case 'collect_target':
      return {
        t: 'c',
        r: goal.requiredCount,
        ...(goal.timeLimitMs ? { l: goal.timeLimitMs } : {}),
      };
    case 'defeat_all':
      return {
        t: 'd',
        ...(goal.timeLimitMs ? { l: goal.timeLimitMs } : {}),
      };
    case 'checkpoint_sprint':
      return {
        t: 'k',
        ...(goal.checkpoints.length > 0
          ? {
              c: goal.checkpoints.map((point) => [point.x, point.y] as [number, number]),
            }
          : {}),
        ...(goal.finish ? { f: [goal.finish.x, goal.finish.y] } : {}),
        ...(goal.timeLimitMs ? { l: goal.timeLimitMs } : {}),
      };
    case 'survival':
      return {
        t: 's',
        d: goal.durationMs,
      };
  }
}

function decodeMintedTileData(
  version: WampMintedRoomPayloadVersion,
  tiles: Record<LayerName, string>
): RoomTileData {
  return {
    background: decodeTileLayer(version, tiles.background),
    terrain: decodeTileLayer(version, tiles.terrain),
    foreground: decodeTileLayer(version, tiles.foreground),
  };
}

function normalizeMintedRoomPayload(value: unknown): WampMintedRoomPayload {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid wamp_room payload.');
  }

  const payload = value as Partial<StoredWampMintedRoomPayload>;
  if (payload.v === WAMP_MINTED_ROOM_SCHEMA_VERSION_V2) {
    return normalizeMintedRoomPayloadV2(payload as Partial<WampMintedRoomPayloadV2>);
  }

  return normalizeMintedRoomPayloadV1(payload);
}

function normalizeMintedRoomPayloadV1(value: Partial<WampMintedRoomPayload>): WampMintedRoomPayload {
  const coordinates = Array.isArray(value.coordinates) ? value.coordinates : [];
  const spawnPoint = Array.isArray(value.spawnPoint) ? value.spawnPoint : null;
  const tiles = value.tiles as Record<string, unknown> | undefined;

  if (
    value.v !== WAMP_MINTED_ROOM_SCHEMA_VERSION_V1 ||
    typeof value.roomId !== 'string' ||
    coordinates.length !== 2 ||
    typeof coordinates[0] !== 'number' ||
    typeof coordinates[1] !== 'number' ||
    typeof value.background !== 'string' ||
    typeof value.version !== 'number' ||
    !tiles
  ) {
    throw new Error('Invalid wamp_room payload.');
  }

  return {
    v: WAMP_MINTED_ROOM_SCHEMA_VERSION_V1,
    roomId: value.roomId,
    coordinates: [coordinates[0], coordinates[1]],
    title: normalizeRoomTitle(value.title),
    background: value.background,
    goal: normalizeRoomGoal(value.goal),
    spawnPoint:
      spawnPoint &&
      spawnPoint.length === 2 &&
      typeof spawnPoint[0] === 'number' &&
      typeof spawnPoint[1] === 'number'
        ? [spawnPoint[0], spawnPoint[1]]
        : null,
    tiles: {
      background: typeof tiles.background === 'string' ? tiles.background : encodeTileLayerV1([]),
      terrain: typeof tiles.terrain === 'string' ? tiles.terrain : encodeTileLayerV1([]),
      foreground: typeof tiles.foreground === 'string' ? tiles.foreground : encodeTileLayerV1([]),
    },
    placedObjects: Array.isArray(value.placedObjects)
      ? value.placedObjects
          .filter(isMintedRoomObject)
          .map((placed) => ({
            id: placed.id,
            x: placed.x,
            y: placed.y,
            facing: placed.facing ?? null,
            layer: placed.layer,
            containedObjectId:
              typeof placed.containedObjectId === 'string' && placed.containedObjectId.trim()
                ? placed.containedObjectId
                : null,
          }))
      : [],
    version: value.version,
    publishedAt: typeof value.publishedAt === 'string' ? value.publishedAt : null,
  };
}

function normalizeMintedRoomPayloadV2(value: Partial<WampMintedRoomPayloadV2>): WampMintedRoomPayload {
  const coordinates = Array.isArray(value.c) ? value.c : [];
  const spawnPoint = Array.isArray(value.s) ? value.s : null;
  const tiles = value.t as Record<string, unknown> | undefined;
  const dictionary = Array.isArray(value.k) ? value.k.filter((entry) => typeof entry === 'string') : [];
  const serializedObjects = Array.isArray(value.o) ? value.o : [];

  if (
    value.v !== WAMP_MINTED_ROOM_SCHEMA_VERSION_V2 ||
    coordinates.length !== 2 ||
    typeof coordinates[0] !== 'number' ||
    typeof coordinates[1] !== 'number' ||
    typeof value.b !== 'string' ||
    typeof value.pv !== 'number'
  ) {
    throw new Error('Invalid wamp_room payload.');
  }

  return {
    v: WAMP_MINTED_ROOM_SCHEMA_VERSION_V2,
    roomId: `${coordinates[0]},${coordinates[1]}`,
    coordinates: [coordinates[0], coordinates[1]],
    title: normalizeRoomTitle(value.n),
    background: value.b,
    goal: normalizeRoomGoalV2(value.g),
    spawnPoint:
      spawnPoint &&
      spawnPoint.length === 2 &&
      typeof spawnPoint[0] === 'number' &&
      typeof spawnPoint[1] === 'number'
        ? [spawnPoint[0], spawnPoint[1]]
        : null,
    tiles: {
      background: typeof tiles?.b === 'string' ? tiles.b : '',
      terrain: typeof tiles?.t === 'string' ? tiles.t : '',
      foreground: typeof tiles?.f === 'string' ? tiles.f : '',
    },
    placedObjects: serializedObjects
      .map((entry) => normalizeMintedRoomObjectV2(entry, dictionary))
      .filter((entry): entry is WampMintedRoomObject => Boolean(entry)),
    version: value.pv,
    publishedAt: typeof value.pt === 'string' ? value.pt : null,
  };
}

function normalizeRoomGoalV2(value: unknown): RoomGoal | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const goal = value as Partial<WampMintedRoomGoalV2>;
  const goalType = goal.t as WampGoalCode | undefined;

  switch (goalType) {
    case 'e': {
      const reachExitGoal = value as Partial<WampMintedReachExitGoalV2>;
      return normalizeRoomGoal({
        type: 'reach_exit',
        exit: normalizePointTuple(reachExitGoal.e),
        timeLimitMs: normalizeNullablePositiveInteger(reachExitGoal.l),
      });
    }
    case 'c': {
      const collectGoal = value as Partial<WampMintedCollectTargetGoalV2>;
      return normalizeRoomGoal({
        type: 'collect_target',
        requiredCount: normalizeNullablePositiveInteger(collectGoal.r) ?? 1,
        timeLimitMs: normalizeNullablePositiveInteger(collectGoal.l),
      });
    }
    case 'd': {
      const defeatAllGoal = value as Partial<WampMintedDefeatAllGoalV2>;
      return normalizeRoomGoal({
        type: 'defeat_all',
        timeLimitMs: normalizeNullablePositiveInteger(defeatAllGoal.l),
      });
    }
    case 'k': {
      const checkpointGoal = value as Partial<WampMintedCheckpointSprintGoalV2>;
      return normalizeRoomGoal({
        type: 'checkpoint_sprint',
        checkpoints: Array.isArray(checkpointGoal.c)
          ? checkpointGoal.c
              .map(normalizePointTuple)
              .filter((point): point is { x: number; y: number } => Boolean(point))
          : [],
        finish: normalizePointTuple(checkpointGoal.f),
        timeLimitMs: normalizeNullablePositiveInteger(checkpointGoal.l),
      });
    }
    case 's': {
      const survivalGoal = value as Partial<WampMintedSurvivalGoalV2>;
      return normalizeRoomGoal({
        type: 'survival',
        durationMs: normalizeNullablePositiveInteger(survivalGoal.d) ?? 30_000,
      });
    }
    default:
      return null;
  }
}

function normalizePointTuple(value: unknown): { x: number; y: number } | null {
  if (!Array.isArray(value) || value.length !== 2) {
    return null;
  }

  return typeof value[0] === 'number' &&
    Number.isFinite(value[0]) &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[1])
    ? { x: value[0], y: value[1] }
    : null;
}

function normalizeNullablePositiveInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  const rounded = Math.round(value);
  return rounded > 0 ? rounded : null;
}

function normalizeMintedRoomObjectV2(
  value: unknown,
  dictionary: string[]
): WampMintedRoomObject | null {
  if (!Array.isArray(value) || (value.length !== 4 && value.length !== 5)) {
    return null;
  }

  const [dictionaryIndex, x, y, packedFlags, containedDictionaryIndex] = value;
  if (
    typeof dictionaryIndex !== 'number' ||
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof packedFlags !== 'number' ||
    (containedDictionaryIndex !== undefined && typeof containedDictionaryIndex !== 'number')
  ) {
    return null;
  }

  const id = dictionary[dictionaryIndex];
  if (!id) {
    return null;
  }

  const { facing, layer } = unpackObjectFlags(packedFlags);
  return {
    id,
    x,
    y,
    facing,
    layer,
    containedObjectId:
      typeof containedDictionaryIndex === 'number' ? dictionary[containedDictionaryIndex] ?? null : null,
  };
}

function buildRoomTokenDescription(snapshot: RoomSnapshot): string {
  const title = snapshot.title?.trim() || `Room ${snapshot.coordinates.x},${snapshot.coordinates.y}`;
  const goalText = snapshot.goal ? ` Goal: ${snapshot.goal.type.replace(/_/g, ' ')}.` : '';
  return `${title} from WAMP.${goalText}`.trim();
}

function buildRoomTokenAttributes(snapshot: RoomSnapshot): WampRoomTokenAttribute[] {
  const attributes: WampRoomTokenAttribute[] = [
    { trait_type: 'Room X', value: snapshot.coordinates.x, display_type: 'number' },
    { trait_type: 'Room Y', value: snapshot.coordinates.y, display_type: 'number' },
    { trait_type: 'Version', value: snapshot.version, display_type: 'number' },
    { trait_type: 'Background', value: snapshot.background },
    { trait_type: 'Goal', value: snapshot.goal?.type ?? 'none' },
    { trait_type: 'Placed Objects', value: snapshot.placedObjects.length, display_type: 'number' },
    { trait_type: 'Solid Tiles', value: countSolidTiles(snapshot), display_type: 'number' },
  ];

  if (snapshot.title) {
    attributes.unshift({
      trait_type: 'Title',
      value: snapshot.title,
    });
  }

  return attributes;
}

function countSolidTiles(snapshot: RoomSnapshot): number {
  let count = 0;

  for (const layerName of LAYER_NAMES) {
    for (const row of snapshot.tileData[layerName]) {
      for (const value of row) {
        if (value > 0) {
          count += 1;
        }
      }
    }
  }

  return count;
}

function buildMintedRoomAnimationUrl(options: RoomTokenMetadataBuildOptions): string {
  const url = new URL('/minted-room.html', options.origin);
  url.searchParams.set('chainId', String(options.chainId));
  url.searchParams.set('contract', options.contractAddress);
  url.searchParams.set('tokenId', options.tokenId);
  return url.toString();
}

function encodeUtf8ToBase64(value: string): string {
  return encodeBytesToBase64(new TextEncoder().encode(value));
}

function decodeBase64ToUtf8(value: string): string {
  return new TextDecoder().decode(decodeBase64ToBytes(value));
}

function encodeBytesToBase64(bytes: Uint8Array): string {
  let binary = '';

  for (let index = 0; index < bytes.length; index += 0x8000) {
    const chunk = bytes.subarray(index, index + 0x8000);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function decodeBase64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function encodeTileLayerV1(rows: (number | -1)[][]): string {
  const values = new Int32Array(ROOM_WIDTH * ROOM_HEIGHT);
  let offset = 0;

  for (let y = 0; y < ROOM_HEIGHT; y += 1) {
    for (let x = 0; x < ROOM_WIDTH; x += 1) {
      values[offset] = rows[y]?.[x] ?? -1;
      offset += 1;
    }
  }

  return encodeBytesToBase64(new Uint8Array(values.buffer));
}

function decodeTileLayerV1(encoded: string): (number | -1)[][] {
  const bytes = decodeBase64ToBytes(encoded);
  if (bytes.byteLength !== ROOM_WIDTH * ROOM_HEIGHT * Int32Array.BYTES_PER_ELEMENT) {
    throw new Error('Encoded tile layer has an unexpected size.');
  }

  const values = new Int32Array(bytes.buffer.slice(0));
  const rows: (number | -1)[][] = [];
  let offset = 0;

  for (let y = 0; y < ROOM_HEIGHT; y += 1) {
    const row: (number | -1)[] = [];
    for (let x = 0; x < ROOM_WIDTH; x += 1) {
      row.push(values[offset] as number | -1);
      offset += 1;
    }
    rows.push(row);
  }

  return rows;
}

function encodeTileLayerV2(rows: (number | -1)[][]): string {
  const encodedValues: number[] = [];

  for (let y = 0; y < ROOM_HEIGHT; y += 1) {
    for (let x = 0; x < ROOM_WIDTH; x += 1) {
      const tileValue = rows[y]?.[x] ?? -1;
      const { gid, flipX, flipY } = decodeTileDataValue(tileValue);
      if (gid <= 0) {
        continue;
      }

      const flatIndex = y * ROOM_WIDTH + x;
      const flags = (flipX ? 1 : 0) | (flipY ? 2 : 0);
      encodedValues.push(flatIndex, gid, flags);
    }
  }

  if (encodedValues.length === 0) {
    return '';
  }

  return encodeBytesToBase64(new Uint8Array(new Uint16Array(encodedValues).buffer));
}

function decodeTileLayerV2(encoded: string): (number | -1)[][] {
  const rows = createEmptyTileRows();
  if (!encoded) {
    return rows;
  }

  const bytes = decodeBase64ToBytes(encoded);
  if (bytes.byteLength % Uint16Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error('Encoded sparse tile layer has an unexpected size.');
  }

  const values = new Uint16Array(bytes.buffer.slice(0));
  if (values.length % 3 !== 0) {
    throw new Error('Encoded sparse tile layer has an unexpected entry count.');
  }

  for (let index = 0; index < values.length; index += 3) {
    const flatIndex = values[index];
    const gid = values[index + 1];
    const flags = values[index + 2];
    if (flatIndex >= ROOM_WIDTH * ROOM_HEIGHT || gid <= 0) {
      continue;
    }

    const x = flatIndex % ROOM_WIDTH;
    const y = Math.floor(flatIndex / ROOM_WIDTH);
    rows[y][x] = encodeTileDataValue(gid, (flags & 1) === 1, (flags & 2) === 2);
  }

  return rows;
}

function decodeTileLayer(
  version: WampMintedRoomPayloadVersion,
  encoded: string
): (number | -1)[][] {
  return version === WAMP_MINTED_ROOM_SCHEMA_VERSION_V1
    ? decodeTileLayerV1(encoded)
    : decodeTileLayerV2(encoded);
}

function createEmptyTileRows(): (number | -1)[][] {
  return Array.from({ length: ROOM_HEIGHT }, () =>
    Array.from({ length: ROOM_WIDTH }, () => -1 as const)
  );
}

function packObjectFlags(placed: Pick<WampMintedRoomObject, 'facing' | 'layer'>): number {
  return layerToCode(placed.layer) * 4 + facingToCode(placed.facing);
}

function unpackObjectFlags(value: number): { facing: 'left' | 'right' | null; layer: LayerName } {
  const layer = codeToLayer(Math.floor(value / 4));
  const facing = codeToFacing(value % 4);
  return { facing, layer };
}

function layerNameToV2Key(layerName: LayerName): WampV2LayerKey {
  switch (layerName) {
    case 'background':
      return 'b';
    case 'terrain':
      return 't';
    case 'foreground':
      return 'f';
  }
}

function facingToCode(facing: 'left' | 'right' | null): number {
  switch (facing) {
    case 'left':
      return 1;
    case 'right':
      return 2;
    default:
      return 0;
  }
}

function codeToFacing(code: number): 'left' | 'right' | null {
  switch (code) {
    case 1:
      return 'left';
    case 2:
      return 'right';
    default:
      return null;
  }
}

function layerToCode(layer: LayerName): number {
  switch (layer) {
    case 'background':
      return 0;
    case 'terrain':
      return 1;
    case 'foreground':
      return 2;
  }
}

function codeToLayer(code: number): LayerName {
  switch (code) {
    case 0:
      return 'background';
    case 2:
      return 'foreground';
    default:
      return 'terrain';
  }
}

function isMintedRoomObject(value: unknown): value is WampMintedRoomObject {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const placed = value as Partial<WampMintedRoomObject>;
  return Boolean(
    typeof placed.id === 'string' &&
      typeof placed.x === 'number' &&
      typeof placed.y === 'number' &&
      (placed.facing === null ||
        placed.facing === undefined ||
        placed.facing === 'left' ||
        placed.facing === 'right') &&
      (placed.layer === 'background' ||
        placed.layer === 'terrain' ||
        placed.layer === 'foreground')
  );
}

function isRoomTokenAttribute(value: unknown): value is WampRoomTokenAttribute {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const attribute = value as Partial<WampRoomTokenAttribute>;
  return Boolean(
    typeof attribute.trait_type === 'string' &&
      (typeof attribute.value === 'string' || typeof attribute.value === 'number')
  );
}
