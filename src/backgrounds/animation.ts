import type Phaser from "phaser";
import { prefersReducedMotion } from "../ui/reducedMotion";
import { parseWebpAnimation, standaloneWebpFrame } from "./webp";

export interface BackgroundAnimation {
  width: number;
  height: number;
  frames: HTMLCanvasElement[];
  durations: number[];
  loops: number;
  close(): void;
}
export type BackgroundDecodedImage =
  ImageBitmap | HTMLImageElement | BackgroundAnimation;
export const isBackgroundAnimation = (
  image: BackgroundDecodedImage,
): image is BackgroundAnimation => "frames" in image;

export async function decodeBackgroundStill(
  blob: Blob,
): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof globalThis.createImageBitmap === "function")
    return createImageBitmap(blob);
  const url = URL.createObjectURL(blob),
    image = new Image();
  try {
    image.src = url;
    await image.decode();
    return image;
  } catch (error) {
    image.src = "";
    throw error;
  } finally {
    URL.revokeObjectURL(url);
  }
}
export function releaseBackgroundImage(image: BackgroundDecodedImage): void {
  if ("close" in image) image.close();
  else image.src = "";
}

export async function decodeBackground(
  blob: Blob,
): Promise<BackgroundDecodedImage> {
  const animation = parseWebpAnimation(
    new Uint8Array(await blob.arrayBuffer()),
  );
  if (!animation) return decodeBackgroundStill(blob);
  const canvas = document.createElement("canvas");
  canvas.width = animation.width;
  canvas.height = animation.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not decode animated background.");
  const frames: HTMLCanvasElement[] = [];
  const clear = (x: number, y: number, width: number, height: number) => {
    context.clearRect(x, y, width, height);
    context.fillStyle = animation.background;
    context.fillRect(x, y, width, height);
  };
  const close = () => {
    for (const frame of frames) {
      frame.width = 1;
      frame.height = 1;
    }
  };
  clear(0, 0, canvas.width, canvas.height);
  try {
    for (const frame of animation.frames) {
      const image = await decodeBackgroundStill(
        new Blob([standaloneWebpFrame(frame)], { type: "image/webp" }),
      );
      try {
        if (frame.replace)
          context.clearRect(frame.x, frame.y, frame.width, frame.height);
        context.drawImage(image, frame.x, frame.y, frame.width, frame.height);
      } finally {
        releaseBackgroundImage(image);
      }
      const snapshot = document.createElement("canvas");
      snapshot.width = canvas.width;
      snapshot.height = canvas.height;
      const snapshotContext = snapshot.getContext("2d");
      if (!snapshotContext)
        throw new Error("Could not prepare animated background frame.");
      snapshotContext.drawImage(canvas, 0, 0);
      frames.push(snapshot);
      if (frame.dispose) clear(frame.x, frame.y, frame.width, frame.height);
    }
    return {
      width: canvas.width,
      height: canvas.height,
      frames,
      durations: animation.frames.map((frame) => frame.duration),
      loops: animation.loops,
      close,
    };
  } catch (error) {
    close();
    throw error;
  } finally {
    canvas.width = 1;
    canvas.height = 1;
  }
}

export function backgroundFrameAt(
  durations: number[],
  loops: number,
  elapsed: number,
): number {
  const total = durations.reduce((sum, duration) => sum + duration, 0);
  if (loops && elapsed >= total * loops) return durations.length - 1;
  let remaining = elapsed % total;
  for (let index = 0; index < durations.length; index++) {
    if (remaining < durations[index]) return index;
    remaining -= durations[index];
  }
  return 0;
}

type BackgroundObject =
  Phaser.GameObjects.Image | Phaser.GameObjects.TileSprite;
const animatedTextures = new WeakMap<
  Phaser.Textures.Texture,
  Set<BackgroundObject>
>();

export function observeAnimatedBackground(
  object: BackgroundObject,
  texture: Phaser.Textures.Texture,
): void {
  const objects = animatedTextures.get(texture);
  if (!objects) return;
  objects.add(object);
  object.once("destroy", () => objects.delete(object));
}

export function animateBackgroundTexture(
  scene: Phaser.Scene,
  texture: Phaser.Textures.CanvasTexture,
  animation: BackgroundAnimation,
): void {
  const objects = new Set<BackgroundObject>();
  animatedTextures.set(texture, objects);
  let elapsed = 0,
    current = 0;
  const update = (_time: number, delta: number) => {
    const visible = [...objects].some(
      (object) =>
        object.active &&
        object.visible &&
        object.scene?.sys.isActive() &&
        object.scene.cameras.cameras.some((camera) => {
          const view = camera.worldView,
            bounds = object.getBounds();
          return (
            bounds.right > view.x &&
            bounds.left < view.right &&
            bounds.bottom > view.y &&
            bounds.top < view.bottom
          );
        }),
    );
    if (!visible || document.hidden) return;
    if (!prefersReducedMotion()) elapsed += Math.max(0, delta);
    const next = prefersReducedMotion()
      ? 0
      : backgroundFrameAt(animation.durations, animation.loops, elapsed);
    if (next === current) return;
    current = next;
    texture.context.clearRect(0, 0, animation.width, animation.height);
    texture.context.drawImage(animation.frames[current], 0, 0);
    texture.refresh();
    // TileSprite owns a separate repeating texture. Its public texture setter
    // rebuilds that pattern; marking it dirty only redraws the old pattern.
    for (const object of objects)
      if ("tilePositionX" in object) object.setTexture(texture.key);
  };
  const cleanup = () => {
    scene.game.events.off("poststep", update);
    scene.game.events.off("destroy", cleanup);
    scene.textures.off(`removetexture-${texture.key}`, cleanup);
    objects.clear();
    animatedTextures.delete(texture);
    animation.close();
  };
  scene.game.events.on("poststep", update);
  scene.game.events.once("destroy", cleanup);
  scene.textures.once(`removetexture-${texture.key}`, cleanup);
}
