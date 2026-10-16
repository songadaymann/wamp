import encode, { init } from "@jsquash/webp/encode.js";
import scalarUrl from "@jsquash/webp/codec/enc/webp_enc.wasm?url";
import simdUrl from "@jsquash/webp/codec/enc/webp_enc_simd.wasm?url";

let ready: Promise<unknown> | undefined;
export async function encodeWebpFallback(data: ImageData): Promise<Blob> {
  ready ??= init({
    locateFile: (name: string) => (name.includes("simd") ? simdUrl : scalarUrl),
  });
  await ready;
  return new Blob([await encode(data, { quality: 82 })], {
    type: "image/webp",
  });
}
