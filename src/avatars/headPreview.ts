import {
  MAX_CRYPTOPUNK_ID,
  MIN_CRYPTOPUNK_ID,
} from './model';

const CRYPTOPUNK_HEAD_PREVIEW_ATLAS_PATH = '/assets/cryptopunks/head-preview-atlas.png';
const CRYPTOPUNK_HEAD_PREVIEW_COLUMNS = 100;
const CRYPTOPUNK_HEAD_PREVIEW_CELL_SIZE = 24;

let atlasImagePromise: Promise<HTMLImageElement> | null = null;
const previewUrlCache = new Map<number, string>();

export async function loadCryptopunkHeadPreviewUrl(punkId: number): Promise<string> {
  if (!Number.isInteger(punkId) || punkId < MIN_CRYPTOPUNK_ID || punkId > MAX_CRYPTOPUNK_ID) {
    throw new Error(`CryptoPunk id must be between ${MIN_CRYPTOPUNK_ID} and ${MAX_CRYPTOPUNK_ID}.`);
  }

  const cached = previewUrlCache.get(punkId);
  if (cached) {
    return cached;
  }

  const atlasImage = await loadAtlasImage();
  const canvas = document.createElement('canvas');
  canvas.width = CRYPTOPUNK_HEAD_PREVIEW_CELL_SIZE;
  canvas.height = CRYPTOPUNK_HEAD_PREVIEW_CELL_SIZE;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Failed to create CryptoPunk preview canvas.');
  }

  context.imageSmoothingEnabled = false;
  const sourceX = (punkId % CRYPTOPUNK_HEAD_PREVIEW_COLUMNS) * CRYPTOPUNK_HEAD_PREVIEW_CELL_SIZE;
  const sourceY =
    Math.floor(punkId / CRYPTOPUNK_HEAD_PREVIEW_COLUMNS) * CRYPTOPUNK_HEAD_PREVIEW_CELL_SIZE;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    atlasImage,
    sourceX,
    sourceY,
    CRYPTOPUNK_HEAD_PREVIEW_CELL_SIZE,
    CRYPTOPUNK_HEAD_PREVIEW_CELL_SIZE,
    0,
    0,
    CRYPTOPUNK_HEAD_PREVIEW_CELL_SIZE,
    CRYPTOPUNK_HEAD_PREVIEW_CELL_SIZE,
  );

  const previewUrl = canvas.toDataURL('image/png');
  previewUrlCache.set(punkId, previewUrl);
  return previewUrl;
}

function loadAtlasImage(): Promise<HTMLImageElement> {
  if (atlasImagePromise) {
    return atlasImagePromise;
  }

  atlasImagePromise = new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load CryptoPunk head preview atlas.'));
    image.src = CRYPTOPUNK_HEAD_PREVIEW_ATLAS_PATH;
  });

  return atlasImagePromise;
}
