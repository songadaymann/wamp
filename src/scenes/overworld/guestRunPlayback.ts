import { getGuestRunService, type GuestRunSaveResult, type GuestRunService, type GuestRunSession } from '../../guestRooms/runService';
import type { GuestRunStartBody } from '../../guestRooms/runModel';
import type { RunFinishRequestBody } from '../../runs/model';
import type { PostRunRatingRequestDetail } from '../../progression/postRunRatingEvents';
import { requestPostRunGuestClaim } from '../../progression/postRunRatingEvents';
import { createPostRunClearReward, notifyRewardStings } from '../../progression/rewardStings';
import type { RankedRunTraceBinding } from './rankedRunTraceRecorder';

export interface GuestPlaybackRunState {
  attemptId: string | null;
  pendingResult: RunFinishRequestBody['result'] | null;
  submissionState: 'waiting' | 'local-only' | 'starting' | 'active' | 'finishing' | 'submitted' | 'error';
  submissionMessage: string | null;
  verificationSchemaVersion: number | null;
  verificationNonce: string | null;
  snapshotHash: string | null;
  guestProgress?: GuestRunSaveResult;
}
interface GuestPlaybackEntry { session: GuestRunSession; finished: boolean; kind: 'room' | 'course' }
interface GuestRunPlaybackOptions {
  service?: Pick<GuestRunService, 'begin'>;
  getCurrentRun(kind: 'room' | 'course'): GuestPlaybackRunState | null;
  startTrace(kind: 'room' | 'course', binding: RankedRunTraceBinding): void;
  clearTrace(): void;
  renderHud(): void;
}

/** Owns guest trace lifetime independently of network replies or the current account. */
export class GuestRunPlaybackController {
  private readonly entries = new WeakMap<GuestPlaybackRunState, GuestPlaybackEntry>();
  private traceOwner: GuestPlaybackRunState | null = null;
  private readonly service: Pick<GuestRunService, 'begin'>;
  constructor(private readonly options: GuestRunPlaybackOptions) { this.service = options.service ?? getGuestRunService(); }

  has(run: GuestPlaybackRunState): boolean { return this.entries.has(run); }

  begin(run: GuestPlaybackRunState, kind: 'room' | 'course', target: Omit<GuestRunStartBody, 'clientRunId'>): void {
    if (this.has(run)) return;
    const session = this.service.begin(target);
    const entry = { session, finished: false, kind };
    this.entries.set(run, entry);
    run.submissionState = 'starting'; run.submissionMessage = 'Starting guest run...'; run.guestProgress = session.progress;
    run.verificationSchemaVersion = session.initialBinding.verificationSchemaVersion;
    run.verificationNonce = session.initialBinding.verificationNonce; run.snapshotHash = session.initialBinding.snapshotHash;
    this.traceOwner = run;
    this.options.startTrace(kind, session.initialBinding);
    void session.ready.then(binding => {
      if (this.options.getCurrentRun(kind) !== run || this.entries.get(run) !== entry || entry.finished) return;
      if (binding) {
        run.attemptId = binding.attemptId; run.verificationSchemaVersion = binding.verificationSchemaVersion;
        run.verificationNonce = binding.verificationNonce; run.snapshotHash = binding.snapshotHash;
        run.submissionState = 'active'; run.submissionMessage = 'Guest run active.';
      } else {
        run.submissionState = 'active'; run.submissionMessage = 'Playing while guest progress reconnects.';
      }
      // The recorder already holds early inputs; never reset it when the reply arrives.
      this.options.renderHud();
    });
  }

  finish(run: GuestPlaybackRunState, body: RunFinishRequestBody, detail?: PostRunRatingRequestDetail): void {
    const entry = this.entries.get(run);
    if (!entry || entry.finished) return;
    entry.finished = true; run.pendingResult = null; run.submissionState = 'finishing'; run.submissionMessage = 'Verifying guest clear...';
    const pending = entry.session.finish(body);
    run.guestProgress = entry.session.progress;
    if (this.traceOwner === run) { this.options.clearTrace(); this.traceOwner = null; }
    if (body.result === 'completed' && detail) {
      notifyRewardStings([createPostRunClearReward(detail)]);
      requestPostRunGuestClaim({ ...detail, guestProgress: run.guestProgress });
    }
    void pending.then(result => {
      // History and the durable queue survive even if this run has already left the scene.
      run.guestProgress = result; run.attemptId = result.attemptId;
      run.submissionState = result.status === 'saved' ? 'submitted' : result.status === 'queued' ? 'finishing' : 'local-only';
      run.submissionMessage = body.result !== 'completed' ? 'Guest run ended.'
        : result.status === 'saved' ? 'Verified clear saved. Sign in within 14 days to keep it.'
          : result.status === 'queued' ? result.durable ? 'Clear waiting for a connection.' : 'Keep this tab open while the clear retries.'
            : 'Clear could not be verified. Sign in and replay to earn XP.';
      if (this.options.getCurrentRun(entry.kind) === run) this.options.renderHud();
    });
  }
}
