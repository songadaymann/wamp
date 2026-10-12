import Phaser from 'phaser';
import { globalRoomMusicController } from '../music/controller';
import {
  placeRoomVideo,
  roomVideoHeight,
  type RoomVideo,
} from './model';

const HOLE_DEPTH = -4;
const HANDLE_DEPTH = 200;
const HANDLE_SCREEN_PX = 10;

type FrameCorner = 'nw' | 'ne' | 'se' | 'sw';

interface YouTubePlayer {
  destroy(): void;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(volume: number): void;
  mute(): void;
  unMute(): void;
  getIframe(): HTMLIFrameElement;
  unloadModule(moduleName: string): void;
  setOption(module: string, option: string, value: object): void;
}

interface YouTubeNamespace {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      host?: string;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: () => void;
        onStateChange?: (event: { data: number }) => void;
      };
    },
  ) => YouTubePlayer;
}

declare global {
  interface Window {
    YT?: YouTubeNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

export interface RoomVideoFrameSync {
  video: RoomVideo | null;
  originX: number;
  originY: number;
  /** edit shows the poster. play follows the room options. hidden removes the frame. */
  playback: 'edit' | 'play' | 'hidden';
  interactive: boolean;
  triggerPressed: boolean;
  sessionKey: string;
  onChange?: (video: RoomVideo, commit: boolean) => void;
  /** Depth inside stackParent. Play rooms draw the background at 9 and tiles at 10. */
  holeDepth?: number;
  /** Play mode draws the room as one layer, so the hole has to live inside that layer. */
  stackParent?: Phaser.GameObjects.Container | null;
}

interface DragState {
  kind: 'move' | FrameCorner;
  roomX: number;
  roomY: number;
  video: RoomVideo;
  anchorX: number;
  anchorY: number;
}

let youtubeApiPromise: Promise<void> | null = null;

export class RoomVideoFrameController {
  private hole: Phaser.GameObjects.Graphics | null = null;
  private handles: Phaser.GameObjects.Graphics | null = null;
  private host: HTMLElement | null = null;
  private mount: HTMLElement | null = null;
  private player: YouTubePlayer | null = null;
  private playerToken = 0;
  private playerReady = false;
  private playerState = -1;
  private playerKey = '';
  private appliedVolume = -1;
  private wantsPlay = false;
  private triggerLatched = false;
  private triggerWasPressed = false;
  private sessionKey = '';
  private drag: DragState | null = null;
  private cursorOverride = false;
  private appliedDuck = false;
  private maskCanvas: HTMLCanvasElement | null = null;
  private maskContext: CanvasRenderingContext2D | null = null;
  private maskHash = 0;
  private destroyed = false;
  private current: RoomVideoFrameSync | null = null;

  constructor(private readonly scene: Phaser.Scene) {
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    this.scene.events.once(Phaser.Scenes.Events.DESTROY, this.destroy, this);
    this.scene.events.on(Phaser.Scenes.Events.SLEEP, this.hide, this);
    this.scene.game.events.on(Phaser.Core.Events.POST_RENDER, this.paintTileMask, this);
  }

  sync(next: RoomVideoFrameSync): void {
    if (this.destroyed || !this.scene.sys.isActive()) {
      this.hide();
      return;
    }
    this.current = next;
    if (this.drag && !next.interactive) {
      if (next.video) next.onChange?.(next.video, true);
      this.drag = null;
      this.setCursor(null);
    }
    if (next.sessionKey !== this.sessionKey) {
      this.sessionKey = next.sessionKey;
      this.triggerLatched = false;
      this.triggerWasPressed = false;
      this.wantsPlay = false;
    }
    if (next.playback === 'hidden' || !next.video) {
      this.hide();
      return;
    }

    const risingTrigger = next.triggerPressed && !this.triggerWasPressed;
    this.triggerWasPressed = next.triggerPressed;
    if (next.playback === 'play' && next.video.trigger && (risingTrigger || next.triggerPressed)) {
      this.triggerLatched = true;
    }

    this.ensureGraphics(next);
    this.drawHole(next);
    this.drawHandles(next);
    this.ensurePlayer(next);
    this.layoutPlayer(next);
    this.applyPlayback(next, risingTrigger);
    this.applyDuck(next);
  }

  handlePointerDown(pointer: Phaser.Input.Pointer): boolean {
    const current = this.current;
    if (!current?.interactive || !current.video || !pointer.leftButtonDown()) return false;
    const local = this.pointerToRoom(pointer, current);
    if (!local) return false;
    const corner = this.hitCorner(current.video, local.x, local.y);
    const inside = this.containsFrame(current.video, local.x, local.y);
    if (!corner && !inside) return false;
    const height = roomVideoHeight(current.video);
    const anchor = corner ? oppositeCorner(current.video, height, corner) : { x: current.video.x, y: current.video.y };
    this.drag = {
      kind: corner ?? 'move',
      roomX: local.x,
      roomY: local.y,
      video: { ...current.video },
      anchorX: anchor.x,
      anchorY: anchor.y,
    };
    this.setCursor(corner ? cornerCursor(corner) : 'move');
    return true;
  }

  handlePointerMove(pointer: Phaser.Input.Pointer): boolean {
    const current = this.current;
    if (!current?.interactive || !current.video) {
      this.setCursor(null);
      return false;
    }
    if (!this.drag) {
      const local = this.pointerToRoom(pointer, current);
      const corner = local ? this.hitCorner(current.video, local.x, local.y) : null;
      const inside = local ? this.containsFrame(current.video, local.x, local.y) : false;
      this.setCursor(corner ? cornerCursor(corner) : inside ? 'move' : null);
      return false;
    }
    const local = this.pointerToRoom(pointer, current);
    if (!local) return true;
    const next = this.drag.kind === 'move'
      ? this.moveDrag(local, current)
      : this.scaleDrag(local, current);
    current.onChange?.(next, false);
    return true;
  }

  handlePointerUp(): boolean {
    if (!this.drag) return false;
    const video = this.current?.video;
    if (video) this.current?.onChange?.(video, true);
    this.drag = null;
    this.setCursor(null);
    return true;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    this.scene.events.off(Phaser.Scenes.Events.DESTROY, this.destroy, this);
    this.scene.events.off(Phaser.Scenes.Events.SLEEP, this.hide, this);
    this.scene.game.events.off(Phaser.Core.Events.POST_RENDER, this.paintTileMask, this);
    this.hide();
    this.hole?.destroy();
    this.handles?.destroy();
    this.hole = null;
    this.handles = null;
    this.setCursor(null);
  }

  private hide(): void {
    this.drag = null;
    this.playerKey = '';
    this.playerReady = false;
    this.playerState = -1;
    this.wantsPlay = false;
    this.appliedVolume = -1;
    this.destroyPlayer();
    this.hole?.clear();
    this.handles?.clear();
    this.clearTileMask();
    this.applyDuck(null);
    this.setCursor(null);
  }

  private keepFrameOnMainCamera(): void {
    const main = this.scene.cameras.main;
    for (const camera of this.scene.cameras.cameras) {
      if (camera === main) continue;
      if (this.hole) camera.ignore(this.hole);
      if (this.handles) camera.ignore(this.handles);
    }
  }

  private ensureGraphics(sync: RoomVideoFrameSync): void {
    if (!this.hole?.scene) {
      this.hole?.destroy();
      this.hole = this.scene.add.graphics();
      this.hole.setBlendMode(Phaser.BlendModes.ERASE);
    }
    this.hole.setDepth(sync.holeDepth ?? HOLE_DEPTH);
    this.attachToStack(this.hole, sync.stackParent ?? null);
    if (!this.handles?.scene) {
      this.handles?.destroy();
      this.handles = this.scene.add.graphics().setDepth(HANDLE_DEPTH);
    }
  }

  private attachToStack(
    object: Phaser.GameObjects.Graphics,
    parent: Phaser.GameObjects.Container | null,
  ): void {
    const stack = parent?.scene ? parent : null;
    if (stack) {
      if (object.parentContainer !== stack) stack.add(object);
      return;
    }
    if (!object.parentContainer) return;
    object.parentContainer.remove(object);
    this.scene.add.existing(object);
  }

  private drawHole(sync: RoomVideoFrameSync): void {
    const video = sync.video;
    if (!this.hole || !video) return;
    const height = roomVideoHeight(video);
    this.hole.clear();
    this.hole.setPosition(sync.originX, sync.originY);
    this.hole.fillStyle(0xffffff, 1);
    this.hole.fillRect(video.x, video.y, video.width, height);
    this.keepFrameOnMainCamera();
  }

  private drawHandles(sync: RoomVideoFrameSync): void {
    if (!this.handles) return;
    this.handles.clear();
    const video = sync.video;
    if (!sync.interactive || !video) return;
    const height = roomVideoHeight(video);
    const zoom = this.scene.cameras.main.zoom || 1;
    const handle = HANDLE_SCREEN_PX / zoom;
    this.handles.lineStyle(Math.max(1, 2 / zoom), 0xfff3db, 1);
    this.handles.strokeRect(sync.originX + video.x, sync.originY + video.y, video.width, height);
    this.handles.fillStyle(0xfff3db, 1);
    for (const corner of corners(video, height)) {
      this.handles.fillRect(
        sync.originX + corner.x - handle / 2,
        sync.originY + corner.y - handle / 2,
        handle,
        handle,
      );
    }
  }

  private ensurePlayer(sync: RoomVideoFrameSync): void {
    const video = sync.video;
    if (!video) return;
    const key = `${sync.sessionKey}:${video.youtubeId}:${video.loop ? 1 : 0}`;
    if (key === this.playerKey && this.player) return;
    this.playerKey = key;
    this.playerReady = false;
    this.playerState = -1;
    this.wantsPlay = false;
    this.appliedVolume = -1;
    this.destroyPlayer();
    const host = this.ensureHost();
    const mount = this.scene.game.canvas.ownerDocument.createElement('div');
    host.appendChild(mount);
    this.mount = mount;
    const token = ++this.playerToken;
    void loadYouTubeApi().then(() => {
      if (this.destroyed || token !== this.playerToken || !window.YT || !this.mount) return;
      this.player = new window.YT.Player(this.mount, {
        videoId: video.youtubeId,
        host: 'https://www.youtube-nocookie.com',
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          fs: 0,
          iv_load_policy: 3,
          cc_load_policy: 0,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          loop: video.loop ? 1 : 0,
          ...(video.loop ? { playlist: video.youtubeId } : {}),
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            if (token !== this.playerToken) return;
            this.playerReady = true;
            this.hidePlayerChrome(this.player);
            if (this.current) this.layoutPlayer(this.current);
            this.applyPlayback(this.current, false);
            this.applyDuck(this.current);
          },
          onStateChange: (event) => {
            if (token !== this.playerToken) return;
            this.playerState = event.data;
            this.hidePlayerChrome(this.player);
            if (event.data === 0 && this.current?.video?.loop && this.wantsPlay) {
              this.player?.seekTo(0, true);
              this.player?.playVideo();
            }
            this.applyDuck(this.current);
          },
        },
      });
    }).catch(() => {});
  }

  private hidePlayerChrome(player: YouTubePlayer | null): void {
    if (!player) return;
    try {
      player.unloadModule('captions');
    } catch {
      void 0;
    }
    try {
      player.setOption('captions', 'track', {});
    } catch {
      void 0;
    }
  }

  private layoutPlayer(sync: RoomVideoFrameSync): void {
    const video = sync.video;
    const iframe = this.playerReady ? this.player?.getIframe() ?? null : this.mount;
    if (!video || !iframe) return;
    const camera = this.scene.cameras.main;
    const view = camera.worldView;
    const zoom = camera.zoom || 1;
    const height = roomVideoHeight(video);
    const left = camera.x + (sync.originX + video.x - view.x) * zoom;
    const top = camera.y + (sync.originY + video.y - view.y) * zoom;
    iframe.style.position = 'absolute';
    iframe.style.left = `${left}px`;
    iframe.style.top = `${top}px`;
    iframe.style.width = `${video.width * zoom}px`;
    iframe.style.height = `${height * zoom}px`;
    iframe.style.border = '0';
    iframe.style.pointerEvents = 'none';
    const volume = Math.round(video.volume * 100);
    if (this.playerReady && this.appliedVolume !== volume) {
      this.appliedVolume = volume;
      if (volume <= 0) this.player?.mute();
      else {
        this.player?.unMute();
        this.player?.setVolume(volume);
      }
    }
  }

  private paintTileMask(): void {
    const sync = this.current;
    const iframe = this.playerReady ? this.player?.getIframe() ?? null : null;
    if (!sync?.video || !iframe || sync.playback === 'hidden' || !this.scene.sys.isActive()) {
      this.clearTileMask();
      return;
    }
    const gameCanvas = this.scene.game.canvas;
    const host = iframe.offsetParent instanceof HTMLElement ? iframe.offsetParent : this.host;
    if (!host || gameCanvas.clientWidth <= 0 || gameCanvas.clientHeight <= 0) return;
    const canvasBox = gameCanvas.getBoundingClientRect();
    const hostBox = host.getBoundingClientRect();
    const left = parseFloat(iframe.style.left);
    const top = parseFloat(iframe.style.top);
    const width = parseFloat(iframe.style.width);
    const height = parseFloat(iframe.style.height);
    if (![left, top, width, height].every(Number.isFinite) || width < 1 || height < 1) return;
    const ratioX = gameCanvas.width / gameCanvas.clientWidth;
    const ratioY = gameCanvas.height / gameCanvas.clientHeight;
    const sourceX = (left - (canvasBox.left - hostBox.left)) * ratioX;
    const sourceY = (top - (canvasBox.top - hostBox.top)) * ratioY;
    const sourceWidth = Math.max(1, Math.round(width * ratioX));
    const sourceHeight = Math.max(1, Math.round(height * ratioY));
    const mask = this.ensureMaskCanvas(sourceWidth, sourceHeight);
    const context = this.maskContext;
    if (!mask || !context) return;
    context.clearRect(0, 0, sourceWidth, sourceHeight);
    try {
      context.drawImage(
        gameCanvas,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        sourceWidth,
        sourceHeight,
      );
    } catch {
      this.clearTileMask();
      return;
    }
    let pixels: ImageData;
    try {
      pixels = context.getImageData(0, 0, sourceWidth, sourceHeight);
    } catch {
      this.clearTileMask();
      return;
    }
    const data = pixels.data;
    let covered = false;
    let hash = sourceWidth * 131 + sourceHeight;
    for (let index = 3; index < data.length; index += 4) {
      const tile = data[index] > 24;
      if (tile) {
        covered = true;
        hash = (hash + index) | 0;
      }
      data[index - 3] = 255;
      data[index - 2] = 255;
      data[index - 1] = 255;
      data[index] = tile ? 0 : 255;
    }
    if (!covered) {
      this.clearTileMask();
      return;
    }
    if (hash === this.maskHash && iframe.style.maskImage) return;
    this.maskHash = hash;
    context.putImageData(pixels, 0, 0);
    let url = '';
    try {
      url = mask.toDataURL();
    } catch {
      this.clearTileMask();
      return;
    }
    this.applyTileMask(iframe, `url("${url}")`);
  }

  private ensureMaskCanvas(width: number, height: number): HTMLCanvasElement | null {
    if (!this.maskCanvas) {
      this.maskCanvas = this.scene.game.canvas.ownerDocument.createElement('canvas');
      this.maskContext = this.maskCanvas.getContext('2d', { willReadFrequently: true });
    }
    if (!this.maskContext) return null;
    if (this.maskCanvas.width !== width || this.maskCanvas.height !== height) {
      this.maskCanvas.width = width;
      this.maskCanvas.height = height;
    }
    return this.maskCanvas;
  }

  private applyTileMask(iframe: HTMLElement, image: string): void {
    iframe.style.maskImage = image;
    iframe.style.setProperty('-webkit-mask-image', image);
    iframe.style.maskSize = '100% 100%';
    iframe.style.setProperty('-webkit-mask-size', '100% 100%');
    iframe.style.maskRepeat = 'no-repeat';
    iframe.style.setProperty('-webkit-mask-repeat', 'no-repeat');
    iframe.style.maskMode = 'alpha';
  }

  private clearTileMask(): void {
    this.maskHash = 0;
    const iframe = this.player?.getIframe?.();
    if (!iframe) return;
    iframe.style.maskImage = '';
    iframe.style.setProperty('-webkit-mask-image', '');
    iframe.style.maskSize = '';
    iframe.style.setProperty('-webkit-mask-size', '');
    iframe.style.maskRepeat = '';
    iframe.style.setProperty('-webkit-mask-repeat', '');
    iframe.style.maskMode = '';
  }

  private applyPlayback(sync: RoomVideoFrameSync | null, risingTrigger: boolean): void {
    const video = sync?.video;
    if (!video || !this.playerReady || !this.player || sync?.playback === 'hidden') return;
    const shouldPlay = sync?.playback === 'play' && (
      video.autoplay || (video.trigger && this.triggerLatched)
    );
    if (shouldPlay && (!this.wantsPlay || (risingTrigger && this.playerState === 0))) {
      this.wantsPlay = true;
      if (this.playerState === 0) this.player.seekTo(0, true);
      this.player.playVideo();
      return;
    }
    if (!shouldPlay && this.wantsPlay) {
      this.wantsPlay = false;
      this.player.pauseVideo();
    }
  }

  private applyDuck(sync: RoomVideoFrameSync | null): void {
    const playing = this.playerState === 1 || this.playerState === 3;
    const duck = Boolean(
      sync?.playback === 'play'
      && sync.video?.muteMusic
      && this.wantsPlay
      && playing,
    );
    if (duck === this.appliedDuck) return;
    this.appliedDuck = duck;
    globalRoomMusicController.setPlaybackDuck(duck ? 0 : 1);
  }

  private moveDrag(local: { x: number; y: number }, sync: RoomVideoFrameSync): RoomVideo {
    const drag = this.drag;
    if (!drag) return sync.video!;
    return placeRoomVideo(
      drag.video,
      drag.video.x + (local.x - drag.roomX),
      drag.video.y + (local.y - drag.roomY),
      drag.video.width,
    );
  }

  private scaleDrag(local: { x: number; y: number }, sync: RoomVideoFrameSync): RoomVideo {
    const drag = this.drag;
    if (!drag || drag.kind === 'move') return sync.video!;
    const west = drag.kind === 'nw' || drag.kind === 'sw';
    const north = drag.kind === 'nw' || drag.kind === 'ne';
    const widthFromX = west ? drag.anchorX - local.x : local.x - drag.anchorX;
    const heightFromY = north ? drag.anchorY - local.y : local.y - drag.anchorY;
    const width = Math.max(widthFromX, heightFromY * drag.video.aspect);
    const height = width / drag.video.aspect;
    const x = west ? drag.anchorX - width : drag.anchorX;
    const y = north ? drag.anchorY - height : drag.anchorY;
    return placeRoomVideo(drag.video, x, y, width, drag.video.aspect);
  }

  private pointerToRoom(
    pointer: Phaser.Input.Pointer,
    sync: RoomVideoFrameSync,
  ): { x: number; y: number } | null {
    const world = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    return {
      x: world.x - sync.originX,
      y: world.y - sync.originY,
    };
  }

  private hitCorner(video: RoomVideo, x: number, y: number): FrameCorner | null {
    const zoom = this.scene.cameras.main.zoom || 1;
    const reach = (HANDLE_SCREEN_PX + 6) / zoom;
    const height = roomVideoHeight(video);
    let closest: FrameCorner | null = null;
    let closestDistance = reach;
    for (const corner of corners(video, height)) {
      const distance = Math.hypot(x - corner.x, y - corner.y);
      if (distance <= closestDistance) {
        closest = corner.id;
        closestDistance = distance;
      }
    }
    return closest;
  }

  private containsFrame(video: RoomVideo, x: number, y: number): boolean {
    return x >= video.x && y >= video.y && x <= video.x + video.width && y <= video.y + roomVideoHeight(video);
  }

  private ensureHost(): HTMLElement {
    if (this.host?.isConnected) return this.host;
    const doc = this.scene.game.canvas.ownerDocument;
    const parent = this.scene.game.canvas.parentElement ?? doc.body;
    const existing = parent.querySelector<HTMLElement>('#room-video-host');
    if (existing) {
      this.host = existing;
      return existing;
    }
    const host = doc.createElement('div');
    host.id = 'room-video-host';
    parent.prepend(host);
    this.host = host;
    return host;
  }

  private destroyPlayer(): void {
    this.playerToken += 1;
    try {
      this.player?.destroy();
    } catch {
      void 0;
    }
    this.player = null;
    this.mount?.remove();
    this.mount = null;
  }

  private setCursor(cursor: string | null): void {
    if (cursor) {
      this.cursorOverride = true;
      this.scene.input.setDefaultCursor(cursor);
      return;
    }
    if (!this.cursorOverride) return;
    this.cursorOverride = false;
    this.scene.input.setDefaultCursor('');
  }
}

function loadYouTubeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (!youtubeApiPromise) {
    youtubeApiPromise = new Promise((resolve) => {
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        previous?.();
        resolve();
      };
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      document.head.appendChild(script);
    });
  }
  return youtubeApiPromise;
}

function corners(video: RoomVideo, height: number): Array<{ id: FrameCorner; x: number; y: number }> {
  return [
    { id: 'nw', x: video.x, y: video.y },
    { id: 'ne', x: video.x + video.width, y: video.y },
    { id: 'se', x: video.x + video.width, y: video.y + height },
    { id: 'sw', x: video.x, y: video.y + height },
  ];
}

function oppositeCorner(video: RoomVideo, height: number, corner: FrameCorner): { x: number; y: number } {
  switch (corner) {
    case 'nw': return { x: video.x + video.width, y: video.y + height };
    case 'ne': return { x: video.x, y: video.y + height };
    case 'se': return { x: video.x, y: video.y };
    case 'sw': return { x: video.x + video.width, y: video.y };
  }
}

function cornerCursor(corner: FrameCorner): string {
  return corner === 'nw' || corner === 'se' ? 'nwse-resize' : 'nesw-resize';
}
