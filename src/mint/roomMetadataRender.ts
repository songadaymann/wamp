import {
  BACKGROUND_GROUPS,
  GAME_OBJECTS,
  ROOM_HEIGHT,
  ROOM_WIDTH,
  TILESETS,
  TILE_SIZE,
  decodeTileDataValue,
  getBackgroundGroup,
  getObjectById,
  getObjectDefaultFrame,
  getObjectFrameSourceRect,
  getPlacedObjectLayer,
  getTilesetByGid,
  type LayerName,
} from '../config';
import type { RoomSnapshot } from '../persistence/roomModel';
import { buildRoomSnapshotFromMintedPayload, type WampMintedRoomPayload } from './roomMetadata';
import { RETRO_COLORS, drawStarfieldToContext, hashStringToSeed } from '../visuals/starfield';

export interface MintedRoomRenderOptions {
  tilePixelSize?: number;
  includeObjects?: boolean;
  includeBackground?: boolean;
  includedLayers?: LayerName[];
}

const imageCache = new Map<string, Promise<HTMLImageElement>>();

export async function renderWampMintedRoomToCanvas(
  payload: WampMintedRoomPayload,
  options: MintedRoomRenderOptions = {}
): Promise<HTMLCanvasElement> {
  return renderRoomSnapshotToCanvas(
    buildRoomSnapshotFromMintedPayload(payload),
    options
  );
}

export async function renderRoomSnapshotToCanvas(
  snapshot: RoomSnapshot,
  options: MintedRoomRenderOptions = {}
): Promise<HTMLCanvasElement> {
  const tilePixelSize = options.tilePixelSize ?? 2;
  const canvas = document.createElement('canvas');
  canvas.width = ROOM_WIDTH * tilePixelSize;
  canvas.height = ROOM_HEIGHT * tilePixelSize;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas 2D context was not available.');
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = false;

  await drawRoomSnapshotToContext(context, snapshot, options);
  return canvas;
}

export async function renderWampMintedRoomToPngDataUrl(
  payload: WampMintedRoomPayload,
  options: MintedRoomRenderOptions = {}
): Promise<string> {
  const canvas = await renderWampMintedRoomToCanvas(payload, options);
  return canvas.toDataURL('image/png');
}

export async function renderRoomSnapshotToPngDataUrl(
  snapshot: RoomSnapshot,
  options: MintedRoomRenderOptions = {}
): Promise<string> {
  const canvas = await renderRoomSnapshotToCanvas(snapshot, options);
  return canvas.toDataURL('image/png');
}

export async function drawRoomSnapshotToContext(
  context: CanvasRenderingContext2D,
  snapshot: RoomSnapshot,
  options: MintedRoomRenderOptions = {}
): Promise<void> {
  const tilePixelSize = options.tilePixelSize ?? 2;
  const width = ROOM_WIDTH * tilePixelSize;
  const height = ROOM_HEIGHT * tilePixelSize;
  const layers = options.includedLayers ?? ['background', 'terrain', 'foreground'];

  if (options.includeBackground !== false) {
    await drawRoomBackground(context, snapshot, width, height);
  } else {
    context.clearRect(0, 0, width, height);
  }

  await drawRoomTiles(
    context,
    snapshot,
    tilePixelSize,
    layers,
    options.includeObjects !== false
  );
}

async function drawRoomBackground(
  context: CanvasRenderingContext2D,
  snapshot: Pick<RoomSnapshot, 'id' | 'coordinates' | 'background'>,
  width: number,
  height: number
): Promise<void> {
  const backgroundGroup = getBackgroundGroup(snapshot.background);
  if (!backgroundGroup || backgroundGroup.layers.length === 0) {
    drawStarfieldToContext(
      context,
      width,
      height,
      hashStringToSeed(`${snapshot.id}:${snapshot.coordinates.x},${snapshot.coordinates.y}`)
    );
    return;
  }

  context.fillStyle = backgroundGroup.bgColor ?? RETRO_COLORS.background;
  context.fillRect(0, 0, width, height);

  for (const layer of backgroundGroup.layers) {
    const image = await loadAssetImage(layer.path);
    const scale = height / layer.height;
    const drawWidth = Math.max(1, Math.ceil(layer.width * scale));
    for (let drawX = 0; drawX < width + drawWidth; drawX += drawWidth) {
      context.drawImage(image, drawX, 0, drawWidth, height);
    }
  }
}

async function drawRoomTiles(
  context: CanvasRenderingContext2D,
  snapshot: RoomSnapshot,
  tilePixelSize: number,
  includedLayers: readonly LayerName[],
  includeObjects: boolean
): Promise<void> {
  for (const layerName of includedLayers) {
    for (let y = 0; y < ROOM_HEIGHT; y += 1) {
      for (let x = 0; x < ROOM_WIDTH; x += 1) {
        const tileValue = snapshot.tileData[layerName][y][x];
        const { gid, flipX, flipY } = decodeTileDataValue(tileValue);
        if (gid <= 0) {
          continue;
        }

        const tileset = getTilesetByGid(gid);
        if (!tileset) {
          continue;
        }

        const localIndex = gid - tileset.firstGid;
        const image = await loadAssetImage(tileset.path);
        const sourceCol = localIndex % tileset.columns;
        const sourceRow = Math.floor(localIndex / tileset.columns);
        drawTileFrame(
          context,
          image,
          sourceCol * TILE_SIZE,
          sourceRow * TILE_SIZE,
          x * tilePixelSize,
          y * tilePixelSize,
          tilePixelSize,
          tilePixelSize,
          flipX,
          flipY
        );
      }
    }

    if (includeObjects) {
      await drawObjectsForLayer(context, snapshot, tilePixelSize, layerName);
    }
  }
}

function drawTileFrame(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  sx: number,
  sy: number,
  dx: number,
  dy: number,
  width: number,
  height: number,
  flipX: boolean,
  flipY: boolean
): void {
  context.save();
  context.translate(dx + (flipX ? width : 0), dy + (flipY ? height : 0));
  context.scale(flipX ? -1 : 1, flipY ? -1 : 1);
  context.drawImage(image, sx, sy, TILE_SIZE, TILE_SIZE, 0, 0, width, height);
  context.restore();
}

async function drawObjectsForLayer(
  context: CanvasRenderingContext2D,
  snapshot: RoomSnapshot,
  tilePixelSize: number,
  layerName: LayerName
): Promise<void> {
  const scale = tilePixelSize / TILE_SIZE;

  for (const placedObject of snapshot.placedObjects) {
    if (getPlacedObjectLayer(placedObject) !== layerName) {
      continue;
    }

    const objectConfig = getObjectById(placedObject.id);
    if (!objectConfig) {
      continue;
    }

    const image = await loadAssetImage(objectConfig.path);
    const frame = getObjectDefaultFrame(objectConfig);
    const { sx, sy, sw, sh } = getObjectFrameSourceRect(
      objectConfig,
      frame,
      image.width || objectConfig.frameWidth
    );
    const destX = Math.round((placedObject.x - objectConfig.frameWidth / 2) * scale);
    const destY = Math.round((placedObject.y - objectConfig.frameHeight / 2) * scale);
    const destWidth = Math.max(1, Math.round(sw * scale));
    const destHeight = Math.max(1, Math.round(sh * scale));
    const shouldFlipX =
      Boolean(objectConfig.facingDirection) &&
      Boolean(placedObject.facing) &&
      objectConfig.facingDirection !== placedObject.facing;

    context.save();
    context.translate(destX + (shouldFlipX ? destWidth : 0), destY);
    context.scale(shouldFlipX ? -1 : 1, 1);
    context.drawImage(image, sx, sy, sw, sh, 0, 0, destWidth, destHeight);
    context.restore();
  }
}

function loadAssetImage(assetPath: string): Promise<HTMLImageElement> {
  const normalizedPath = assetPath.startsWith('/') ? assetPath : `/${assetPath}`;
  let pending = imageCache.get(normalizedPath);
  if (pending) {
    return pending;
  }

  pending = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load asset ${normalizedPath}.`));
    image.src = normalizedPath;
  });
  imageCache.set(normalizedPath, pending);
  return pending;
}

export function warmRoomMetadataRenderAssetCache(): Promise<void> {
  const paths = new Set<string>();

  for (const tileset of TILESETS) {
    paths.add(tileset.path);
  }
  for (const backgroundGroup of BACKGROUND_GROUPS) {
    for (const layer of backgroundGroup.layers) {
      paths.add(layer.path);
    }
  }
  for (const objectConfig of GAME_OBJECTS) {
    paths.add(objectConfig.path);
  }

  return Promise.all([...paths].map((path) => loadAssetImage(path))).then(() => undefined);
}
