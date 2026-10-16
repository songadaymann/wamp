// RIFF/ANMF container handling only; browsers decode the individual WebP frames.
export interface WebpFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  duration: number;
  dispose: boolean;
  replace: boolean;
  data: Uint8Array;
}
export interface WebpAnimation {
  width: number;
  height: number;
  loops: number;
  background: string;
  frames: WebpFrame[];
}
export const MAX_BACKGROUND_FRAMES = 300;
export const MAX_BACKGROUND_DECODE_PIXELS = 32_000_000;

const text = (data: Uint8Array, at: number, length: number) =>
  String.fromCharCode(...data.subarray(at, at + length));
export const uint24 = (data: Uint8Array, at: number): number =>
  data[at] + data[at + 1] * 256 + data[at + 2] * 65536;
const uint32 = (data: Uint8Array, at: number) =>
  new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(
    at,
    true,
  );

export function detectBackgroundMime(data: Uint8Array): string | null {
  if (
    data.length >= 24 &&
    text(data, 0, 8) === "\x89PNG\r\n\x1a\n" &&
    text(data, 12, 4) === "IHDR"
  )
    return "image/png";
  if (data.length >= 4 && data[0] === 255 && data[1] === 216 && data[2] === 255)
    return "image/jpeg";
  if (
    data.length >= 20 &&
    text(data, 0, 4) === "RIFF" &&
    text(data, 8, 4) === "WEBP"
  )
    return "image/webp";
  return null;
}

export function backgroundDimensions(bytes: Uint8Array): {
  width: number;
  height: number;
} {
  const mime = detectBackgroundMime(bytes),
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (mime === "image/png") {
    for (let at = 8; at + 12 <= bytes.length;) {
      if (text(bytes, at + 4, 4) === "acTL")
        throw new Error("Use animated WebP to keep animation.");
      at += 12 + view.getUint32(at);
    }
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (mime === "image/jpeg") {
    for (let at = 2; at + 4 <= bytes.length;) {
      if (bytes[at] !== 255) break;
      const marker = bytes[at + 1],
        size = view.getUint16(at + 2);
      if (size < 2 || at + 2 + size > bytes.length) break;
      if ([192, 193, 194].includes(marker) && size >= 7)
        return {
          height: view.getUint16(at + 5),
          width: view.getUint16(at + 7),
        };
      at += size + 2;
    }
  }
  if (mime === "image/webp") {
    for (const { type, data } of webpChunks(bytes)) {
      if (type === "VP8X" && data.length === 10)
        return { width: uint24(data, 4) + 1, height: uint24(data, 7) + 1 };
      if (type === "VP8L" && data.length >= 5 && data[0] === 47)
        return {
          width: 1 + (data[1] | ((data[2] & 63) << 8)),
          height:
            1 + ((data[2] >> 6) | (data[3] << 2) | ((data[4] & 15) << 10)),
        };
      if (
        type === "VP8 " &&
        data.length >= 10 &&
        data[3] === 157 &&
        data[4] === 1 &&
        data[5] === 42
      )
        return {
          width: (data[6] | (data[7] << 8)) & 16383,
          height: (data[8] | (data[9] << 8)) & 16383,
        };
    }
  }
  throw new Error("Could not read image dimensions.");
}

export function webpChunks(
  data: Uint8Array,
): Array<{ type: string; data: Uint8Array }> {
  if (
    detectBackgroundMime(data) !== "image/webp" ||
    uint32(data, 4) + 8 !== data.length
  )
    throw new Error("Invalid WebP container.");
  const result = [];
  for (let offset = 12; offset < data.length;) {
    if (offset + 8 > data.length) throw new Error("Truncated WebP chunk.");
    const length = uint32(data, offset + 4);
    const end = offset + 8 + length;
    if (end + (length % 2) > data.length)
      throw new Error("Truncated WebP chunk.");
    result.push({
      type: text(data, offset, 4),
      data: data.slice(offset + 8, end),
    });
    offset = end + (length % 2);
  }
  return result;
}

export function parseWebpAnimation(data: Uint8Array): WebpAnimation | null {
  if (detectBackgroundMime(data) !== "image/webp") return null;
  const chunks = webpChunks(data);
  const extended = chunks.find((chunk) => chunk.type === "VP8X")?.data;
  if (!extended || !(extended[0] & 2)) return null;
  const control = chunks.find((chunk) => chunk.type === "ANIM")?.data;
  if (extended.length !== 10 || !control || control.length !== 6)
    throw new Error("Invalid WebP animation header.");
  const width = uint24(extended, 4) + 1,
    height = uint24(extended, 7) + 1;
  const frames = chunks
    .filter((chunk) => chunk.type === "ANMF")
    .map(({ data: frame }) => {
      if (frame.length < 24) throw new Error("Invalid WebP animation frame.");
      const result: WebpFrame = {
        x: uint24(frame, 0) * 2,
        y: uint24(frame, 3) * 2,
        width: uint24(frame, 6) + 1,
        height: uint24(frame, 9) + 1,
        duration: Math.max(10, uint24(frame, 12)),
        dispose: Boolean(frame[15] & 1),
        replace: Boolean(frame[15] & 2),
        data: frame.slice(16),
      };
      if (result.x + result.width > width || result.y + result.height > height)
        throw new Error("WebP frame exceeds its canvas.");
      return result;
    });
  if (
    !frames.length ||
    frames.length > MAX_BACKGROUND_FRAMES ||
    width * height * frames.length > MAX_BACKGROUND_DECODE_PIXELS
  ) {
    throw new Error(
      "Animation is too large. Use up to 300 frames and 32 million total pixels.",
    );
  }
  return {
    width,
    height,
    loops: control[4] + control[5] * 256,
    background: `rgba(${control[2]},${control[1]},${control[0]},${control[3] / 255})`,
    frames,
  };
}

export function write24(data: Uint8Array, at: number, value: number): void {
  data[at] = value;
  data[at + 1] = value >> 8;
  data[at + 2] = value >> 16;
}
export function webpChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(8 + data.length + (data.length % 2));
  chunk.set(new TextEncoder().encode(type));
  new DataView(chunk.buffer).setUint32(4, data.length, true);
  chunk.set(data, 8);
  return chunk;
}
export function webpContainer(chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(
    12 + chunks.reduce((sum, chunk) => sum + chunk.length, 0),
  );
  bytes.set(new TextEncoder().encode("RIFF"));
  bytes.set(new TextEncoder().encode("WEBP"), 8);
  new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true);
  let at = 12;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}
export function standaloneWebpFrame(frame: WebpFrame): Uint8Array<ArrayBuffer> {
  const header = new Uint8Array(10);
  header[0] = 16;
  write24(header, 4, frame.width - 1);
  write24(header, 7, frame.height - 1);
  return webpContainer([webpChunk("VP8X", header), frame.data]);
}
