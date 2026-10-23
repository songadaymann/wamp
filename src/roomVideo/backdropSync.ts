import { reportClientError } from '../main/clientErrorReporter';

type FramesModule = typeof import('./frames');

let framesModule: FramesModule | null = null;
let loading: Promise<FramesModule | null> | null = null;
const released = new WeakSet<object>();

function sceneHostsVideo(scene: object): boolean {
  return typeof (scene as { getRoomOrigin?: unknown }).getRoomOrigin === 'function';
}

function loadFrames(): Promise<FramesModule | null> {
  loading ??= import('./frames').then((mod) => {
    framesModule = mod;
    return mod;
  }, (error: unknown) => {
    // The browser keeps a failed download for the page, so room videos stay off until a reload.
    // Settled once here: each frame's sync would otherwise raise another unhandled rejection.
    console.error('Room video backdrops failed to load', error);
    reportClientError({
      type: 'unhandledrejection',
      message: `Room video backdrops failed to load: ${error instanceof Error ? error.message : String(error)}`,
      stack: error instanceof Error ? error.stack ?? null : null,
    });
    return null;
  });
  return loading;
}

export function syncRoomVideoBackdrop(scene: object, stackParent: object | null): void {
  if (!sceneHostsVideo(scene)) return;
  released.delete(scene);
  const ready = framesModule;
  if (ready) {
    ready.syncOverworldRoomVideo(scene as never, stackParent as never);
    return;
  }
  void loadFrames().then((mod) => {
    if (!mod || released.has(scene) || !sceneHostsVideo(scene)) return;
    mod.syncOverworldRoomVideo(scene as never, stackParent as never);
  });
}

export function releaseRoomVideoBackdrop(scene: object): void {
  released.add(scene);
  framesModule?.destroyRoomVideoFrame(scene as never);
}
