import { getAuthDebugState } from '../auth/client';
import type { RoomCoordinates } from '../persistence/roomModel';
import { claimGuestRoomDraft, listMyGuestRoomDrafts, GuestRoomDraftApiError } from './client';
import type { GuestRoomDraftClaimResponse, GuestRoomDraftSummary } from './model';
import { captureGuestRunIdentity, type GuestRunRecoveryIdentity } from './runRepository';

export interface GuestDraftRecoveryItem {
  draft: GuestRoomDraftSummary;
  transfer: GuestRoomDraftClaimResponse | null;
  error: string | null;
  retry?: boolean;
}
interface Options {
  account?: () => string | null;
  identity?: () => GuestRunRecoveryIdentity;
  list?: typeof listMyGuestRoomDrafts;
  claim?: typeof claimGuestRoomDraft;
}
export function guestDraftAccountId(): string | null {
  const auth = getAuthDebugState(); return auth.authenticated ? auth.user?.id ?? null : null;
}

/** Never reattribute an in-flight transfer to a different signed-in account. */
export class GuestDraftRecoveryService {
  private readonly account;
  private readonly identity;
  private readonly list;
  private readonly claim;
  constructor(options: Options = {}) {
    this.account = options.account ?? guestDraftAccountId; this.identity = options.identity ?? captureGuestRunIdentity;
    this.list = options.list ?? listMyGuestRoomDrafts; this.claim = options.claim ?? claimGuestRoomDraft;
  }

  async sync(): Promise<{ userId: string | null; items: GuestDraftRecoveryItem[] } | null> {
    const userId = this.account(); const identity = this.identity();
    const { drafts } = await this.list(identity);
    if (this.account() !== userId) return null;
    const items: GuestDraftRecoveryItem[] = [];
    for (const draft of drafts) {
      if (this.account() !== userId) return null;
      if (draft.guestUserId !== identity.guestUserId || (draft.status !== 'active' && draft.status !== 'claimed')
        || draft.status === 'claimed' && draft.claimedByUserId !== userId) continue;
      const item: GuestDraftRecoveryItem = { draft, transfer: null, error: null };
      if (userId) {
        try {
          const response = await this.claim(draft.id, { expectedUserId: userId }, identity);
          this.validate(response, draft.id, userId); item.transfer = response;
        } catch (error) {
          item.error = error instanceof Error ? error.message : 'Your guest draft is still saved. Try again.';
          item.retry = !(error instanceof GuestRoomDraftApiError) || error.status >= 500 || error.status === 401;
        }
        if (this.account() !== userId) return null;
      }
      items.push(item);
    }
    return { userId, items };
  }

  async transfer(draftId: string, userId: string, coordinates?: RoomCoordinates): Promise<GuestRoomDraftClaimResponse | null> {
    if (this.account() !== userId) return null;
    const response = await this.claim(draftId, { expectedUserId: userId, coordinates }, this.identity());
    if (this.account() !== userId) return null;
    this.validate(response, draftId, userId); return response;
  }

  private validate(response: GuestRoomDraftClaimResponse, draftId: string, userId: string): void {
    if (response.userId !== userId || response.draftId !== draftId || !['claimed', 'conflict'].includes(response.outcome)
      || response.outcome === 'claimed' && (!response.room || response.room.draft.id !== response.roomId)) {
      throw new Error('The draft transfer could not be confirmed for this account. Refresh to retry.');
    }
  }
}
