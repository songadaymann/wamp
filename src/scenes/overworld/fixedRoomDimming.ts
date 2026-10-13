import type Phaser from 'phaser';
import { ROOM_PX_HEIGHT, ROOM_PX_WIDTH } from '../../config';
import { getDeviceLayoutState } from '../../ui/deviceLayout';
import type { RoomSnapshotView } from '../../persistence/roomModel';

/** Dim neighboring rooms while keeping the builder's full-room framing on portrait phones. */
export class FixedRoomDimming {
  private graphics: Phaser.GameObjects.Graphics | null = null;
  private lastKey = '';
  private attached = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly getRoom: () => RoomSnapshotView | null,
    private readonly isFixed: () => boolean,
    private readonly getOrigin: (room: RoomSnapshotView) => { x: number; y: number },
  ) {}

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    this.scene.game.events.on('prerender', this.update, this);
    this.scene.events.once('shutdown', this.destroy, this);
  }

  private update(): void {
    const layout = getDeviceLayoutState();
    const room = this.getRoom();
    if (!room || !this.isFixed() || layout.deviceClass !== 'phone' || layout.orientationState !== 'portrait') {
      this.graphics?.setVisible(false);
      this.lastKey = '';
      return;
    }
    const camera = this.scene.cameras.main;
    const origin = this.getOrigin(room);
    const key = `${room.id}:${origin.x}:${origin.y}:${camera.scrollX}:${camera.scrollY}:${camera.zoom}:${camera.width}:${camera.height}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.graphics ??= this.scene.add.graphics().setDepth(1_000_000);
    this.graphics.setVisible(true).clear().fillStyle(0x18161c, 0.7);
    // Camera scroll is measured before zoom, around its origin. Cover only this camera's view.
    const width = camera.width / camera.zoom;
    const height = camera.height / camera.zoom;
    const left = camera.scrollX + camera.width * camera.originX - width * camera.originX;
    const top = camera.scrollY + camera.height * camera.originY - height * camera.originY;
    const right = left + width;
    const bottom = top + height;
    const roomBottom = origin.y + ROOM_PX_HEIGHT;
    const roomRight = origin.x + ROOM_PX_WIDTH;
    const bandTop = Math.max(top, origin.y);
    const bandBottom = Math.min(bottom, roomBottom);
    const fill = (x: number, y: number, w: number, h: number) => {
      if (w > 0 && h > 0) this.graphics!.fillRect(x, y, w, h);
    };
    fill(left, top, width, Math.min(bottom, origin.y) - top);
    fill(left, Math.max(top, roomBottom), width, bottom - Math.max(top, roomBottom));
    fill(left, bandTop, Math.min(right, origin.x) - left, bandBottom - bandTop);
    fill(Math.max(left, roomRight), bandTop, right - Math.max(left, roomRight), bandBottom - bandTop);
  }

  private destroy(): void {
    this.scene.game.events.off('prerender', this.update, this);
    this.graphics?.destroy();
    this.graphics = null;
    this.attached = false;
    this.lastKey = '';
  }
}
