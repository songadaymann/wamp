import type { RoomSnapshot } from '../persistence/roomModel';
import { renderRoomSnapshotToCanvas } from '../mint/roomMetadataRender';
import {
  WAMP_O_GRAM_LABEL,
  type WampOGramPostcardFields,
} from './model';

export interface WampOGramPostcardRenderOptions {
  width?: number;
  height?: number;
}

const DEFAULT_WIDTH = 1200;
const DEFAULT_HEIGHT = 630;

export async function renderWampOGramPostcardToCanvas(
  snapshot: RoomSnapshot,
  postcard: WampOGramPostcardFields,
  options: WampOGramPostcardRenderOptions = {},
): Promise<HTMLCanvasElement> {
  const width = options.width ?? DEFAULT_WIDTH;
  const height = options.height ?? DEFAULT_HEIGHT;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas 2D context was not available.');
  }

  context.imageSmoothingEnabled = false;
  drawPostcardPaper(context, width, height);

  const roomCanvas = await renderRoomSnapshotToCanvas(snapshot, {
    tilePixelSize: 16,
  });
  const preview = getPreviewPlacement(width, height);
  drawPreviewFrame(context, preview);
  context.drawImage(roomCanvas, preview.x, preview.y, preview.width, preview.height);
  drawPreviewBorder(context, preview);

  drawPostcardCopy(context, postcard, snapshot, preview.x + preview.width + 48, 76, width - preview.x - preview.width - 96);
  return canvas;
}

export async function renderWampOGramPostcardToPngDataUrl(
  snapshot: RoomSnapshot,
  postcard: WampOGramPostcardFields,
  options: WampOGramPostcardRenderOptions = {},
): Promise<string> {
  const canvas = await renderWampOGramPostcardToCanvas(snapshot, postcard, options);
  return canvas.toDataURL('image/png');
}

function drawPostcardPaper(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  context.fillStyle = '#fff7e6';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#18223a';
  context.fillRect(0, 0, width, 22);
  context.fillStyle = '#f05b45';
  context.fillRect(0, height - 24, width, 24);
  context.fillStyle = '#79ccde';
  context.fillRect(0, 22, 18, height - 46);
  context.fillStyle = '#fcea7c';
  context.fillRect(width - 18, 22, 18, height - 46);
}

function getPreviewPlacement(width: number, height: number): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const previewWidth = Math.round(width * 0.64);
  const previewHeight = Math.round(previewWidth * (352 / 640));
  return {
    x: 64,
    y: Math.round((height - previewHeight) / 2),
    width: previewWidth,
    height: previewHeight,
  };
}

function drawPreviewFrame(
  context: CanvasRenderingContext2D,
  preview: { x: number; y: number; width: number; height: number },
): void {
  context.fillStyle = 'rgba(24, 22, 28, 0.22)';
  context.fillRect(preview.x + 12, preview.y + 12, preview.width, preview.height);
  context.fillStyle = '#18161c';
  context.fillRect(preview.x - 8, preview.y - 8, preview.width + 16, preview.height + 16);
  context.fillStyle = '#fffaf0';
  context.fillRect(preview.x - 4, preview.y - 4, preview.width + 8, preview.height + 8);
}

function drawPreviewBorder(
  context: CanvasRenderingContext2D,
  preview: { x: number; y: number; width: number; height: number },
): void {
  context.strokeStyle = '#18161c';
  context.lineWidth = 4;
  context.strokeRect(preview.x - 2, preview.y - 2, preview.width + 4, preview.height + 4);
}

function drawPostcardCopy(
  context: CanvasRenderingContext2D,
  postcard: WampOGramPostcardFields,
  snapshot: RoomSnapshot,
  x: number,
  y: number,
  maxWidth: number,
): void {
  const title = postcard.title || snapshot.title || WAMP_O_GRAM_LABEL;
  const toLine = postcard.recipientName ? `To ${postcard.recipientName}` : 'To you';
  const fromLine = postcard.senderName ? `From ${postcard.senderName}` : null;
  const message = postcard.message || 'A playable level made for you.';

  context.fillStyle = '#2c5071';
  context.font = '700 26px Courier New, monospace';
  fillFittedText(context, WAMP_O_GRAM_LABEL.toUpperCase(), x, y, maxWidth);

  context.fillStyle = '#18161c';
  context.font = '700 46px Courier New, monospace';
  drawWrappedText(context, title, x, y + 68, maxWidth, 52, 2);

  context.fillStyle = '#277b30';
  context.font = '700 28px Courier New, monospace';
  fillFittedText(context, toLine, x, y + 206, maxWidth);

  context.fillStyle = '#18161c';
  context.font = '22px Courier New, monospace';
  drawWrappedText(context, message, x, y + 252, maxWidth, 32, 4);

  if (fromLine) {
    context.fillStyle = '#ed5f4b';
    context.font = '700 24px Courier New, monospace';
    fillFittedText(context, fromLine, x, y + 430, maxWidth);
  }
}

function drawWrappedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
): void {
  const words = text.split(/\s+/).filter(Boolean);
  let line = '';
  let lineCount = 0;

  for (const word of words) {
    const nextLine = line ? `${line} ${word}` : word;
    if (context.measureText(nextLine).width <= maxWidth || !line) {
      line = nextLine;
      continue;
    }

    fillFittedText(context, line, x, y + lineCount * lineHeight, maxWidth);
    line = word;
    lineCount += 1;
    if (lineCount >= maxLines) {
      return;
    }
  }

  if (line && lineCount < maxLines) {
    fillFittedText(context, line, x, y + lineCount * lineHeight, maxWidth);
  }
}

function fillFittedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
): void {
  if (context.measureText(text).width <= maxWidth) {
    context.fillText(text, x, y);
    return;
  }

  const originalFont = context.font;
  const match = /^(\D*)(\d+(?:\.\d+)?)px(.*)$/.exec(originalFont);
  if (!match) {
    context.fillText(text, x, y, maxWidth);
    return;
  }

  const [, prefix, sizeText, suffix] = match;
  const originalSize = Number(sizeText);
  let nextSize = originalSize;
  while (nextSize > Math.max(14, originalSize * 0.62)) {
    nextSize -= 1;
    context.font = `${prefix}${nextSize}px${suffix}`;
    if (context.measureText(text).width <= maxWidth) {
      context.fillText(text, x, y);
      context.font = originalFont;
      return;
    }
  }

  context.fillText(text, x, y, maxWidth);
  context.font = originalFont;
}
