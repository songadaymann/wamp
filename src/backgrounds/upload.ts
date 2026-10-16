import {
  decodeBackground,
  isBackgroundAnimation,
  releaseBackgroundImage,
} from "./animation";
import {
  backgroundDimensions,
  detectBackgroundMime,
  webpChunk,
  webpChunks,
  webpContainer,
  write24,
} from "./webp";

const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

async function encode(canvas: HTMLCanvasElement): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.82),
  );
  if (blob?.type === "image/webp") return blob;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not prepare background.");
  const { encodeWebpFallback } = await import("./webpEncoder");
  return encodeWebpFallback(
    context.getImageData(0, 0, canvas.width, canvas.height),
  );
}

/** Validates bytes, strips metadata, caps dimensions, and preserves WebP animation. */
export async function prepareBackgroundFile(file: File): Promise<File> {
  if (file.size > MAX_INPUT_BYTES)
    throw new Error("Image must be 8 MB or smaller.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = detectBackgroundMime(bytes);
  if (!mime) throw new Error("Upload a real PNG, JPG, or WebP image.");
  const size = backgroundDimensions(bytes);
  if (!size.width || !size.height || size.width * size.height > 16_000_000)
    throw new Error("Image dimensions are too large.");
  const decoded = await decodeBackground(new Blob([bytes], { type: mime }));
  const canvas = document.createElement("canvas");
  try {
    const animated = isBackgroundAnimation(decoded);
    const width =
      "naturalWidth" in decoded ? decoded.naturalWidth : decoded.width;
    const height =
      "naturalHeight" in decoded ? decoded.naturalHeight : decoded.height;
    if (!width || !height || width * height > 16_000_000)
      throw new Error("Image dimensions are too large.");
    const scale = Math.min(
      1,
      (animated ? 240 : 1280) / width,
      (animated ? 240 : 768) / height,
    );
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare background image.");
    let output: Blob;
    if (animated) {
      const header = new Uint8Array(10);
      header[0] = 18;
      write24(header, 4, canvas.width - 1);
      write24(header, 7, canvas.height - 1);
      const control = new Uint8Array(6);
      control[4] = decoded.loops;
      control[5] = decoded.loops >> 8;
      const chunks = [webpChunk("VP8X", header), webpChunk("ANIM", control)];
      let encodedBytes = 0;
      for (let index = 0; index < decoded.frames.length; index++) {
        // Let the progress dialog paint between CPU-heavy fallback encodes.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(
          decoded.frames[index],
          0,
          0,
          canvas.width,
          canvas.height,
        );
        const still = new Uint8Array(
          await (await encode(canvas)).arrayBuffer(),
        );
        const imageChunks = webpChunks(still).filter((chunk) =>
          ["ALPH", "VP8 ", "VP8L"].includes(chunk.type),
        );
        const frameHeader = new Uint8Array(16);
        write24(frameHeader, 6, canvas.width - 1);
        write24(frameHeader, 9, canvas.height - 1);
        write24(frameHeader, 12, decoded.durations[index]);
        frameHeader[15] = 2;
        const parts = [
          frameHeader,
          ...imageChunks.map((chunk) => webpChunk(chunk.type, chunk.data)),
        ];
        const frame = new Uint8Array(
          parts.reduce((sum, part) => sum + part.length, 0),
        );
        let at = 0;
        for (const part of parts) {
          frame.set(part, at);
          at += part.length;
        }
        encodedBytes += frame.length;
        if (encodedBytes > MAX_OUTPUT_BYTES)
          throw new Error("Animation is too large. Use a shorter loop.");
        chunks.push(webpChunk("ANMF", frame));
      }
      output = new Blob([webpContainer(chunks)], { type: "image/webp" });
    } else {
      context.drawImage(decoded, 0, 0, canvas.width, canvas.height);
      output = await encode(canvas);
    }
    if (output.size > MAX_OUTPUT_BYTES)
      throw new Error("Image is too large. Use a smaller image.");
    return new File(
      [output],
      `${file.name.replace(/\.[^.]*$/, "") || "background"}.webp`,
      { type: "image/webp" },
    );
  } finally {
    releaseBackgroundImage(decoded);
    canvas.width = 1;
    canvas.height = 1;
  }
}
