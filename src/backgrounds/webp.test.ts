import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  detectBackgroundMime,
  parseWebpAnimation,
  standaloneWebpFrame,
  webpChunk,
  webpContainer,
  write24,
} from "./webp";
import { backgroundFrameAt } from "./animation";

const chosen = new Uint8Array(
  readFileSync(
    new URL(
      "../../docs/review/assets/wamp-background-choice-240px-32colors-2026-10-13.webp",
      import.meta.url,
    ),
  ),
);
function animation(flags = 0) {
  const header = new Uint8Array(10);
  header[0] = 2;
  write24(header, 4, 3);
  write24(header, 7, 3);
  const frame = new Uint8Array(16);
  write24(frame, 6, 1);
  write24(frame, 9, 1);
  write24(frame, 12, 70);
  frame[15] = flags;
  const bytes = new Uint8Array([
    ...frame,
    ...webpChunk("VP8L", new Uint8Array([47, 1, 2, 3, 4])),
  ]);
  return webpContainer([
    webpChunk("VP8X", header),
    webpChunk("ANIM", new Uint8Array([20, 30, 40, 255, 3, 0])),
    webpChunk("ANMF", bytes),
  ]);
}
describe("background WebP container", () => {
  it("preserves the exact selected animation dimensions, timing, and loop", () => {
    const result = parseWebpAnimation(chosen)!;
    expect(result).toMatchObject({ width: 240, height: 135, loops: 0 });
    expect(result.frames).toHaveLength(59);
    expect(result.frames.reduce((sum, frame) => sum + frame.duration, 0)).toBe(
      5900,
    );
    expect(detectBackgroundMime(standaloneWebpFrame(result.frames[20]))).toBe(
      "image/webp",
    );
  });
  it("retains disposal, replacement, background color and finite loops", () => {
    expect(parseWebpAnimation(animation(3))).toMatchObject({
      loops: 3,
      background: "rgba(40,30,20,1)",
      frames: [{ dispose: true, replace: true, duration: 70 }],
    });
  });
  it("rejects truncated containers, frame overruns and excessive decode area", () => {
    expect(() => parseWebpAnimation(chosen.slice(0, -2))).toThrow(/container/);
    const overrun = animation();
    write24(overrun, 50, 3);
    expect(() => parseWebpAnimation(overrun)).toThrow();
    const huge = animation();
    write24(huge, 24, 16383);
    write24(huge, 27, 16383);
    expect(() => parseWebpAnimation(huge)).toThrow(/large/);
  });
  it("identifies bytes rather than names or browser MIME metadata", () => {
    expect(
      detectBackgroundMime(new TextEncoder().encode("GIF89a pretend.png")),
    ).toBeNull();
    expect(
      detectBackgroundMime(new TextEncoder().encode("<svg>pretend.webp</svg>")),
    ).toBeNull();
    expect(detectBackgroundMime(chosen)).toBe("image/webp");
  });
  it("honors boundaries, repeated loops and final-frame hold", () => {
    expect(
      [0, 69, 70, 99, 100, 199, 200].map((time) =>
        backgroundFrameAt([70, 30], 0, time),
      ),
    ).toEqual([0, 0, 1, 1, 0, 1, 0]);
    expect(backgroundFrameAt([70, 30], 2, 200)).toBe(1);
    expect(backgroundFrameAt([70, 30], 2, 10000)).toBe(1);
  });
});
