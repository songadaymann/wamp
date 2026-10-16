import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import type Phaser from "phaser";
const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock("../ui/reducedMotion", () => ({
  prefersReducedMotion: () => motion.reduced,
}));
import {
  animateBackgroundTexture,
  observeAnimatedBackground,
} from "./animation";

describe("animated texture lifecycle", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    motion.reduced = false;
  });
  it("updates visible tiles on frame boundaries, freezes with comfort settings, and releases frames on eviction", () => {
    vi.stubGlobal("document", { hidden: false });
    const gameEvents = new EventEmitter(),
      textureEvents = new EventEmitter();
    const frames = [
      { width: 10, height: 10 },
      { width: 10, height: 10 },
    ];
    const close = vi.fn();
    const refresh = vi.fn(),
      drawImage = vi.fn();
    const texture = {
      key: "animated",
      context: { clearRect: vi.fn(), drawImage },
      refresh,
    } as unknown as Phaser.Textures.CanvasTexture;
    const scene = {
      game: { events: gameEvents },
      textures: textureEvents,
    } as unknown as Phaser.Scene;
    animateBackgroundTexture(scene, texture, {
      width: 10,
      height: 10,
      frames: frames as HTMLCanvasElement[],
      durations: [100, 100],
      loops: 0,
      close,
    });
    const setTexture = vi.fn();
    const object = Object.assign(new EventEmitter(), {
      active: true,
      visible: true,
      tilePositionX: 0,
      setTexture,
      scene: {
        sys: { isActive: () => true },
        cameras: {
          cameras: [{ worldView: { x: 0, y: 0, right: 100, bottom: 100 } }],
        },
      },
      getBounds: () => ({ left: 0, top: 0, right: 10, bottom: 10 }),
    }) as unknown as Phaser.GameObjects.TileSprite;
    observeAnimatedBackground(object, texture);
    gameEvents.emit("poststep", 0, 99);
    expect(refresh).not.toHaveBeenCalled();
    gameEvents.emit("poststep", 99, 1);
    expect(drawImage).toHaveBeenLastCalledWith(frames[1], 0, 0);
    expect(setTexture).toHaveBeenCalledWith("animated");
    motion.reduced = true;
    gameEvents.emit("poststep", 100, 100);
    expect(drawImage).toHaveBeenLastCalledWith(frames[0], 0, 0);
    motion.reduced = false;
    object.visible = false;
    const count = refresh.mock.calls.length;
    gameEvents.emit("poststep", 200, 100);
    expect(refresh).toHaveBeenCalledTimes(count);
    textureEvents.emit("removetexture-animated");
    expect(close).toHaveBeenCalledOnce();
    expect(gameEvents.listenerCount("poststep")).toBe(0);
    gameEvents.emit("destroy");
    expect(close).toHaveBeenCalledOnce();
  });
});
