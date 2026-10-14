import {
  POST_RUN_GUEST_CLAIM_REQUEST_EVENT,
  POST_RUN_RATING_REQUEST_EVENT,
  type PostRunRatingRequestDetail,
} from '../../progression/postRunRatingEvents';
import { GUEST_RUN_PROGRESS_CHANGED_EVENT, type GuestRunSaveResult } from '../../guestRooms/runService';
import type { RunRatingModalController } from './runRatingModal';
import type { RoomSequenceEntry } from './roomSequenceEvents';

type RatingController = Pick<RunRatingModalController,
  'init' | 'destroy' | 'close' | 'requestRating' | 'recordGuestSave' | 'openForSequence'>;

/** Keep every finished run while its first rating dialog downloads. */
export class LazyRunRatingController {
  private instance: RatingController | null = null;
  private loading: Promise<RatingController> | null = null;
  private generation = 0;
  private destroyed = false;
  private pending: Array<{ detail: PostRunRatingRequestDetail; guestOnly: boolean }> = [];
  private readonly guestSaves = new Map<string, GuestRunSaveResult>();

  constructor(private readonly load: () => Promise<RatingController>, private readonly windowObj: Window = window) {}

  private readonly handleRating = (event: Event) => this.queue(event, false);
  private readonly handleGuestClaim = (event: Event) => this.queue(event, true);
  private readonly handleGuestSave = (event: Event) => {
    if (this.instance) return;
    const result = (event as CustomEvent<GuestRunSaveResult>).detail;
    if (!result?.clientRunId) return;
    this.guestSaves.set(result.clientRunId, result);
    if (this.guestSaves.size > 50) this.guestSaves.delete(this.guestSaves.keys().next().value!);
  };

  init(): void {
    this.windowObj.addEventListener(POST_RUN_RATING_REQUEST_EVENT, this.handleRating);
    this.windowObj.addEventListener(POST_RUN_GUEST_CLAIM_REQUEST_EVENT, this.handleGuestClaim);
    this.windowObj.addEventListener(GUEST_RUN_PROGRESS_CHANGED_EVENT, this.handleGuestSave);
  }

  private queue(event: Event, guestOnly: boolean): void {
    if (this.instance || this.destroyed) return;
    const detail = (event as CustomEvent<PostRunRatingRequestDetail>).detail;
    if (!detail) return;
    this.pending.push({ detail, guestOnly });
    void this.ensure().catch(() => {
      // Retain the requests; the next request can retry a failed chunk download.
    });
  }

  async openForSequence(entry: RoomSequenceEntry): Promise<void> {
    const generation = ++this.generation;
    const controller = await this.ensure();
    if (!this.destroyed && generation === this.generation) await controller.openForSequence(entry);
  }

  close(): void {
    this.generation++;
    this.pending = [];
    this.instance?.close();
  }

  destroy(): void {
    this.destroyed = true;
    this.close();
    this.windowObj.removeEventListener(POST_RUN_RATING_REQUEST_EVENT, this.handleRating);
    this.windowObj.removeEventListener(POST_RUN_GUEST_CLAIM_REQUEST_EVENT, this.handleGuestClaim);
    this.windowObj.removeEventListener(GUEST_RUN_PROGRESS_CHANGED_EVENT, this.handleGuestSave);
    this.instance?.destroy();
    this.guestSaves.clear();
  }

  private ensure(): Promise<RatingController> {
    this.loading ??= this.load().then(controller => {
      if (this.destroyed) return controller;
      controller.init();
      this.instance = controller;
      for (const result of this.guestSaves.values()) controller.recordGuestSave(result);
      this.guestSaves.clear();
      const pending = this.pending;
      this.pending = [];
      for (const request of pending) controller.requestRating(request.detail, request.guestOnly);
      return controller;
    }).catch((error: unknown) => {
      this.loading = null;
      throw error;
    });
    return this.loading;
  }
}
