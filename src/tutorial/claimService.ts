import type { AuthDebugState } from '../auth/client';
import {
  isRoomApiError,
  type RoomRepository,
} from '../persistence/roomRepository';
import type { WorldRepository } from '../persistence/worldRepository';
import type { RoomCoordinates, RoomRecord, RoomSnapshot } from '../persistence/roomModel';
import {
  rewriteTutorialSnapshotForClaim,
  tutorialSnapshotContentMatches,
} from './snapshotTransplant';

export type TutorialClaimFailureCode =
  | 'auth_required'
  | 'claim_limit'
  | 'stale_frontier'
  | 'concurrent_claim'
  | 'network';

export type TutorialClaimResult =
  | { ok: true; record: RoomRecord; recoveredAfterError: boolean }
  | { ok: false; code: TutorialClaimFailureCode; message: string };

interface TutorialClaimServiceOptions {
  roomRepository: Pick<RoomRepository, 'saveDraft' | 'loadRoomCurrent'>;
  worldRepository: Pick<WorldRepository, 'loadClaimableFrontierWindow'>;
  getAuthState: () => AuthDebugState;
  now?: () => Date;
}

export class TutorialClaimService {
  private readonly now: () => Date;

  constructor(private readonly options: TutorialClaimServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async claim(
    source: RoomSnapshot,
    coordinates: RoomCoordinates,
  ): Promise<TutorialClaimResult> {
    const auth = this.options.getAuthState();
    if (!auth.authenticated || !auth.user) {
      return {
        ok: false,
        code: 'auth_required',
        message: 'Sign in to choose where this room will live.',
      };
    }

    let claimable;
    try {
      claimable = await this.options.worldRepository.loadClaimableFrontierWindow(coordinates, 0);
    } catch {
      return {
        ok: false,
        code: 'network',
        message: 'Could not check that room. Your private draft is still safe.',
      };
    }

    if (claimable.roomClaimsRemainingToday === 0) {
      return {
        ok: false,
        code: 'claim_limit',
        message: 'You have reached today’s room-claim limit. Your private draft is still safe.',
      };
    }
    const destinationId = `${coordinates.x},${coordinates.y}`;
    if (!claimable.rooms.some((room) => room.id === destinationId && room.state === 'frontier')) {
      return {
        ok: false,
        code: 'stale_frontier',
        message: 'Someone reached that room first. Choose another frontier room.',
      };
    }

    const transplant = rewriteTutorialSnapshotForClaim(
      source,
      coordinates,
      this.now().toISOString(),
    );
    try {
      const record = await this.options.roomRepository.saveDraft(transplant);
      return { ok: true, record, recoveredAfterError: false };
    } catch (error) {
      const recovered = await this.recoverLostClaimResponse(transplant, auth.user.id);
      if (recovered) {
        return { ok: true, record: recovered, recoveredAfterError: true };
      }

      if (isRoomApiError(error) && error.status === 409) {
        return {
          ok: false,
          code: 'concurrent_claim',
          message: 'Someone reached that room first. Choose another frontier room.',
        };
      }
      if (isRoomApiError(error) && error.status === 429) {
        return {
          ok: false,
          code: 'claim_limit',
          message: 'You have reached today’s room-claim limit. Your private draft is still safe.',
        };
      }
      return {
        ok: false,
        code: 'network',
        message: 'The claim did not finish. Your private draft is still safe.',
      };
    }
  }

  private async recoverLostClaimResponse(
    transplant: RoomSnapshot,
    userId: string,
  ): Promise<RoomRecord | null> {
    try {
      const current = await this.options.roomRepository.loadRoomCurrent(
        transplant.id,
        transplant.coordinates,
      );
      if (
        current.summary.claimerUserId !== userId
        || !tutorialSnapshotContentMatches(transplant, current.draft)
      ) {
        return null;
      }
      return {
        draft: current.draft,
        published: current.published,
        versions: [],
        canonicalVersion: current.summary.canonicalVersion,
        claimerUserId: current.summary.claimerUserId,
        claimerPrincipalKind: current.summary.claimerPrincipalKind,
        claimerAgentId: current.summary.claimerAgentId,
        claimerDisplayName: current.summary.claimerDisplayName,
        claimedAt: current.summary.claimedAt,
        lastPublishedByUserId: current.summary.lastPublishedByUserId,
        lastPublishedByPrincipalKind: current.summary.lastPublishedByPrincipalKind,
        lastPublishedByAgentId: current.summary.lastPublishedByAgentId,
        lastPublishedByDisplayName: current.summary.lastPublishedByDisplayName,
        mintedChainId: current.summary.mintedChainId,
        mintedContractAddress: current.summary.mintedContractAddress,
        mintedTokenId: current.summary.mintedTokenId,
        mintedOwnerWalletAddress: current.summary.mintedOwnerWalletAddress,
        mintedOwnerSyncedAt: current.summary.mintedOwnerSyncedAt,
        mintedMetadataRoomVersion: current.summary.mintedMetadataRoomVersion,
        mintedMetadataUpdatedAt: current.summary.mintedMetadataUpdatedAt,
        mintedMetadataHash: current.summary.mintedMetadataHash,
        permissions: current.summary.permissions,
      };
    } catch {
      return null;
    }
  }
}
