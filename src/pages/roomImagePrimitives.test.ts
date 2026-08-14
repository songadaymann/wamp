import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  blendRect,
  blitImageNearest,
  blitImageSmooth,
  createCanvas,
  darken,
  decodePng,
  drawBorder,
  drawDiamond,
  drawHorizonSteps,
  drawTriangle,
  encodePng,
  fillEllipse,
  fillRect,
  hexToNumber,
  isJpeg,
  isPng,
  lighten,
  type RoomImageData,
} from './roomImagePrimitives';

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

interface PngFixtureOptions {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  scanlines: Uint8Array;
  palette?: Uint8Array;
  paletteAlpha?: Uint8Array;
  compression?: number;
  filter?: number;
  interlace?: number;
}

function writeUint32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function concatenate(parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function createChunkWithIgnoredCrc(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  writeUint32(chunk, 0, data.length);
  for (let index = 0; index < type.length; index += 1) {
    chunk[4 + index] = type.charCodeAt(index);
  }
  chunk.set(data, 8);
  // The legacy decoder intentionally skips CRC validation. A zero CRC makes that contract explicit.
  return chunk;
}

function createPngFixture(options: PngFixtureOptions): Uint8Array {
  const header = new Uint8Array(13);
  writeUint32(header, 0, options.width);
  writeUint32(header, 4, options.height);
  header[8] = options.bitDepth;
  header[9] = options.colorType;
  header[10] = options.compression ?? 0;
  header[11] = options.filter ?? 0;
  header[12] = options.interlace ?? 0;

  const chunks = [createChunkWithIgnoredCrc('IHDR', header)];
  if (options.palette) {
    chunks.push(createChunkWithIgnoredCrc('PLTE', options.palette));
  }
  if (options.paletteAlpha) {
    chunks.push(createChunkWithIgnoredCrc('tRNS', options.paletteAlpha));
  }
  chunks.push(createChunkWithIgnoredCrc('IDAT', new Uint8Array(deflateSync(options.scanlines))));
  chunks.push(createChunkWithIgnoredCrc('IEND', new Uint8Array(0)));
  return concatenate([PNG_SIGNATURE, ...chunks]);
}

function image(width: number, height: number, pixels: number[]): RoomImageData {
  return { width, height, pixels: new Uint8Array(pixels) };
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('room image canvas primitives', () => {
  it('keeps zeroed RGBA allocation plus rounded and clipped rectangle bounds', () => {
    const canvas = createCanvas(3, 2);

    expect(canvas).toEqual({
      width: 3,
      height: 2,
      pixels: new Uint8Array(24),
    });

    fillRect(canvas, -0.6, 0.49, 2.2, 1.2, 0x123456);
    expect(Array.from(canvas.pixels)).toEqual([
      18, 52, 86, 255,
      18, 52, 86, 255,
      0, 0, 0, 0,
      18, 52, 86, 255,
      18, 52, 86, 255,
      0, 0, 0, 0,
    ]);
  });

  it('clamps blend alpha and forces touched pixels opaque', () => {
    const canvas = createCanvas(3, 1);
    fillRect(canvas, 0, 0, 2, 1, 0x123456);

    blendRect(canvas, 1, 0, 2, 1, 0xffffff, 0.5);
    expect(Array.from(canvas.pixels)).toEqual([
      18, 52, 86, 255,
      137, 154, 171, 255,
      128, 128, 128, 255,
    ]);

    blendRect(canvas, 0, 0, 1, 1, 0xff0000, -1);
    blendRect(canvas, 2, 0, 1, 1, 0x010203, 2);
    expect(Array.from(canvas.pixels)).toEqual([
      18, 52, 86, 255,
      137, 154, 171, 255,
      1, 2, 3, 255,
    ]);
  });

  it('keeps the legacy border, diamond, triangle, ellipse, and seeded-horizon raster', () => {
    const canvas = createCanvas(240, 120);
    fillRect(canvas, 0, 0, canvas.width, canvas.height, 0x102030);
    drawBorder(canvas, 4, 5, 32, 24, 0xa0b0c0);
    drawDiamond(canvas, 55, 30, 9, 0xfedcba);
    drawTriangle(canvas, 80, 7, 68, 38, 98, 36, 0xabcdef);
    fillEllipse(canvas, 125, 30, 17, 11, 0x123456);
    drawHorizonSteps(canvas, 0x2468ac, 0x13579b, 'fixture-room');

    expect(sha256(canvas.pixels)).toBe(
      '54fa43ea4b72986fd50dbd576992c85bc4de73a810445c1fadf1feafd82e9cbe',
    );
  });

  it('keeps the renderer color conversion quirks', () => {
    expect(hexToNumber('#abcdef')).toBe(0xabcdef);
    expect(hexToNumber(' 123456 ')).toBe(0x123456);
    expect(hexToNumber('not-a-color')).toBe(0);
    expect(lighten(0x102030, 0.5)).toBe(0x889098);
    expect(darken(0x102030, 0.25)).toBe(0x0c1824);
  });
});

describe('room image blits', () => {
  it('keeps nearest-neighbor flips, transparent skips, and source-over blending', () => {
    const source = image(2, 2, [
      255, 0, 0, 255,
      0, 200, 0, 128,
      0, 0, 255, 0,
      255, 255, 255, 255,
    ]);
    const canvas = createCanvas(2, 2);

    blitImageNearest(canvas, source, 0, 0, 2, 2, 0, 0, 2, 2, true, false);

    expect(Array.from(canvas.pixels)).toEqual([
      0, 100, 0, 255,
      255, 0, 0, 255,
      255, 255, 255, 255,
      0, 0, 0, 0,
    ]);

    const before = canvas.pixels.slice();
    blitImageNearest(canvas, source, 0, 0, 2, 2, 0, 0, 0, 2);
    expect(canvas.pixels).toEqual(before);
  });

  it('keeps bilinear sampling centered on target pixels', () => {
    const source = image(2, 2, [
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 255,
      255, 255, 255, 255,
    ]);
    const canvas = createCanvas(1, 1);

    blitImageSmooth(canvas, source, 0, 0, 2, 2, 0, 0, 1, 1);

    expect(Array.from(canvas.pixels)).toEqual([128, 128, 128, 255]);
  });
});

describe('room image PNG codec', () => {
  it('emits the exact legacy uncompressed PNG byte stream', async () => {
    const rgba = new Uint8Array([
      1, 2, 3, 4,
      5, 6, 7, 8,
      9, 10, 11, 12,
      13, 14, 15, 16,
    ]);

    const encoded = encodePng(2, 2, rgba);

    expect(Buffer.from(encoded).toString('base64')).toBe(
      'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAHUlEQVR4AQESAO3/AAECAwQFBgcIAAkKCwwNDg8QA2YAieJz/CgAAAAASUVORK5CYII=',
    );
    await expect(decodePng(encoded)).resolves.toEqual({
      width: 2,
      height: 2,
      pixels: rgba,
    });
  });

  it('keeps exact multi-block PNG framing above the 65,535-byte zlib boundary', async () => {
    const width = 128;
    const height = 128;
    const rgba = new Uint8Array(width * height * 4);
    for (let index = 0; index < rgba.length; index += 1) {
      rgba[index] = (index * 17 + 31) & 0xff;
    }

    const encoded = encodePng(width, height, rgba);

    expect(encoded.length).toBe(65_737);
    expect(sha256(encoded)).toBe(
      '67d3577af1f02ec445ef99ac3794740511afb92836384708e23e337d9ea2754b',
    );
    await expect(decodePng(encoded)).resolves.toEqual({ width, height, pixels: rgba });
  });

  it.each([
    {
      label: '8-bit grayscale',
      options: {
        width: 2,
        height: 1,
        bitDepth: 8,
        colorType: 0,
        scanlines: new Uint8Array([0, 10, 200]),
      },
      expected: [10, 10, 10, 255, 200, 200, 200, 255],
    },
    {
      label: '8-bit truecolor',
      options: {
        width: 2,
        height: 1,
        bitDepth: 8,
        colorType: 2,
        scanlines: new Uint8Array([0, 1, 2, 3, 4, 5, 6]),
      },
      expected: [1, 2, 3, 255, 4, 5, 6, 255],
    },
    {
      label: '8-bit grayscale with alpha',
      options: {
        width: 2,
        height: 1,
        bitDepth: 8,
        colorType: 4,
        scanlines: new Uint8Array([0, 10, 20, 200, 40]),
      },
      expected: [10, 10, 10, 20, 200, 200, 200, 40],
    },
    {
      label: '8-bit RGBA',
      options: {
        width: 2,
        height: 1,
        bitDepth: 8,
        colorType: 6,
        scanlines: new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8]),
      },
      expected: [1, 2, 3, 4, 5, 6, 7, 8],
    },
  ])('decodes $label while accepting the legacy ignored CRC field', async ({ options, expected }) => {
    const decoded = await decodePng(createPngFixture(options));

    expect(Array.from(decoded.pixels)).toEqual(expected);
  });

  it.each([
    { bitDepth: 1, row: [0b0100_0000], indexes: [0, 1] },
    { bitDepth: 2, row: [0b0001_1011], indexes: [0, 1, 2, 3] },
    { bitDepth: 4, row: [0x1f], indexes: [1, 15] },
    { bitDepth: 8, row: [1, 15], indexes: [1, 15] },
  ])('decodes $bitDepth-bit indexed PNG samples and missing palette alpha as opaque', async ({
    bitDepth,
    row,
    indexes,
  }) => {
    const palette = new Uint8Array(16 * 3);
    for (let index = 0; index < 16; index += 1) {
      palette[index * 3] = index;
      palette[index * 3 + 1] = index + 20;
      palette[index * 3 + 2] = index + 40;
    }
    const paletteAlpha = new Uint8Array([7, 8, 9]);
    const decoded = await decodePng(createPngFixture({
      width: indexes.length,
      height: 1,
      bitDepth,
      colorType: 3,
      scanlines: new Uint8Array([0, ...row]),
      palette,
      paletteAlpha,
    }));

    expect(Array.from(decoded.pixels)).toEqual(indexes.flatMap((index) => [
      index,
      index + 20,
      index + 40,
      paletteAlpha[index] ?? 255,
    ]));
  });

  it.each([
    { filterType: 0, scanlines: [0, 10, 20, 0, 30, 50] },
    { filterType: 1, scanlines: [1, 10, 10, 1, 30, 20] },
    { filterType: 2, scanlines: [2, 10, 20, 2, 20, 30] },
    { filterType: 3, scanlines: [3, 10, 15, 3, 25, 25] },
    { filterType: 4, scanlines: [4, 10, 10, 4, 20, 20] },
  ])('unfilters PNG scanlines using filter $filterType', async ({ scanlines }) => {
    const decoded = await decodePng(createPngFixture({
      width: 2,
      height: 2,
      bitDepth: 8,
      colorType: 0,
      scanlines: new Uint8Array(scanlines),
    }));

    expect(Array.from(decoded.pixels)).toEqual([
      10, 10, 10, 255,
      20, 20, 20, 255,
      30, 30, 30, 255,
      50, 50, 50, 255,
    ]);
  });

  it('retains signature sniffing behavior for PNG and JPEG byte arrays', () => {
    expect(isPng(PNG_SIGNATURE)).toBe(true);
    expect(isPng(new Uint8Array([137, 80, 78, 71]))).toBe(false);
    expect(isJpeg(new Uint8Array([0xff, 0xd8, 0x12, 0x34, 0xff, 0xd9]))).toBe(true);
    expect(isJpeg(new Uint8Array([0xff, 0xd8, 0x12, 0x34, 0x00, 0x00]))).toBe(false);
  });

  it('retains the legacy decoder rejection boundaries', async () => {
    await expect(decodePng(new Uint8Array([1, 2, 3]))).rejects.toThrow('Invalid PNG signature.');
    await expect(decodePng(PNG_SIGNATURE)).rejects.toThrow('PNG is missing IHDR.');

    const truncatedChunk = concatenate([
      PNG_SIGNATURE,
      new Uint8Array([0, 0, 0, 100, 73, 72, 68, 82]),
    ]);
    await expect(decodePng(truncatedChunk)).rejects.toThrow('Invalid PNG chunk length.');

    await expect(decodePng(createPngFixture({
      width: 1,
      height: 1,
      bitDepth: 8,
      colorType: 6,
      scanlines: new Uint8Array([0, 0, 0, 0, 0]),
      interlace: 1,
    }))).rejects.toThrow('Unsupported PNG encoding.');

    await expect(decodePng(createPngFixture({
      width: 1,
      height: 1,
      bitDepth: 4,
      colorType: 2,
      scanlines: new Uint8Array([0, 0, 0]),
    }))).rejects.toThrow('Unsupported PNG bit depth.');

    await expect(decodePng(createPngFixture({
      width: 1,
      height: 1,
      bitDepth: 8,
      colorType: 5,
      scanlines: new Uint8Array([0, 0]),
    }))).rejects.toThrow('Unsupported PNG color type 5.');

    await expect(decodePng(createPngFixture({
      width: 1,
      height: 1,
      bitDepth: 8,
      colorType: 0,
      scanlines: new Uint8Array([5, 0]),
    }))).rejects.toThrow('Unsupported PNG filter 5.');
  });
});
