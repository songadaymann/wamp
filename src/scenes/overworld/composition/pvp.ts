import { getPerformanceSuggestionModalController } from '../../../ui/setup/performanceSuggestionModal';
import { MultiplayerRemotePlayerRenderer } from '../multiplayerRemotePlayerRenderer';
import { OverworldPvpArenaController } from '../pvpArenaController';
import { OverworldPvpLocalPresentationController } from '../pvpLocalPresentationController';
import type { OverworldCompositionPorts } from './ports';

export function createPvpInstanceRenderer(
  host: Pick<OverworldCompositionPorts,
    | 'scene' | 'PLAYER_WIDTH' | 'PLAYER_HEIGHT'
    | 'PLAYER_STANDING_HEIGHT' | 'presentRemotePvpCombatEvent'
  >,
): MultiplayerRemotePlayerRenderer {
  return new MultiplayerRemotePlayerRenderer({
    scene: host.scene,
    playerWidth: host.PLAYER_WIDTH,
    playerHeight: host.PLAYER_HEIGHT,
    playerStandingHeight: host.PLAYER_STANDING_HEIGHT,
    presentCombatEvent: (event, receivedAt) => host.presentRemotePvpCombatEvent(event, receivedAt),
  });
}

export function createPvpLocalPresentationController(host: Pick<OverworldCompositionPorts, 'scene' | 'PLAYER_WIDTH' | 'PLAYER_STANDING_HEIGHT' | 'playerSprite'>): OverworldPvpLocalPresentationController {
  return new OverworldPvpLocalPresentationController({
    scene: host.scene,
    playerWidth: host.PLAYER_WIDTH,
    playerStandingHeight: host.PLAYER_STANDING_HEIGHT,
    getPlayerSprite: () => host.playerSprite,
  });
}

export function createPvpArenaController(
  host: Pick<OverworldCompositionPorts,
    | 'presenceController' | 'selectedCoordinates' | 'getRoomSnapshotForCoordinates'
    | 'getPvpOpponentIdentity' | 'worldStreamingController' | 'refreshAround'
    | 'preparePvpArenaDuel' | 'movementController' | 'pvpInstanceRenderer'
    | 'handlePeerRoomStateEvent' | 'combatPresentationController' | 'maybeApplyPvpStartingPosition'
    | 'applyPvpArenaCameraLock' | 'syncPvpLocalHeartLabel' | 'playPvpLocalDamageFeedback'
    | 'clearPvpSceneRuntime' | 'returnToWorld' | 'renderHud'
    | 'showTransientStatus' | 'mode'
  >,
): OverworldPvpArenaController {
  return new OverworldPvpArenaController({
    getIdentity: () => host.presenceController.getIdentity(),
    getSelectedCoordinates: () => host.selectedCoordinates,
    getSelectedRoom: () => host.getRoomSnapshotForCoordinates(host.selectedCoordinates),
    getRoomSnapshotForCoordinates: (coordinates) => host.getRoomSnapshotForCoordinates(coordinates),
    getPvpOpponentIdentity: (connectionId) => host.getPvpOpponentIdentity(connectionId),
    sendPvpInvite: (targetConnectionId, invite) => host.presenceController.sendPvpInvite(targetConnectionId, invite),
    acceptPvpInvite: (invite) => host.presenceController.acceptPvpInvite(invite),
    declinePvpInvite: (invite) => {
      host.presenceController.declinePvpInvite(invite);
    },
    isWithinLoadedRoomBounds: (coordinates) => host.worldStreamingController.isWithinLoadedRoomBounds(coordinates),
    refreshAround: (coordinates) => host.refreshAround(coordinates),
    prepareArenaDuel: (roomCoordinates, opponentUserId, modeDefinition) => host.preparePvpArenaDuel(roomCoordinates, opponentUserId, modeDefinition),
    refreshPlayerHitbox: () => host.movementController.refreshPlayerHitbox(),
    syncPresenceMatchSnapshot: (snapshot, localUserId, opponentUserId) => {
      host.presenceController.setPvpMatchSnapshot(snapshot, localUserId);
      host.presenceController.setPvpInstanceOpponentUserId(opponentUserId);
    },
    syncInstanceMatchSnapshot: (snapshot, localUserId) => host.pvpInstanceRenderer.syncMatchSnapshot(snapshot, localUserId),
    handlePeerState: (state) => host.pvpInstanceRenderer.handlePeerState(state),
    handlePeerCombatEvent: (event) => host.pvpInstanceRenderer.handleCombatEvent(event),
    handlePeerRoomStateEvent: (event) => host.handlePeerRoomStateEvent(event),
    destroyCombatProjectiles: () => host.combatPresentationController.destroyProjectiles(),
    maybeApplyStartingPosition: (snapshot) => host.maybeApplyPvpStartingPosition(snapshot),
    applyCameraLock: () => host.applyPvpArenaCameraLock(),
    syncLocalHeartLabel: () => host.syncPvpLocalHeartLabel(),
    playLocalDamageFeedback: (previousHearts, nextHearts) => host.playPvpLocalDamageFeedback(previousHearts, nextHearts),
    clearSceneRuntime: () => host.clearPvpSceneRuntime(),
    returnToWorld: () => host.returnToWorld(),
    renderHud: () => host.renderHud(),
    showTransientStatus: (message) => host.showTransientStatus(message),
    canPromptForInvite: () => host.mode === 'browse' && document.body.dataset.appMode === 'world',
    onSetupStateChanged: (inProgress) => {
      getPerformanceSuggestionModalController()?.handlePvpSetupStateChanged(inProgress);
    },
  });
}
