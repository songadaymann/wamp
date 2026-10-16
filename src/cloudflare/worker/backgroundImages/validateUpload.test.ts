import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  validateBackgroundBytes,
  validateUploadedBackground,
} from "./validateUpload";
import type { BackgroundImageUploadRow, Env } from "../core/types";
const chosen = new Uint8Array(
  readFileSync(
    new URL(
      "../../../../docs/review/assets/wamp-background-choice-240px-32colors-2026-10-13.webp",
      import.meta.url,
    ),
  ),
);
const row = {
  cloudflare_image_id: "test-image",
  mime_type: "image/webp",
} as BackgroundImageUploadRow;
describe("background upload byte validation", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("accepts the chosen prepared animation but rejects disguised formats", () => {
    expect(() => validateBackgroundBytes(chosen, "image/webp")).not.toThrow();
    expect(() => validateBackgroundBytes(chosen, "image/png")).toThrow(
      /declared/,
    );
    expect(() =>
      validateBackgroundBytes(
        new TextEncoder().encode("GIF89a fake png"),
        "image/png",
      ),
    ).toThrow(/declared/);
    expect(() =>
      validateBackgroundBytes(chosen.slice(0, 40), "image/webp"),
    ).toThrow();
  });
  it("rejects oversized PNG dimensions despite an allowed MIME header", () => {
    const png = new Uint8Array(24);
    png.set([137, 80, 78, 71, 13, 10, 26, 10]);
    png.set(new TextEncoder().encode("IHDR"), 12);
    const v = new DataView(png.buffer);
    v.setUint32(16, 1281);
    v.setUint32(20, 768);
    expect(() => validateBackgroundBytes(png, "image/png")).toThrow(
      /dimensions/,
    );
  });
  it("downloads authenticated original bytes and never negotiates a sanitized delivery image", async () => {
    const fetcher = vi.fn(async () => new Response(chosen));
    vi.stubGlobal("fetch", fetcher);
    await validateUploadedBackground(
      {
        CLOUDFLARE_ACCOUNT_ID: "test-account",
        CLOUDFLARE_IMAGES_API_TOKEN: "test-token",
      } as Env,
      row,
    );
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/accounts/test-account/images/v1/test-image/blob",
      { headers: { Authorization: "Bearer test-token" } },
    );
  });
  it("fails closed when original bytes cannot be inspected or exceed the cap", async () => {
    vi.stubGlobal("fetch", async () => new Response("denied", { status: 403 }));
    await expect(
      validateUploadedBackground({} as Env, row),
    ).rejects.toMatchObject({ status: 502 });
    vi.stubGlobal(
      "fetch",
      async () => new Response(new Uint8Array(2 * 1024 * 1024 + 1)),
    );
    await expect(
      validateUploadedBackground({} as Env, row),
    ).rejects.toMatchObject({ status: 400 });
  });
});
