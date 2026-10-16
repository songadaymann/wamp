import { afterEach, expect, it, vi } from "vitest";
vi.mock("../auth/request", () => ({
  requireAuthenticatedRequestAuth: async () => ({
    user: { id: "fixture-owner" },
    source: "session",
    school: null,
  }),
}));
import { handleBackgroundImageRequest } from "./routes";
import type { Env } from "../core/types";
afterEach(() => vi.unstubAllGlobals());
it("refuses a disguised GIF before moderation or any approval write", async () => {
  const statements: string[] = [];
  const row = {
    id: "test-image",
    owner_user_id: "fixture-owner",
    cloudflare_image_id: "test-image",
    status: "upload_pending",
    mime_type: "image/png",
  };
  const env = {
    CLOUDFLARE_ACCOUNT_ID: "fixture-account",
    CLOUDFLARE_IMAGES_API_TOKEN: "fixture-token",
    DB: {
      prepare: (query: string) => {
        statements.push(query);
        return {
          bind() {
            return this;
          },
          first: async () => row,
          all: async () => ({ results: [] }),
        };
      },
    },
  } as unknown as Env;
  const requests: string[] = [];
  vi.stubGlobal("fetch", async (input: string) => {
    requests.push(input);
    return input.endsWith("/blob")
      ? new Response("GIF89a disguised as png")
      : Response.json({
          success: true,
          result: {
            id: "test-image",
            uploaded: "2026-10-16T00:00:00Z",
            draft: false,
          },
        });
  });
  const request = new Request(
    "https://api.wamp.land/api/background-images/test-image/finalize",
    { method: "POST" },
  );
  await expect(
    handleBackgroundImageRequest(request, new URL(request.url), env),
  ).rejects.toMatchObject({ status: 400 });
  expect(requests).toHaveLength(2);
  expect(requests[1]).toMatch(/\/blob$/);
  expect(
    statements.every(
      (query) => !query.includes("UPDATE") && !query.includes("INSERT"),
    ),
  ).toBe(true);
});
