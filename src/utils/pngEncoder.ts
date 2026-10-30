const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_FILTER_NONE = 0;
const PNG_FILTER_UP = 2;
const CRC32_TABLE = createCrc32Table();

/**
 * Encodes 8-bit RGBA pixels as a compressed PNG, for the share preview cards drawn by the API
 * Worker and the Pages renderer. Every row after the first uses the Up filter, which turns the
 * flat colours of room art into runs of zeros (on real rooms it came out smaller overall than None,
 * Sub, Paeth or a per-row choice), and the image data is zlib deflate from CompressionStream, which
 * Workers, Pages and browsers all have. A 1200x630 card is about 5-70 KB instead of 3 MB, with the
 * same pixels (F332).
 */
export async function encodePng(width: number, height: number, rgba: Uint8Array): Promise<Uint8Array> {
  const imageData = await deflateZlib(filterScanlines(width, height, rgba));
  return concatUint8Arrays([
    PNG_SIGNATURE,
    createPngChunk('IHDR', createIhdrData(width, height)),
    createPngChunk('IDAT', imageData),
    createPngChunk('IEND', new Uint8Array(0)),
  ]);
}

function filterScanlines(width: number, height: number, rgba: Uint8Array): Uint8Array<ArrayBuffer> {
  const bytesPerRow = width * 4;
  const scanlines = new Uint8Array((bytesPerRow + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const sourceOffset = row * bytesPerRow;
    const targetOffset = row * (bytesPerRow + 1) + 1;
    if (row === 0) {
      scanlines[targetOffset - 1] = PNG_FILTER_NONE;
      scanlines.set(rgba.subarray(0, bytesPerRow), targetOffset);
      continue;
    }

    scanlines[targetOffset - 1] = PNG_FILTER_UP;
    const aboveOffset = sourceOffset - bytesPerRow;
    for (let index = 0; index < bytesPerRow; index += 1) {
      scanlines[targetOffset + index] = (rgba[sourceOffset + index] - rgba[aboveOffset + index]) & 0xff;
    }
  }
  return scanlines;
}

async function deflateZlib(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  // 'deflate' is the zlib format PNG needs, Adler-32 trailer included.
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
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
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return crc >>> 0;
}

function createCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let value = 0; value < 256; value += 1) {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
    table[value] = crc >>> 0;
  }
  return table;
}
