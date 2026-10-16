import {
  backgroundDimensions,
  detectBackgroundMime,
  parseWebpAnimation,
} from "../../../backgrounds/webp";
import { HttpError } from "../core/http";
import type { BackgroundImageUploadRow, Env } from "../core/types";

export function validateBackgroundBytes(
  bytes: Uint8Array,
  claimedMime: string,
): void {
  const mime = detectBackgroundMime(bytes);
  if (!mime || mime !== claimedMime)
    throw new HttpError(
      400,
      "The uploaded bytes do not match the declared PNG, JPG, or WebP type.",
    );
  try {
    const animation = mime === "image/webp" ? parseWebpAnimation(bytes) : null;
    const { width, height } = backgroundDimensions(bytes);
    const maxWidth = animation ? 240 : 1280,
      maxHeight = animation ? 240 : 768;
    if (!width || !height || width > maxWidth || height > maxHeight)
      throw new Error("Image dimensions exceed the background limit.");
  } catch (error) {
    throw new HttpError(
      400,
      error instanceof Error ? error.message : "Invalid background image.",
    );
  }
}

/** The original, authenticated blob prevents content negotiation from hiding a disguised GIF. */
export async function validateUploadedBackground(
  env: Env,
  row: BackgroundImageUploadRow,
): Promise<void> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID ?? "")}/images/v1/${encodeURIComponent(row.cloudflare_image_id)}/blob`,
    {
      headers: {
        Authorization: `Bearer ${env.CLOUDFLARE_IMAGES_API_TOKEN ?? ""}`,
      },
    },
  );
  if (!response.ok || !response.body)
    throw new HttpError(502, "Could not inspect uploaded image.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 2 * 1024 * 1024)
        throw new HttpError(
          400,
          "Prepared background must be 2 MB or smaller. Refresh and upload again.",
        );
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  validateBackgroundBytes(bytes, row.mime_type);
}
