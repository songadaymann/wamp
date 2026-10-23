import { crc32, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodePng } from '../pages/roomImagePrimitives';
import { encodePng } from './pngEncoder';

interface PngChunk {
  type: string;
  data: Uint8Array;
}

/** Splits a PNG into chunks, checking each CRC with Node's zlib rather than the encoder's own table. */
function readChunks(png: Uint8Array): PngChunk[] {
  const view = Buffer.from(png.buffer, png.byteOffset, png.byteLength);
  expect(Array.from(view.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunks: PngChunk[] = [];
  for (let offset = 8; offset < view.length;) {
    const length = view.readUInt32BE(offset);
    const typeAndData = view.subarray(offset + 4, offset + 8 + length);
    expect(view.readUInt32BE(offset + 8 + length)).toBe(crc32(typeAndData));
    chunks.push({ type: typeAndData.subarray(0, 4).toString('ascii'), data: typeAndData.subarray(4) });
    offset += 12 + length;
  }
  return chunks;
}

/** Decodes with Node's inflate (which checks the Adler-32 trailer) and a by-hand None/Up unfilter. */
function decodeIndependently(png: Uint8Array): { width: number; height: number; pixels: Uint8Array; filters: number[] } {
  const chunks = readChunks(png);
  expect(chunks.map((chunk) => chunk.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
  const header = Buffer.from(chunks[0].data);
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  expect(Array.from(header.subarray(8))).toEqual([8, 6, 0, 0, 0]);
  const scanlines = inflateSync(chunks[1].data);
  const stride = width * 4;
  expect(scanlines.length).toBe((stride + 1) * height);
  const pixels = new Uint8Array(stride * height);
  const filters: number[] = [];
  for (let row = 0; row < height; row += 1) {
    const filter = scanlines[row * (stride + 1)];
    filters.push(filter);
    for (let index = 0; index < stride; index += 1) {
      const above = filter === 2 && row > 0 ? pixels[(row - 1) * stride + index] : 0;
      pixels[row * stride + index] = (scanlines[row * (stride + 1) + 1 + index] + above) & 0xff;
    }
  }
  return { width, height, pixels, filters };
}

function noise(width: number, height: number): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  let seed = 7;
  for (let index = 0; index < pixels.length; index += 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    pixels[index] = seed >>> 24;
  }
  return pixels;
}

describe('compressed PNG encoder (F332)', () => {
  it.each([
    { label: '2x2', width: 2, height: 2, pixels: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]) },
    { label: 'noise that wraps every Up difference', width: 128, height: 128, pixels: noise(128, 128) },
    { label: 'a single row', width: 300, height: 1, pixels: noise(300, 1) },
  ])('round-trips $label exactly through the room image decoder and Node zlib', async ({ width, height, pixels }) => {
    const png = await encodePng(width, height, pixels);

    await expect(decodePng(png)).resolves.toEqual({ width, height, pixels });
    const independent = decodeIndependently(png);
    expect(independent).toMatchObject({ width, height, pixels });
    expect(independent.filters).toEqual([0, ...Array.from({ length: height - 1 }, () => 2)]);
  });

  it('writes a flat 1200x630 card in a few KB instead of 3 MB', async () => {
    const pixels = new Uint8Array(new Uint32Array(1200 * 630).fill(0xffe3cc8b).buffer);
    pixels.fill(0x60, pixels.length / 2, pixels.length * 3 / 4);

    const png = await encodePng(1200, 630, pixels);

    expect(png.length).toBeLessThan(10_000);
    // Typed-array toEqual walks 3 MB element by element; compare the bytes directly.
    expect(Buffer.from(decodeIndependently(png).pixels).equals(Buffer.from(pixels))).toBe(true);
  });
});
