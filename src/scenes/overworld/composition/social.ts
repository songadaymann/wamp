import type { RoomSnapshot } from '../../../persistence/roomModel';
import { DEFAULT_PLAYER_VISUAL_FEET_OFFSET } from '../../../player/defaultPlayer';
import { BrowseRealtimeStartupGate } from '../browseRealtimeStartup';
import { OverworldPresenceController } from '../presence';
import { OverworldPresenceOverlayController } from '../presenceOverlays';
import { OverworldRoomChatController } from '../roomChat';
import { OverworldRoomCommentsController } from '../roomComments';
import type { OverworldCompositionPorts } from './ports';

export function createPresenceController(
  host: Pick<OverworldCompositionPorts,
    | 'scene' | 'loadedFullRoomsById' | 'mode'
    | 'currentRoomCoordinates' | 'selectedCoordinates' | 'cameras'
    | 'queuePresenceSnapshotSync' | 'redrawWorld' | 'handlePvpInvite'
    | 'handlePvpInviteAccepted' | 'showTransientStatus'
  >,
): OverworldPresenceController {
  return new OverworldPresenceController({
    scene: host.scene,
    isFullRoomLoaded: (roomId) => host.loadedFullRoomsById.has(roomId),
    isConstructionRoomLoaded: (roomId) => host.loadedFullRoomsById.get(roomId)?.room.status === 'draft',
    getMode: () => host.mode,
    getCurrentRoomCoordinates: () => host.currentRoomCoordinates,
    getSelectedCoordinates: () => host.selectedCoordinates,
    getZoom: () => host.cameras.main.zoom,
    onSnapshotUpdated: () => {
      host.queuePresenceSnapshotSync();
    },
    onRoomActivityChanged: () => host.redrawWorld(),
    onPvpInvite: (invite) => {
      void host.handlePvpInvite(invite);
    },
    onPvpInviteAccepted: (message) => {
      void host.handlePvpInviteAccepted(message.matchId, message.acceptedBy);
    },
    onPvpInviteDeclined: (message) => {
      host.showTransientStatus(`${message.declinedBy.displayName} declined the duel.`);
    },
  });
}

export function createRoomChatController(
  host: Pick<OverworldCompositionPorts,
    | 'scene' | 'mode' | 'currentRoomCoordinates'
    | 'player' | 'playerBody' | 'presenceController'
    | 'showTransientStatus'
  >,
): OverworldRoomChatController {
  return new OverworldRoomChatController({
    scene: host.scene,
    getMode: () => host.mode,
    getCurrentRoomCoordinates: () => host.currentRoomCoordinates,
    getPlayerAnchor: () => host.player && host.playerBody
      ? {
        x: host.player.x,
        y: host.playerBody.bottom + DEFAULT_PLAYER_VISUAL_FEET_OFFSET,
      }
      : null,
    getPresenceClient: () => host.presenceController.getClient(),
    getRenderedGhostsByConnectionId: () => host.presenceController.getRenderedGhostsByConnectionId(),
    showTransientStatus: (message) => host.showTransientStatus(message),
  });
}

export function createBrowseRealtimeStartupGate(host: Pick<OverworldCompositionPorts, 'runtimeContext' | 'worldStreamingController' | 'applyPresenceSubscriptions'>): BrowseRealtimeStartupGate {
  return new BrowseRealtimeStartupGate({
    runtime: host.runtimeContext,
    waitForBrowseReady: (signal) => host.worldStreamingController.waitForBrowseSecondaryStartupReady(signal),
    applySubscriptions: () => host.applyPresenceSubscriptions(),
    onWaitError: (error) => {
      console.warn('Failed to wait for browse imagery before realtime startup', error);
    },
  });
}

export function createRoomCommentsController(
  host: Pick<OverworldCompositionPorts,
    | 'scene' | 'mode' | 'getRoomSnapshotViewForCoordinates'
    | 'currentRoomCoordinates' | 'getCellStateAt' | 'worldWindow'
    | 'selectedCoordinates' | 'getRoomOrigin' | 'getPlayerCommentPosition'
    | 'cameras' | 'selectRoomCoordinates' | 'jumpToCoordinates'
    | 'showTransientStatus' | 'worldStreamingController'
  >,
): OverworldRoomCommentsController {
  return new OverworldRoomCommentsController({
    scene: host.scene,
    getMode: () => host.mode,
    getCurrentRoomSnapshot: () => host.getRoomSnapshotViewForCoordinates(host.currentRoomCoordinates) as RoomSnapshot | null,
    isCurrentRoomPublished: () => host.getCellStateAt(host.currentRoomCoordinates) === 'published',
    getWorldWindow: () => host.worldWindow,
    getSelectedCoordinates: () => ({ ...host.selectedCoordinates }),
    getRoomOrigin: (coordinates) => host.getRoomOrigin(coordinates),
    getPlayerCommentPosition: () => host.getPlayerCommentPosition(),
    getZoom: () => host.cameras.main.zoom,
    selectRoomCoordinates: (coordinates) => host.selectRoomCoordinates(coordinates),
    jumpToRoomCoordinates: (coordinates) => host.jumpToCoordinates(coordinates),
    showTransientStatus: (message) => host.showTransientStatus(message),
    waitForBrowseDiscoveryReady: (signal) => host.worldStreamingController.waitForBrowseSecondaryStartupReady(signal),
  });
}

export function createPresenceOverlayController(
  host: Pick<OverworldCompositionPorts,
    | 'scene' | 'worldWindow' | 'currentRoomCoordinates'
    | 'getRoomOrigin' | 'cameras' | 'presenceController'
  >,
): OverworldPresenceOverlayController {
  return new OverworldPresenceOverlayController({
    scene: host.scene,
    getWorldWindow: () => host.worldWindow,
    getCurrentRoomCoordinates: () => ({ ...host.currentRoomCoordinates }),
    getRoomOrigin: (coordinates) => host.getRoomOrigin(coordinates),
    getZoom: () => host.cameras.main.zoom,
    getSampledBrowsePresenceDots: (visibleRooms) => host.presenceController.getSampledBrowsePresenceDots(visibleRooms),
    getPlayRoomPresenceMarkers: (visibleRooms, currentRoomCoordinates) => host.presenceController.getPlayRoomPresenceMarkers(visibleRooms, currentRoomCoordinates),
  });
}
