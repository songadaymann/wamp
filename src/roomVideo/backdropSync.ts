type FramesModule = typeof import('./frames');

let framesModule: FramesModule | null = null;
let loading: Promise<FramesModule> | null = null;
const released = new WeakSet<object>();

function sceneHostsVideo(scene: object): boolean {
  return typeof (scene as { getRoomOrigin?: unknown }).getRoomOrigin === 'function';
}

function loadFrames(): Promise<FramesModule> {
  loading ??= import('./frames').then((mod) => {
    framesModule = mod;
    return mod;
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
    if (released.has(scene) || !sceneHostsVideo(scene)) return;
    mod.syncOverworldRoomVideo(scene as never, stackParent as never);
  });
}

export function releaseRoomVideoBackdrop(scene: object): void {
  released.add(scene);
  framesModule?.destroyRoomVideoFrame(scene as never);
}
