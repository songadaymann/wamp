import type Phaser from 'phaser';
import { ROOM_PX_HEIGHT, ROOM_PX_WIDTH } from '../../config';
import { MUSIC_ROOM_LABEL_GUTTER, MUSIC_ROOM_NEIGHBOR_PEEK, planRoomCameraFit,
  readMusicRoomViewport, syncMusicWorkbenchFrame } from './musicRoomFit';

export function applyEditorMusicCameraFit(
  camera: Phaser.Cameras.Scene2D.Camera, canvas: HTMLCanvasElement,
  origin: { x: number; y: number }, storeZoom: (zoom: number) => void,
): void {
  const plan = planRoomCameraFit({
    cameraWidth: camera.width, cameraHeight: camera.height,
    originX: camera.originX, originY: camera.originY,
    roomX: origin.x, roomY: origin.y, roomWidth: ROOM_PX_WIDTH, roomHeight: ROOM_PX_HEIGHT,
    viewport: readMusicRoomViewport(canvas, canvas.ownerDocument, camera.width, camera.height),
    worldInset: { left: MUSIC_ROOM_LABEL_GUTTER, top: MUSIC_ROOM_NEIGHBOR_PEEK,
      right: MUSIC_ROOM_NEIGHBOR_PEEK, bottom: MUSIC_ROOM_NEIGHBOR_PEEK },
  });
  storeZoom(plan.zoom);
  camera.setZoom(plan.zoom);
  camera.setScroll(plan.scrollX, plan.scrollY);
  syncMusicWorkbenchFrame(canvas, camera.width, camera.height, plan);
}
