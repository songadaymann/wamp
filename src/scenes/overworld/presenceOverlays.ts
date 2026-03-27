import Phaser from 'phaser';
import { type RoomCoordinates } from '../../persistence/roomModel';
import { type WorldWindow } from '../../persistence/worldModel';
import { ROOM_PX_HEIGHT, ROOM_PX_WIDTH } from '../../config';
import {
  type BrowsePresenceDotPresence,
  type PlayRoomPresenceMarkerDescriptor,
} from './presence';

const MIN_OVERLAY_ZOOM = 0.08;

interface BrowsePresenceDotRenderer {
  connectionId: string;
  dot: Phaser.GameObjects.Arc;
  targetX: number;
  targetY: number;
}

interface PlayRoomPresenceMarker {
  roomId: string;
  container: Phaser.GameObjects.Container;
  pips: Phaser.GameObjects.Arc[];
}

interface OverworldPresenceOverlayControllerHost {
  scene: Phaser.Scene;
  getWorldWindow(): WorldWindow | null;
  getCurrentRoomCoordinates(): RoomCoordinates;
  getRoomOrigin(coordinates: RoomCoordinates): { x: number; y: number };
  getZoom(): number;
  getSampledBrowsePresenceDots(visibleRooms: RoomCoordinates[]): BrowsePresenceDotPresence[];
  getPlayRoomPresenceMarkers(
    visibleRooms: RoomCoordinates[],
    currentRoomCoordinates: RoomCoordinates,
  ): PlayRoomPresenceMarkerDescriptor[];
}

export class OverworldPresenceOverlayController {
  private readonly browsePresenceDotsByConnectionId = new Map<string, BrowsePresenceDotRenderer>();
  private playRoomPresenceMarkers: PlayRoomPresenceMarker[] = [];

  constructor(private readonly host: OverworldPresenceOverlayControllerHost) {}

  destroy(): void {
    this.destroyBrowsePresenceDots();
    this.destroyPlayRoomPresenceMarkers();
  }

  syncOverlays(): void {
    this.syncBrowsePresenceDots();
    this.syncPlayRoomPresenceMarkers();
  }

  updateBrowseDots(delta: number): void {
    if (this.browsePresenceDotsByConnectionId.size === 0) {
      return;
    }

    const step = Math.min(1, delta / 90);
    for (const presenceDot of this.browsePresenceDotsByConnectionId.values()) {
      presenceDot.dot.x = Phaser.Math.Linear(presenceDot.dot.x, presenceDot.targetX, step);
      presenceDot.dot.y = Phaser.Math.Linear(presenceDot.dot.y, presenceDot.targetY, step);
    }
  }

  syncOverlayScale(): void {
    const zoom = Math.max(this.host.getZoom(), MIN_OVERLAY_ZOOM);
    const browseDotRadius = Phaser.Math.Clamp(2.2 / zoom, 1.2, 26);
    for (const presenceDot of this.browsePresenceDotsByConnectionId.values()) {
      presenceDot.dot.setRadius(browseDotRadius);
    }

    const markerBackgroundWidth = Phaser.Math.Clamp(20 / zoom, 18, 44);
    const markerBackgroundHeight = Phaser.Math.Clamp(8 / zoom, 8, 18);
    const markerPipRadius = Phaser.Math.Clamp(2.1 / zoom, 1.4, 5);
    const markerSpacing = markerPipRadius * 2.8;
    for (const marker of this.playRoomPresenceMarkers) {
      const [background] = marker.container.list as Phaser.GameObjects.GameObject[];
      if (background instanceof Phaser.GameObjects.Rectangle) {
        background.setSize(markerBackgroundWidth, markerBackgroundHeight);
      }

      const totalWidth = (marker.pips.length - 1) * markerSpacing;
      marker.pips.forEach((pip, index) => {
        pip.setRadius(markerPipRadius);
        pip.setPosition(index * markerSpacing - totalWidth * 0.5, 0);
      });
    }
  }

  getBackdropIgnoredObjects(): Phaser.GameObjects.GameObject[] {
    return [
      ...Array.from(this.browsePresenceDotsByConnectionId.values()).map((presenceDot) => presenceDot.dot),
      ...this.playRoomPresenceMarkers.map((marker) => marker.container),
    ];
  }

  getBrowseDotCount(): number {
    return this.browsePresenceDotsByConnectionId.size;
  }

  getPlayRoomMarkerCount(): number {
    return this.playRoomPresenceMarkers.length;
  }

  private destroyBrowsePresenceDots(): void {
    for (const presenceDot of this.browsePresenceDotsByConnectionId.values()) {
      presenceDot.dot.destroy();
    }
    this.browsePresenceDotsByConnectionId.clear();
  }

  private destroyPlayRoomPresenceMarkers(): void {
    for (const marker of this.playRoomPresenceMarkers) {
      marker.container.destroy(true);
    }
    this.playRoomPresenceMarkers = [];
  }

  private getVisibleRoomCoordinates(): RoomCoordinates[] {
    const worldWindow = this.host.getWorldWindow();
    if (!worldWindow) {
      return [];
    }

    const worldView = this.host.scene.cameras.main.worldView;
    const minWorldX = worldWindow.center.x - worldWindow.radius;
    const maxWorldX = worldWindow.center.x + worldWindow.radius;
    const minWorldY = worldWindow.center.y - worldWindow.radius;
    const maxWorldY = worldWindow.center.y + worldWindow.radius;
    const minX = Math.max(minWorldX, Math.floor(worldView.left / ROOM_PX_WIDTH));
    const maxX = Math.min(maxWorldX, Math.floor((worldView.right - 1) / ROOM_PX_WIDTH));
    const minY = Math.max(minWorldY, Math.floor(worldView.top / ROOM_PX_HEIGHT));
    const maxY = Math.min(maxWorldY, Math.floor((worldView.bottom - 1) / ROOM_PX_HEIGHT));
    const coordinates: RoomCoordinates[] = [];

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        coordinates.push({ x, y });
      }
    }

    return coordinates;
  }

  private syncBrowsePresenceDots(): void {
    const visibleRooms = this.getVisibleRoomCoordinates();
    const sampledDots = this.host.getSampledBrowsePresenceDots(visibleRooms);
    if (sampledDots.length === 0) {
      if (this.browsePresenceDotsByConnectionId.size > 0) {
        this.destroyBrowsePresenceDots();
      }
      return;
    }

    const nextConnectionIds = new Set<string>();
    for (const sampledDot of sampledDots) {
      nextConnectionIds.add(sampledDot.connectionId);
      const existing = this.browsePresenceDotsByConnectionId.get(sampledDot.connectionId);
      if (!existing) {
        const dot = this.host.scene.add.circle(sampledDot.x, sampledDot.y, 4, 0xffffff, 0.96);
        dot.setDepth(17);
        this.browsePresenceDotsByConnectionId.set(sampledDot.connectionId, {
          connectionId: sampledDot.connectionId,
          dot,
          targetX: sampledDot.x,
          targetY: sampledDot.y,
        });
        continue;
      }

      existing.targetX = sampledDot.x;
      existing.targetY = sampledDot.y;
    }

    for (const [connectionId, presenceDot] of this.browsePresenceDotsByConnectionId.entries()) {
      if (nextConnectionIds.has(connectionId)) {
        continue;
      }

      presenceDot.dot.destroy();
      this.browsePresenceDotsByConnectionId.delete(connectionId);
    }

    this.syncOverlayScale();
  }

  private syncPlayRoomPresenceMarkers(): void {
    const visibleRooms = this.getVisibleRoomCoordinates();
    const descriptors = this.host.getPlayRoomPresenceMarkers(
      visibleRooms,
      this.host.getCurrentRoomCoordinates(),
    );
    if (descriptors.length === 0) {
      if (this.playRoomPresenceMarkers.length > 0) {
        this.destroyPlayRoomPresenceMarkers();
      }
      return;
    }

    const existingMarkersByRoomId = new Map(
      this.playRoomPresenceMarkers.map((marker) => [marker.roomId, marker] as const),
    );
    const nextMarkers: PlayRoomPresenceMarker[] = [];

    for (const descriptor of descriptors) {
      const pipCount = this.getPlayRoomPresenceMarkerPipCount(descriptor.population);
      const origin = this.host.getRoomOrigin(descriptor.coordinates);
      const existing = existingMarkersByRoomId.get(descriptor.roomId);
      if (existing && existing.pips.length === pipCount) {
        existing.container.setPosition(origin.x + ROOM_PX_WIDTH * 0.5, origin.y + 8);
        existingMarkersByRoomId.delete(descriptor.roomId);
        nextMarkers.push(existing);
        continue;
      }

      if (existing) {
        existing.container.destroy(true);
        existingMarkersByRoomId.delete(descriptor.roomId);
      }

      nextMarkers.push(this.createPlayRoomPresenceMarker(descriptor, pipCount));
    }

    for (const marker of existingMarkersByRoomId.values()) {
      marker.container.destroy(true);
    }

    this.playRoomPresenceMarkers = nextMarkers;
    this.syncOverlayScale();
  }

  private getPlayRoomPresenceMarkerPipCount(population: number): number {
    if (population >= 4) {
      return 3;
    }

    if (population >= 2) {
      return 2;
    }

    return 1;
  }

  private createPlayRoomPresenceMarker(
    descriptor: { roomId: string; coordinates: RoomCoordinates },
    pipCount: number,
  ): PlayRoomPresenceMarker {
    const background = this.host.scene.add.rectangle(0, 0, 24, 10, 0x050505, 0.76);
    background.setOrigin(0.5, 0.5);
    background.setStrokeStyle(1, 0xffffff, 0.6);

    const pips: Phaser.GameObjects.Arc[] = [];
    for (let index = 0; index < pipCount; index += 1) {
      const pip = this.host.scene.add.circle(0, 0, 2, 0xffffff, 0.96);
      pip.setOrigin(0.5);
      pips.push(pip);
    }

    const origin = this.host.getRoomOrigin(descriptor.coordinates);
    const container = this.host.scene.add.container(origin.x + ROOM_PX_WIDTH * 0.5, origin.y + 8, [
      background,
      ...pips,
    ]);
    container.setDepth(21);
    return {
      roomId: descriptor.roomId,
      container,
      pips,
    };
  }
}
