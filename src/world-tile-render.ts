import { renderRoomSnapshotToCanvas } from './mint/roomMetadataRender';
import type { RoomSnapshot } from './persistence/roomModel';

export const WORLD_TILE_CORE_WIDTH = 640;
export const WORLD_TILE_CORE_HEIGHT = 352;
export const WORLD_TILE_OVERLAP = 1;
export const WORLD_TILE_IMAGE_WIDTH = WORLD_TILE_CORE_WIDTH + WORLD_TILE_OVERLAP * 2;
export const WORLD_TILE_IMAGE_HEIGHT = WORLD_TILE_CORE_HEIGHT + WORLD_TILE_OVERLAP * 2;
export const WORLD_TILE_RENDER_CONTRACT = 'wamp-world-tile-render-v1';

export interface WorldTileBrowserRenderResult {
  contract: string;
  coreHeight: number;
  coreWidth: number;
  height: number;
  overlap: number;
  pngDataUrl: string;
  width: number;
}

export interface WorldTileParentRenderInput {
  northEast: string | null;
  northWest: string | null;
  southEast: string | null;
  southWest: string | null;
}

export interface WorldTileBrowserRenderer {
  contract: string;
  renderLeaf(snapshot: RoomSnapshot): Promise<WorldTileBrowserRenderResult>;
  renderParent(input: WorldTileParentRenderInput): Promise<WorldTileBrowserRenderResult>;
}

declare global {
  interface Window {
    __WORLD_TILE_RENDERER__?: WorldTileBrowserRenderer;
    __WORLD_TILE_RENDERER_ERROR__?: string;
    __WORLD_TILE_RENDERER_READY__?: boolean;
  }
}

const status = document.getElementById('world-tile-render-status');

window.__WORLD_TILE_RENDERER_READY__ = false;
window.__WORLD_TILE_RENDERER_ERROR__ = '';
window.__WORLD_TILE_RENDERER__ = {
  contract: WORLD_TILE_RENDER_CONTRACT,
  renderLeaf,
  renderParent,
};
window.__WORLD_TILE_RENDERER_READY__ = true;
if (status) {
  status.textContent = 'ready';
}

async function renderLeaf(snapshot: RoomSnapshot): Promise<WorldTileBrowserRenderResult> {
  const source = await renderRoomSnapshotToCanvas(snapshot, {
    includeBackground: true,
    includeObjects: true,
    strictAssets: true,
    tilePixelSize: 16,
  });
  if (source.width !== WORLD_TILE_CORE_WIDTH || source.height !== WORLD_TILE_CORE_HEIGHT) {
    throw new Error(
      `Leaf renderer produced ${source.width}x${source.height}; expected ${WORLD_TILE_CORE_WIDTH}x${WORLD_TILE_CORE_HEIGHT}.`
    );
  }

  return buildResult(extrudeCanvas(source));
}

async function renderParent(input: WorldTileParentRenderInput): Promise<WorldTileBrowserRenderResult> {
  if (!input.northWest && !input.northEast && !input.southWest && !input.southEast) {
    throw new Error('Empty parent tiles must be published as ready-empty markers, not PNG objects.');
  }
  const children = await Promise.all([
    loadChildImage(input.northWest),
    loadChildImage(input.northEast),
    loadChildImage(input.southWest),
    loadChildImage(input.southEast),
  ]);
  const canvas = document.createElement('canvas');
  canvas.width = WORLD_TILE_CORE_WIDTH;
  canvas.height = WORLD_TILE_CORE_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas 2D context was not available for parent composition.');
  }
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = false;

  const halfWidth = WORLD_TILE_CORE_WIDTH / 2;
  const halfHeight = WORLD_TILE_CORE_HEIGHT / 2;
  const destinations = [
    { x: 0, y: 0 },
    { x: halfWidth, y: 0 },
    { x: 0, y: halfHeight },
    { x: halfWidth, y: halfHeight },
  ];

  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (!child) {
      continue;
    }
    const destination = destinations[index];
    context.drawImage(
      child,
      WORLD_TILE_OVERLAP,
      WORLD_TILE_OVERLAP,
      WORLD_TILE_CORE_WIDTH,
      WORLD_TILE_CORE_HEIGHT,
      destination.x,
      destination.y,
      halfWidth,
      halfHeight
    );
  }

  return buildResult(extrudeCanvas(canvas));
}

function extrudeCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = WORLD_TILE_IMAGE_WIDTH;
  canvas.height = WORLD_TILE_IMAGE_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas 2D context was not available for gutter extrusion.');
  }
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = false;
  context.drawImage(source, WORLD_TILE_OVERLAP, WORLD_TILE_OVERLAP);

  context.drawImage(source, 0, 0, source.width, 1, 1, 0, source.width, 1);
  context.drawImage(source, 0, source.height - 1, source.width, 1, 1, source.height + 1, source.width, 1);
  context.drawImage(source, 0, 0, 1, source.height, 0, 1, 1, source.height);
  context.drawImage(source, source.width - 1, 0, 1, source.height, source.width + 1, 1, 1, source.height);

  context.drawImage(source, 0, 0, 1, 1, 0, 0, 1, 1);
  context.drawImage(source, source.width - 1, 0, 1, 1, source.width + 1, 0, 1, 1);
  context.drawImage(source, 0, source.height - 1, 1, 1, 0, source.height + 1, 1, 1);
  context.drawImage(
    source,
    source.width - 1,
    source.height - 1,
    1,
    1,
    source.width + 1,
    source.height + 1,
    1,
    1
  );
  return canvas;
}

function buildResult(canvas: HTMLCanvasElement): WorldTileBrowserRenderResult {
  return {
    contract: WORLD_TILE_RENDER_CONTRACT,
    coreHeight: WORLD_TILE_CORE_HEIGHT,
    coreWidth: WORLD_TILE_CORE_WIDTH,
    height: canvas.height,
    overlap: WORLD_TILE_OVERLAP,
    pngDataUrl: canvas.toDataURL('image/png'),
    width: canvas.width,
  };
}

async function loadChildImage(dataUrl: string | null): Promise<HTMLImageElement | null> {
  if (!dataUrl) {
    return null;
  }
  if (!dataUrl.startsWith('data:image/png;base64,')) {
    throw new Error('Parent renderer accepts only base64 PNG child images.');
  }

  const image = new Image();
  image.decoding = 'sync';
  image.src = dataUrl;
  await image.decode();
  if (image.naturalWidth !== WORLD_TILE_IMAGE_WIDTH || image.naturalHeight !== WORLD_TILE_IMAGE_HEIGHT) {
    throw new Error(
      `Child tile was ${image.naturalWidth}x${image.naturalHeight}; expected ${WORLD_TILE_IMAGE_WIDTH}x${WORLD_TILE_IMAGE_HEIGHT}.`
    );
  }
  return image;
}
