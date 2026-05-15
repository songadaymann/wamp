import type Phaser from 'phaser';
import type { SfxCue } from '../../../audio/sfx';
import type { RoomCoordinates } from '../../../persistence/roomModel';
import type { LoadedRoomObject } from '../liveObjects';
import type { LoadedFullRoom } from '../worldStreaming';
import {
  getCollectibleCue,
  getCollectibleScoreValue,
} from './pickups';

type LiveObjectCollector = 'player' | 'enemy';

interface LiveObjectCollectionEvent {
  roomId: string;
  roomCoordinates: RoomCoordinates;
  instanceId: string | null;
  x: number;
  y: number;
}

interface LiveObjectCollectionHost {
  scene: Phaser.Scene;
  isCollectedObjectKey: (key: string) => boolean;
  markCollectedObjectKey: (key: string) => void;
  addScore: (delta: number) => void;
  onKeyCollected: () => void;
  playRoomSfx: (cue: SfxCue, roomCoordinates: RoomCoordinates) => void;
  playCollectFx: (
    x: number,
    y: number,
    scoreDelta: number,
    roomCoordinates: RoomCoordinates,
    cue?: SfxCue
  ) => void;
  showTransientStatus: (message: string) => void;
  getRoomOrigin: (coordinates: RoomCoordinates) => { x: number; y: number };
  onCollectibleCollected: (event: LiveObjectCollectionEvent) => void;
  onEnemyCollectibleCollected: (event: LiveObjectCollectionEvent) => void;
  destroyLiveObjectInteractions: (liveObject: LoadedRoomObject) => void;
}

export function collectLiveObject<TEdgeWall>(
  loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
  liveObject: LoadedRoomObject,
  host: LiveObjectCollectionHost,
  options: {
    collector?: LiveObjectCollector;
  } = {},
): void {
  if (!liveObject.sprite.active || host.isCollectedObjectKey(liveObject.key)) {
    return;
  }

  const collector = options.collector ?? 'player';
  host.markCollectedObjectKey(liveObject.key);
  const scoreDelta = getCollectibleScoreValue(liveObject.config.id);
  if (collector === 'player') {
    host.addScore(scoreDelta);
    if (liveObject.config.id === 'key') {
      host.onKeyCollected();
    }
    host.playCollectFx(
      liveObject.sprite.x,
      liveObject.sprite.y,
      scoreDelta,
      loadedRoom.room.coordinates,
      getCollectibleCue(liveObject.config.id)
    );
    host.showTransientStatus(`${liveObject.config.name} collected.`);
  } else {
    host.playRoomSfx(getCollectibleCue(liveObject.config.id), loadedRoom.room.coordinates);
  }
  host.destroyLiveObjectInteractions(liveObject);

  const startY = liveObject.sprite.y;
  host.scene.tweens.add({
    targets: liveObject.sprite,
    y: startY - 16,
    scaleX: 1.5,
    scaleY: 1.5,
    alpha: 0,
    duration: 300,
    ease: 'Quad.easeOut',
    onComplete: () => {
      liveObject.sprite.destroy();
    },
  });

  loadedRoom.liveObjects = loadedRoom.liveObjects.filter((candidate) => candidate !== liveObject);
  if (liveObject.countsTowardGoals) {
    const roomOrigin = host.getRoomOrigin(loadedRoom.room.coordinates);
    const event = {
      roomId: loadedRoom.room.id,
      roomCoordinates: loadedRoom.room.coordinates,
      instanceId: liveObject.placedInstanceId,
      x: liveObject.sprite.x - roomOrigin.x,
      y: liveObject.sprite.y - roomOrigin.y,
    };
    if (collector === 'player') {
      host.onCollectibleCollected(event);
    } else {
      host.onEnemyCollectibleCollected(event);
    }
  }
}
