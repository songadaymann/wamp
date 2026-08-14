export interface RoomImageData {
  width: number;
  height: number;
  pixels: Uint8Array;
}

interface PngHeader {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  compression: number;
  filter: number;
  interlace: number;
}

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

type RgbaColor = [number, number, number, number];

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

export function createCanvas(width: number, height: number): RoomImageData {
  return {
    width,
    height,
    pixels: new Uint8Array(width * height * 4),
  };
}

export function drawHorizonSteps(
  canvas: RoomImageData,
  farColor: number,
  nearColor: number,
  seedText: string,
): void {
  let seed = hashString(seedText);
  for (let index = 0; index < 22; index += 1) {
    seed = nextSeed(seed);
    const stepWidth = 80 + (seed % 90);
    seed = nextSeed(seed);
    const stepHeight = 40 + (seed % 120);
    const x = (index * 67 + (seed % 40)) % canvas.width;
    const y = Math.floor(canvas.height * 0.5) - Math.floor(stepHeight * 0.35);
    blendRect(canvas, x, y, stepWidth, stepHeight, index % 2 === 0 ? farColor : nearColor, 0.32);
  }
}

export function fillRect(
  canvas: RoomImageData,
  x: number,
  y: number,
  width: number,
  height: number,
  color: number,
): void {
  const rgb = numberToRgb(color);
  const left = clampInt(x, 0, canvas.width);
  const top = clampInt(y, 0, canvas.height);
  const right = clampInt(x + width, 0, canvas.width);
  const bottom = clampInt(y + height, 0, canvas.height);

  for (let row = top; row < bottom; row += 1) {
    let offset = (row * canvas.width + left) * 4;
    for (let col = left; col < right; col += 1) {
      canvas.pixels[offset] = rgb.r;
      canvas.pixels[offset + 1] = rgb.g;
      canvas.pixels[offset + 2] = rgb.b;
      canvas.pixels[offset + 3] = 255;
      offset += 4;
    }
  }
}

export function blendRect(
  canvas: RoomImageData,
  x: number,
  y: number,
  width: number,
  height: number,
  color: number,
  alpha: number,
): void {
  const rgb = numberToRgb(color);
  const left = clampInt(x, 0, canvas.width);
  const top = clampInt(y, 0, canvas.height);
  const right = clampInt(x + width, 0, canvas.width);
  const bottom = clampInt(y + height, 0, canvas.height);
  const clampedAlpha = Math.max(0, Math.min(1, alpha));
  const inverseAlpha = 1 - clampedAlpha;

  for (let row = top; row < bottom; row += 1) {
    let offset = (row * canvas.width + left) * 4;
    for (let col = left; col < right; col += 1) {
      canvas.pixels[offset] = Math.round(canvas.pixels[offset] * inverseAlpha + rgb.r * clampedAlpha);
      canvas.pixels[offset + 1] = Math.round(canvas.pixels[offset + 1] * inverseAlpha + rgb.g * clampedAlpha);
      canvas.pixels[offset + 2] = Math.round(canvas.pixels[offset + 2] * inverseAlpha + rgb.b * clampedAlpha);
      canvas.pixels[offset + 3] = 255;
      offset += 4;
    }
  }
}

export function drawBorder(
  canvas: RoomImageData,
  x: number,
  y: number,
  width: number,
  height: number,
  color: number,
): void {
  fillRect(canvas, x, y, width, 3, color);
  fillRect(canvas, x, y + height - 3, width, 3, color);
  fillRect(canvas, x, y, 3, height, color);
  fillRect(canvas, x + width - 3, y, 3, height, color);
}

export function drawDiamond(
  canvas: RoomImageData,
  centerX: number,
  centerY: number,
  radius: number,
  color: number,
): void {
  for (let dy = -radius; dy <= radius; dy += 1) {
    const halfWidth = radius - Math.abs(dy);
    fillRect(canvas, centerX - halfWidth, centerY + dy, halfWidth * 2 + 1, 1, color);
  }
}

export function drawTriangle(
  canvas: RoomImageData,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  color: number,
): void {
  const minY = Math.floor(Math.min(ay, by, cy));
  const maxY = Math.ceil(Math.max(ay, by, cy));

  for (let y = minY; y <= maxY; y += 1) {
    const intersections: number[] = [];
    collectEdgeIntersection(intersections, y, ax, ay, bx, by);
    collectEdgeIntersection(intersections, y, bx, by, cx, cy);
    collectEdgeIntersection(intersections, y, cx, cy, ax, ay);
    intersections.sort((left, right) => left - right);
    for (let index = 0; index + 1 < intersections.length; index += 2) {
      fillRect(
        canvas,
        Math.floor(intersections[index]),
        y,
        Math.ceil(intersections[index + 1] - intersections[index]) + 1,
        1,
        color,
      );
    }
  }
}

function collectEdgeIntersection(
  intersections: number[],
  scanY: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): void {
  if ((scanY < ay && scanY < by) || (scanY > ay && scanY > by) || ay === by) {
    return;
  }

  const t = (scanY - ay) / (by - ay);
  if (t < 0 || t > 1) {
    return;
  }

  intersections.push(ax + (bx - ax) * t);
}

export function fillEllipse(
  canvas: RoomImageData,
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
  color: number,
): void {
  const safeRadiusX = Math.max(1, radiusX);
  const safeRadiusY = Math.max(1, radiusY);
  for (let dy = -safeRadiusY; dy <= safeRadiusY; dy += 1) {
    const normalizedY = dy / safeRadiusY;
    const halfWidth = Math.floor(safeRadiusX * Math.sqrt(Math.max(0, 1 - normalizedY * normalizedY)));
    fillRect(canvas, centerX - halfWidth, centerY + dy, halfWidth * 2 + 1, 1, color);
  }
}

export function blitImageNearest(
  canvas: RoomImageData,
  image: RoomImageData,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  flipX = false,
  flipY = false,
): void {
  if (dw <= 0 || dh <= 0 || sw <= 0 || sh <= 0) {
    return;
  }

  const left = Math.max(0, Math.floor(dx));
  const top = Math.max(0, Math.floor(dy));
  const right = Math.min(canvas.width, Math.ceil(dx + dw));
  const bottom = Math.min(canvas.height, Math.ceil(dy + dh));

  for (let targetY = top; targetY < bottom; targetY += 1) {
    const relativeY = Math.min(sh - 1, Math.max(0, Math.floor(((targetY + 0.5 - dy) / dh) * sh)));
    const sourceY = Math.max(0, Math.min(image.height - 1, Math.floor(sy + (flipY ? sh - 1 - relativeY : relativeY))));
    for (let targetX = left; targetX < right; targetX += 1) {
      const relativeX = Math.min(sw - 1, Math.max(0, Math.floor(((targetX + 0.5 - dx) / dw) * sw)));
      const sourceX = Math.max(0, Math.min(image.width - 1, Math.floor(sx + (flipX ? sw - 1 - relativeX : relativeX))));
      const sourceOffset = (sourceY * image.width + sourceX) * 4;
      const alpha = image.pixels[sourceOffset + 3];
      if (alpha <= 0) {
        continue;
      }

      const targetOffset = (targetY * canvas.width + targetX) * 4;
      if (alpha >= 255) {
        canvas.pixels[targetOffset] = image.pixels[sourceOffset];
        canvas.pixels[targetOffset + 1] = image.pixels[sourceOffset + 1];
        canvas.pixels[targetOffset + 2] = image.pixels[sourceOffset + 2];
        canvas.pixels[targetOffset + 3] = 255;
        continue;
      }

      const sourceAlpha = alpha / 255;
      const inverseAlpha = 1 - sourceAlpha;
      canvas.pixels[targetOffset] = Math.round(image.pixels[sourceOffset] * sourceAlpha + canvas.pixels[targetOffset] * inverseAlpha);
      canvas.pixels[targetOffset + 1] = Math.round(image.pixels[sourceOffset + 1] * sourceAlpha + canvas.pixels[targetOffset + 1] * inverseAlpha);
      canvas.pixels[targetOffset + 2] = Math.round(image.pixels[sourceOffset + 2] * sourceAlpha + canvas.pixels[targetOffset + 2] * inverseAlpha);
      canvas.pixels[targetOffset + 3] = 255;
    }
  }
}

export function blitImageSmooth(
  canvas: RoomImageData,
  image: RoomImageData,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): void {
  if (dw <= 0 || dh <= 0 || sw <= 0 || sh <= 0) {
    return;
  }

  const left = Math.max(0, Math.floor(dx));
  const top = Math.max(0, Math.floor(dy));
  const right = Math.min(canvas.width, Math.ceil(dx + dw));
  const bottom = Math.min(canvas.height, Math.ceil(dy + dh));

  for (let targetY = top; targetY < bottom; targetY += 1) {
    const sourceY = sy + ((targetY + 0.5 - dy) / dh) * sh - 0.5;
    for (let targetX = left; targetX < right; targetX += 1) {
      const sourceX = sx + ((targetX + 0.5 - dx) / dw) * sw - 0.5;
      const rgba = sampleImageBilinear(image, sourceX, sourceY);
      blendPixel(canvas, targetX, targetY, rgba[0], rgba[1], rgba[2], rgba[3]);
    }
  }
}

function sampleImageBilinear(image: RoomImageData, x: number, y: number): RgbaColor {
  const x0 = Math.max(0, Math.min(image.width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(image.height - 1, Math.floor(y)));
  const x1 = Math.max(0, Math.min(image.width - 1, x0 + 1));
  const y1 = Math.max(0, Math.min(image.height - 1, y0 + 1));
  const tx = Math.max(0, Math.min(1, x - x0));
  const ty = Math.max(0, Math.min(1, y - y0));
  const top = interpolateRgba(
    readImagePixel(image, x0, y0),
    readImagePixel(image, x1, y0),
    tx,
  );
  const bottom = interpolateRgba(
    readImagePixel(image, x0, y1),
    readImagePixel(image, x1, y1),
    tx,
  );
  return interpolateRgba(top, bottom, ty);
}

function readImagePixel(image: RoomImageData, x: number, y: number): RgbaColor {
  const offset = (y * image.width + x) * 4;
  return [
    image.pixels[offset],
    image.pixels[offset + 1],
    image.pixels[offset + 2],
    image.pixels[offset + 3],
  ];
}

function interpolateRgba(left: RgbaColor, right: RgbaColor, t: number): RgbaColor {
  const inverse = 1 - t;
  return [
    Math.round(left[0] * inverse + right[0] * t),
    Math.round(left[1] * inverse + right[1] * t),
    Math.round(left[2] * inverse + right[2] * t),
    Math.round(left[3] * inverse + right[3] * t),
  ];
}

function blendPixel(
  canvas: RoomImageData,
  x: number,
  y: number,
  red: number,
  green: number,
  blue: number,
  alpha: number,
): void {
  if (alpha <= 0) {
    return;
  }

  const offset = (y * canvas.width + x) * 4;
  if (alpha >= 255) {
    canvas.pixels[offset] = red;
    canvas.pixels[offset + 1] = green;
    canvas.pixels[offset + 2] = blue;
    canvas.pixels[offset + 3] = 255;
    return;
  }

  const sourceAlpha = alpha / 255;
  const inverseAlpha = 1 - sourceAlpha;
  canvas.pixels[offset] = Math.round(red * sourceAlpha + canvas.pixels[offset] * inverseAlpha);
  canvas.pixels[offset + 1] = Math.round(green * sourceAlpha + canvas.pixels[offset + 1] * inverseAlpha);
  canvas.pixels[offset + 2] = Math.round(blue * sourceAlpha + canvas.pixels[offset + 2] * inverseAlpha);
  canvas.pixels[offset + 3] = 255;
}

export async function decodePng(bytes: Uint8Array): Promise<RoomImageData> {
  assertPngSignature(bytes);

  let offset = 8;
  let header: PngHeader | null = null;
  let palette: Uint8Array | null = null;
  let paletteAlpha: Uint8Array | null = null;
  const idatChunks: Uint8Array[] = [];

  while (offset + 8 <= bytes.length) {
    const length = readUint32(bytes, offset);
    const type = readAscii(bytes, offset + 4, 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) {
      throw new Error('Invalid PNG chunk length.');
    }

    const data = bytes.subarray(dataStart, dataEnd);
    if (type === 'IHDR') {
      header = {
        width: readUint32(data, 0),
        height: readUint32(data, 4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12],
      };
    } else if (type === 'PLTE') {
      palette = data.slice();
    } else if (type === 'tRNS') {
      paletteAlpha = data.slice();
    } else if (type === 'IDAT') {
      idatChunks.push(data.slice());
    } else if (type === 'IEND') {
      break;
    }

    offset = dataEnd + 4;
  }

  if (!header) {
    throw new Error('PNG is missing IHDR.');
  }
  if (header.compression !== 0 || header.filter !== 0 || header.interlace !== 0) {
    throw new Error('Unsupported PNG encoding.');
  }
  if (header.bitDepth !== 8 && !(header.colorType === 3 && [1, 2, 4, 8].includes(header.bitDepth))) {
    throw new Error('Unsupported PNG bit depth.');
  }

  const inflated = await inflateZlib(concatUint8Arrays(idatChunks));
  const bitsPerPixel = getPngBitsPerPixel(header.colorType, header.bitDepth);
  const scanlineLength = Math.ceil((header.width * bitsPerPixel) / 8);
  const filterByteWidth = Math.max(1, Math.ceil(bitsPerPixel / 8));
  const pixels = new Uint8Array(header.width * header.height * 4);
  let readOffset = 0;
  let previousRow: Uint8Array = new Uint8Array(scanlineLength);

  for (let y = 0; y < header.height; y += 1) {
    const filterType = inflated[readOffset];
    readOffset += 1;
    const filteredRow = inflated.subarray(readOffset, readOffset + scanlineLength);
    readOffset += scanlineLength;
    const row = unfilterPngScanline(filteredRow, previousRow, filterType, filterByteWidth);
    writePngRowToRgba(pixels, y, row, header, palette, paletteAlpha);
    previousRow = row;
  }

  return {
    width: header.width,
    height: header.height,
    pixels,
  };
}

function assertPngSignature(bytes: Uint8Array): void {
  if (isPng(bytes)) {
    return;
  }

  throw new Error('Invalid PNG signature.');
}

export function isPng(bytes: Uint8Array): boolean {
  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (bytes[index] !== PNG_SIGNATURE[index]) {
      return false;
    }
  }
  return true;
}

export function isJpeg(bytes: Uint8Array): boolean {
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
}

async function inflateZlib(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('DecompressionStream is not available.');
  }

  const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function getPngBitsPerPixel(colorType: number, bitDepth: number): number {
  if (colorType === 0 || colorType === 3) {
    return bitDepth;
  }
  if (colorType === 2) {
    return bitDepth * 3;
  }
  if (colorType === 4) {
    return bitDepth * 2;
  }
  if (colorType === 6) {
    return bitDepth * 4;
  }
  throw new Error(`Unsupported PNG color type ${colorType}.`);
}

function unfilterPngScanline(
  filteredRow: Uint8Array,
  previousRow: Uint8Array,
  filterType: number,
  bytesPerPixel: number,
): Uint8Array {
  const row = new Uint8Array(filteredRow.length);
  for (let index = 0; index < filteredRow.length; index += 1) {
    const left = index >= bytesPerPixel ? row[index - bytesPerPixel] : 0;
    const up = previousRow[index] ?? 0;
    const upLeft = index >= bytesPerPixel ? previousRow[index - bytesPerPixel] ?? 0 : 0;
    const value = filteredRow[index];

    if (filterType === 0) {
      row[index] = value;
    } else if (filterType === 1) {
      row[index] = (value + left) & 0xff;
    } else if (filterType === 2) {
      row[index] = (value + up) & 0xff;
    } else if (filterType === 3) {
      row[index] = (value + Math.floor((left + up) / 2)) & 0xff;
    } else if (filterType === 4) {
      row[index] = (value + paethPredictor(left, up, upLeft)) & 0xff;
    } else {
      throw new Error(`Unsupported PNG filter ${filterType}.`);
    }
  }
  return row;
}

function writePngRowToRgba(
  target: Uint8Array,
  y: number,
  row: Uint8Array,
  header: PngHeader,
  palette: Uint8Array | null,
  paletteAlpha: Uint8Array | null,
): void {
  for (let x = 0; x < header.width; x += 1) {
    const targetOffset = (y * header.width + x) * 4;

    if (header.colorType === 6) {
      const sourceOffset = x * 4;
      target[targetOffset] = row[sourceOffset];
      target[targetOffset + 1] = row[sourceOffset + 1];
      target[targetOffset + 2] = row[sourceOffset + 2];
      target[targetOffset + 3] = row[sourceOffset + 3];
    } else if (header.colorType === 2) {
      const sourceOffset = x * 3;
      target[targetOffset] = row[sourceOffset];
      target[targetOffset + 1] = row[sourceOffset + 1];
      target[targetOffset + 2] = row[sourceOffset + 2];
      target[targetOffset + 3] = 255;
    } else if (header.colorType === 3) {
      const paletteIndex = getPackedPngSample(row, x, header.bitDepth);
      const paletteOffset = paletteIndex * 3;
      target[targetOffset] = palette?.[paletteOffset] ?? 0;
      target[targetOffset + 1] = palette?.[paletteOffset + 1] ?? 0;
      target[targetOffset + 2] = palette?.[paletteOffset + 2] ?? 0;
      target[targetOffset + 3] = paletteAlpha?.[paletteIndex] ?? 255;
    } else if (header.colorType === 0) {
      const value = header.bitDepth === 8
        ? row[x]
        : scalePngSample(getPackedPngSample(row, x, header.bitDepth), header.bitDepth);
      target[targetOffset] = value;
      target[targetOffset + 1] = value;
      target[targetOffset + 2] = value;
      target[targetOffset + 3] = 255;
    } else if (header.colorType === 4) {
      const sourceOffset = x * 2;
      const value = row[sourceOffset];
      target[targetOffset] = value;
      target[targetOffset + 1] = value;
      target[targetOffset + 2] = value;
      target[targetOffset + 3] = row[sourceOffset + 1];
    } else {
      throw new Error(`Unsupported PNG color type ${header.colorType}.`);
    }
  }
}

function getPackedPngSample(row: Uint8Array, pixelIndex: number, bitDepth: number): number {
  if (bitDepth === 8) {
    return row[pixelIndex];
  }

  const bitIndex = pixelIndex * bitDepth;
  const byte = row[Math.floor(bitIndex / 8)] ?? 0;
  const shift = 8 - bitDepth - (bitIndex % 8);
  return (byte >> shift) & ((1 << bitDepth) - 1);
}

function scalePngSample(value: number, bitDepth: number): number {
  return Math.round((value / ((1 << bitDepth) - 1)) * 255);
}

function paethPredictor(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) {
    return left;
  }
  return upDistance <= upLeftDistance ? up : upLeft;
}

function numberToRgb(color: number): RgbColor {
  return {
    r: (color >> 16) & 0xff,
    g: (color >> 8) & 0xff,
    b: color & 0xff,
  };
}

function rgbToNumber(color: RgbColor): number {
  return ((color.r & 0xff) << 16) | ((color.g & 0xff) << 8) | (color.b & 0xff);
}

export function hexToNumber(value: string): number {
  const normalized = value.replace(/^#/, '').trim();
  return Number.parseInt(normalized || '000000', 16) & 0xffffff;
}

export function lighten(color: number, amount: number): number {
  const rgb = numberToRgb(color);
  return rgbToNumber({
    r: Math.round(rgb.r + (255 - rgb.r) * amount),
    g: Math.round(rgb.g + (255 - rgb.g) * amount),
    b: Math.round(rgb.b + (255 - rgb.b) * amount),
  });
}

export function darken(color: number, amount: number): number {
  const rgb = numberToRgb(color);
  return rgbToNumber({
    r: Math.round(rgb.r * (1 - amount)),
    g: Math.round(rgb.g * (1 - amount)),
    b: Math.round(rgb.b * (1 - amount)),
  });
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function nextSeed(seed: number): number {
  return (Math.imul(seed, 1664525) + 1013904223) >>> 0;
}

export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const bytesPerRow = width * 4;
  const scanlines = new Uint8Array((bytesPerRow + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const targetOffset = row * (bytesPerRow + 1);
    scanlines[targetOffset] = 0;
    scanlines.set(rgba.subarray(row * bytesPerRow, row * bytesPerRow + bytesPerRow), targetOffset + 1);
  }

  return concatUint8Arrays([
    PNG_SIGNATURE,
    createPngChunk('IHDR', createIhdrData(width, height)),
    createPngChunk('IDAT', createZlibUncompressedBlockStream(scanlines)),
    createPngChunk('IEND', new Uint8Array(0)),
  ]);
}

function createIhdrData(width: number, height: number): Uint8Array {
  const data = new Uint8Array(13);
  writeUint32(data, 0, width);
  writeUint32(data, 4, height);
  data[8] = 8;
  data[9] = 6;
  return data;
}

function createPngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = asciiBytes(type);
  const chunk = new Uint8Array(12 + data.length);
  writeUint32(chunk, 0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  writeUint32(chunk, 8 + data.length, crc32(typeBytes, data));
  return chunk;
}

function createZlibUncompressedBlockStream(data: Uint8Array): Uint8Array {
  const blockCount = Math.max(1, Math.ceil(data.length / 65535));
  const output = new Uint8Array(2 + data.length + blockCount * 5 + 4);
  let offset = 0;
  output[offset++] = 0x78;
  output[offset++] = 0x01;

  for (let blockIndex = 0; blockIndex < blockCount; blockIndex += 1) {
    const blockStart = blockIndex * 65535;
    const blockLength = Math.min(65535, data.length - blockStart);
    const isFinal = blockIndex === blockCount - 1;
    output[offset++] = isFinal ? 0x01 : 0x00;
    output[offset++] = blockLength & 0xff;
    output[offset++] = (blockLength >> 8) & 0xff;
    const nlen = (~blockLength) & 0xffff;
    output[offset++] = nlen & 0xff;
    output[offset++] = (nlen >> 8) & 0xff;
    output.set(data.subarray(blockStart, blockStart + blockLength), offset);
    offset += blockLength;
  }

  writeUint32(output, offset, adler32(data));
  return output;
}

function asciiBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index) & 0xff;
  }
  return bytes;
}

function concatUint8Arrays(parts: Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function readUint32(source: Uint8Array, offset: number): number {
  return (
    ((source[offset] ?? 0) * 0x1000000) +
    ((source[offset + 1] ?? 0) << 16) +
    ((source[offset + 2] ?? 0) << 8) +
    (source[offset + 3] ?? 0)
  ) >>> 0;
}

function readAscii(source: Uint8Array, offset: number, length: number): string {
  let value = '';
  for (let index = 0; index < length; index += 1) {
    value += String.fromCharCode(source[offset + index] ?? 0);
  }
  return value;
}

function writeUint32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function crc32(typeBytes: Uint8Array, data: Uint8Array): number {
  let crc = 0xffffffff;
  crc = updateCrc32(crc, typeBytes);
  crc = updateCrc32(crc, data);
  return (crc ^ 0xffffffff) >>> 0;
}

function updateCrc32(initial: number, data: Uint8Array): number {
  let crc = initial;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return crc >>> 0;
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of data) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}
