import type Phaser from 'phaser';
import {
  AUTH_STATE_CHANGED_EVENT,
  getAuthDebugState,
  promptForSignIn,
  type AuthDebugState,
} from '../auth/client';
import { listenForTypedEvent } from '../events/typedEvent';
import {
  cloneRoomSnapshot,
  createDefaultRoomSnapshot,
  type RoomSnapshot,
} from '../persistence/roomModel';
import { createRoomRepository, type RoomRepository } from '../persistence/roomRepository';
import { createWorldRepository, type WorldRepository } from '../persistence/worldRepository';
import { hasFocusedCoordinatesInUrl } from '../navigation/worldNavigation';
import { APP_READY_EVENT, isAppReady } from '../ui/appFeedback';
import { buildTutorialCoachmark } from './coachmarks';
import { TutorialClaimService } from './claimService';
import {
  TUTORIAL_BRIDGE_ROOM,
  TUTORIAL_WAKE_ROOM,
} from './config';
import {
  arbitrateLegacyWelcome,
  decideTutorialEligibility,
  hasLegacyWelcomeBeenSeen,
  tutorialReplayForced,
} from './eligibility';
import { evaluateBridgeSnapshot, evaluateCreativeChecklist } from './evaluators';
import {
  TUTORIAL_ACTIVE_SIGN_CHANGED_EVENT,
  TUTORIAL_CLAIM_REQUESTED_EVENT,
  TUTORIAL_EDITOR_MUTATION_EVENT,
  TUTORIAL_PLAYTEST_CANCELLED_EVENT,
  TUTORIAL_PLAYTEST_REQUESTED_EVENT,
  TUTORIAL_ROOM_GOAL_COMPLETED_EVENT,
  type TutorialActiveSignChangedDetail,
  type TutorialClaimRequestedDetail,
  type TutorialEditorMutationDetail,
  type TutorialPlaytestDetail,
  type TutorialPlaytestCancelledDetail,
  type TutorialRoomGoalCompletedDetail,
} from './events';
import {
  cloneCreativeChecklist,
  cloneTutorialSceneContext,
  type CreativeChecklistItem,
  type TutorialProgressV1,
  type TutorialRuntimeMode,
  type TutorialSceneContext,
} from './model';
import { TutorialProgressStore } from './progressStore';
import {
  PhaserTutorialRuntimeGateway,
  type TutorialRuntimeGateway,
} from './runtimeGateway';
import { transitionTutorialProgress, type TutorialTransitionEvent } from './stateMachine';
import {
  PinnedTutorialTemplateLoader,
  type TutorialTemplates,
} from './templateLoader';
import { TutorialView, type TutorialViewAction } from './TutorialView';

export interface TutorialDebugState {
  active: boolean;
  sessionId: string | null;
  stage: TutorialProgressV1['stage'] | null;
  inputLocked: boolean;
  templateVersions: TutorialProgressV1['templateVersions'] | null;
  checklist: TutorialProgressV1['creativeChecklist'] | null;
  hasWorkingSnapshot: boolean;
  hasBridgeBackup: boolean;
  selectedClaimCoordinates: TutorialProgressV1['selectedClaimCoordinates'];
  claimInFlight: boolean;
}

interface TutorialCoordinatorOptions {
  store?: TutorialProgressStore;
  roomRepository?: RoomRepository;
  worldRepository?: WorldRepository;
  templateLoader?: PinnedTutorialTemplateLoader;
  runtime?: TutorialRuntimeGateway;
  view?: TutorialView;
  storage?: Storage;
  eventTarget?: Window;
  doc?: Document;
  getAuthState?: () => AuthDebugState;
  promptForSignIn?: (status: string) => void;
  hasFocusedCoordinates?: () => boolean;
}

const TUTORIAL_AUTO_START_DELAY_MS = 540;

export class TutorialCoordinator {
  private readonly storage: Storage;
  private readonly eventTarget: Window;
  private readonly doc: Document;
  private readonly store: TutorialProgressStore;
  private readonly roomRepository: RoomRepository;
  private readonly templateLoader: PinnedTutorialTemplateLoader;
  private readonly runtime: TutorialRuntimeGateway;
  private readonly view: TutorialView;
  private readonly claimService: TutorialClaimService;
  private readonly getAuthState: () => AuthDebugState;
  private readonly showSignIn: (status: string) => void;
  private readonly hasFocusedCoordinates: () => boolean;
  private progress: TutorialProgressV1 | null = null;
  private templates: TutorialTemplates | null = null;
  private initialized = false;
  private startTimer: number | null = null;
  private claimInFlight = false;
  private readonly removeListeners: Array<() => void> = [];

  constructor(game: Phaser.Game, options: TutorialCoordinatorOptions = {}) {
    this.storage = options.storage ?? window.localStorage;
    this.eventTarget = options.eventTarget ?? window;
    this.doc = options.doc ?? document;
    this.store = options.store ?? new TutorialProgressStore({ storage: this.storage });
    this.roomRepository = options.roomRepository ?? createRoomRepository();
    const worldRepository = options.worldRepository ?? createWorldRepository();
    this.templateLoader = options.templateLoader
      ?? new PinnedTutorialTemplateLoader(this.roomRepository);
    this.runtime = options.runtime ?? new PhaserTutorialRuntimeGateway(game);
    this.getAuthState = options.getAuthState ?? getAuthDebugState;
    this.showSignIn = options.promptForSignIn ?? promptForSignIn;
    this.hasFocusedCoordinates = options.hasFocusedCoordinates
      ?? (() => hasFocusedCoordinatesInUrl(this.eventTarget.location));
    this.view = options.view ?? new TutorialView(this.doc, {
      onAction: (action) => { void this.handleViewAction(action); },
      onSkip: () => { void this.dismiss(); },
    });
    this.claimService = new TutorialClaimService({
      roomRepository: this.roomRepository,
      worldRepository,
      getAuthState: this.getAuthState,
    });
  }

  init(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.progress = this.store.load();
    this.installEventListeners();
    this.eventTarget.get_wamp_tutorial_debug_state = () => this.getDebugState();
    if (isAppReady()) this.scheduleEligibilityCheck();
  }

  destroy(): void {
    if (!this.initialized) return;
    this.initialized = false;
    if (this.startTimer !== null) this.eventTarget.clearTimeout(this.startTimer);
    this.startTimer = null;
    for (const remove of this.removeListeners.splice(0)) remove();
    delete this.eventTarget.get_wamp_tutorial_debug_state;
    this.view.destroy();
  }

  async replay(): Promise<void> {
    await this.runtime.returnToBrowse(null, this.getTemplateRoomIds()).catch(() => {});
    this.progress = this.store.create();
    this.templates = null;
    arbitrateLegacyWelcome(this.storage);
    this.persistAndRender();
  }

  async dismiss(): Promise<void> {
    if (!this.progress || this.progress.terminalStatus !== 'active') {
      this.view.hide();
      return;
    }
    this.transition('DISMISS');
    if (!this.progress) return;
    this.progress.workingSnapshot = null;
    this.progress.bridgeBackupSnapshot = null;
    this.progress.selectedClaimCoordinates = null;
    this.progress = this.store.save(this.progress);
    this.syncDocumentState();
    this.view.hide();
    await this.runtime.returnToBrowse(null, this.getTemplateRoomIds()).catch((error) => {
      console.error('Failed to leave tutorial runtime', error);
    });
  }

  getDebugState(): TutorialDebugState {
    return {
      active: this.progress?.terminalStatus === 'active',
      sessionId: this.progress?.sessionId ?? null,
      stage: this.progress?.stage ?? null,
      inputLocked: this.doc.body.dataset.tutorialInputLocked === 'true',
      templateVersions: this.progress ? { ...this.progress.templateVersions } : null,
      checklist: this.progress ? cloneCreativeChecklist(this.progress.creativeChecklist) : null,
      hasWorkingSnapshot: Boolean(this.progress?.workingSnapshot),
      hasBridgeBackup: Boolean(this.progress?.bridgeBackupSnapshot),
      selectedClaimCoordinates: this.progress?.selectedClaimCoordinates
        ? { ...this.progress.selectedClaimCoordinates }
        : null,
      claimInFlight: this.claimInFlight,
    };
  }

  private installEventListeners(): void {
    const handleReady = () => this.scheduleEligibilityCheck();
    this.eventTarget.addEventListener(APP_READY_EVENT, handleReady);
    this.removeListeners.push(() => this.eventTarget.removeEventListener(APP_READY_EVENT, handleReady));
    this.removeListeners.push(listenForTypedEvent<AuthDebugState>(
      this.eventTarget,
      AUTH_STATE_CHANGED_EVENT,
      () => { void this.resumePendingClaimAfterAuth(); },
    ));
    this.removeListeners.push(listenForTypedEvent<TutorialEditorMutationDetail>(
      this.eventTarget,
      TUTORIAL_EDITOR_MUTATION_EVENT,
      (event) => this.handleEditorMutation(event.detail),
    ));
    this.removeListeners.push(listenForTypedEvent<TutorialPlaytestDetail>(
      this.eventTarget,
      TUTORIAL_PLAYTEST_REQUESTED_EVENT,
      (event) => this.handlePlaytestRequested(event.detail),
    ));
    this.removeListeners.push(listenForTypedEvent<TutorialPlaytestCancelledDetail>(
      this.eventTarget,
      TUTORIAL_PLAYTEST_CANCELLED_EVENT,
      () => this.handlePlaytestCancelled(),
    ));
    this.removeListeners.push(listenForTypedEvent<TutorialRoomGoalCompletedDetail>(
      this.eventTarget,
      TUTORIAL_ROOM_GOAL_COMPLETED_EVENT,
      (event) => { void this.handleGoalCompleted(event.detail); },
    ));
    this.removeListeners.push(listenForTypedEvent<TutorialActiveSignChangedDetail>(
      this.eventTarget,
      TUTORIAL_ACTIVE_SIGN_CHANGED_EVENT,
      (event) => this.handleActiveSignChanged(event.detail),
    ));
    this.removeListeners.push(listenForTypedEvent<TutorialClaimRequestedDetail>(
      this.eventTarget,
      TUTORIAL_CLAIM_REQUESTED_EVENT,
      (event) => { void this.handleClaimRequested(event.detail); },
    ));
  }

  private scheduleEligibilityCheck(): void {
    if (this.startTimer !== null) return;
    this.startTimer = this.eventTarget.setTimeout(() => {
      this.startTimer = null;
      void this.applyEligibilityDecision();
    }, TUTORIAL_AUTO_START_DELAY_MS);
  }

  private async applyEligibilityDecision(): Promise<void> {
    const decision = decideTutorialEligibility({
      progress: this.progress,
      legacyWelcomeSeen: hasLegacyWelcomeBeenSeen(this.storage),
      hasFocusedCoordinates: this.hasFocusedCoordinates(),
      forceReplay: tutorialReplayForced(this.eventTarget.location),
    });
    if (decision === 'ineligible') return;
    if (decision === 'force_replay') {
      await this.replay();
      return;
    }
    if (decision === 'start_new') {
      this.progress = this.store.create();
      arbitrateLegacyWelcome(this.storage);
      this.persistAndRender();
      return;
    }
    await this.resume();
  }

  private async resume(): Promise<void> {
    if (!this.progress || this.progress.terminalStatus !== 'active') return;
    arbitrateLegacyWelcome(this.storage);
    if (this.progress.stage === 'bridge_playtest') {
      this.transition('RESUME_INTERRUPTED_PLAYTEST');
    }
    this.persistAndRender();
    switch (this.progress.stage) {
      case 'dream':
        return;
      case 'wake':
        await this.beginWakeFlow();
        return;
      case 'room_traversal':
      case 'bridge_prompt': {
        const templates = await this.ensureTemplates();
        await this.runtime.startTraversal(
          templates,
          this.progress.stage === 'bridge_prompt' ? 'bridge' : 'wake',
          this.context('traversal', false),
        );
        this.render();
        return;
      }
      case 'bridge_edit':
      case 'bridge_complete':
      case 'creative_edit': {
        const templates = await this.ensureTemplates();
        const snapshot = await this.ensureWorkingSnapshot();
        await this.runtime.openPrivateEditor(
          snapshot,
          this.context('private_editor', false),
          templates.bridgeRoom,
        );
        this.render();
        return;
      }
      case 'awaiting_claim':
        await this.runtime.returnToBrowse(this.context('awaiting_claim', false), this.getTemplateRoomIds());
        this.render();
        await this.resumePendingClaimAfterAuth();
        return;
      case 'completed':
      case 'dismissed':
        return;
    }
  }

  private async handleViewAction(action: TutorialViewAction): Promise<void> {
    switch (action.id) {
      case 'finish_dream':
        await this.beginWakeFlow();
        break;
      case 'edit_room':
        await this.openBridgeEditor();
        break;
      case 'take_room':
      case 'continue_to_claim':
        await this.continueToClaim();
        break;
      case 'make_own_room':
        await this.beginCreativeEdit();
        break;
      case 'restore_bridge':
        await this.restoreBridgeRoom();
        break;
      case 'skip_checklist_item':
        if (action.checklistItem) this.skipChecklistItem(action.checklistItem);
        break;
      case 'retry_claim':
        await this.resumePendingClaimAfterAuth();
        break;
      case 'skip_tutorial':
        await this.dismiss();
        break;
    }
  }

  private async beginWakeFlow(): Promise<void> {
    if (!this.progress || this.progress.stage !== 'dream' && this.progress.stage !== 'wake') return;
    try {
      if (this.progress.stage === 'dream') this.transition('DREAM_FINISHED');
      const templates = await this.ensureTemplates();
      this.progress.workingSnapshot = cloneRoomSnapshot(templates.bridgeRoom);
      this.progress = this.store.save(this.progress);
      const lockedContext = this.context('traversal', true);
      this.persistAndRender(lockedContext);
      await this.runtime.startTraversal(templates, 'wake', lockedContext);
      await this.runtime.playWakeSequence(lockedContext);
      this.transition('WAKE_FINISHED');
      const unlockedContext = this.context('traversal', false);
      this.runtime.setContext(unlockedContext);
      this.persistAndRender(unlockedContext);
    } catch (error) {
      console.error('Failed to start Dream-Builder tutorial', error);
      this.view.setStatus(
        error instanceof Error ? error.message : 'The dream could not load. Try again.',
        true,
      );
    }
  }

  private async openBridgeEditor(): Promise<void> {
    if (!this.progress || this.progress.stage !== 'bridge_prompt') return;
    const templates = await this.ensureTemplates();
    this.transition('OPEN_BRIDGE_EDITOR');
    const workingSnapshot = cloneRoomSnapshot(templates.bridgeRoom);
    this.progress.workingSnapshot = workingSnapshot;
    this.progress = this.store.save(this.progress);
    const context = this.context('private_editor', false);
    await this.runtime.openPrivateEditor(workingSnapshot, context, templates.bridgeRoom);
    this.persistAndRender(context);
  }

  private async beginCreativeEdit(): Promise<void> {
    if (!this.progress || this.progress.stage !== 'bridge_complete') return;
    this.transition('BEGIN_CREATIVE_EDIT');
    const templates = await this.ensureTemplates();
    const workingSnapshot = createDefaultRoomSnapshot(
      TUTORIAL_BRIDGE_ROOM.id,
      TUTORIAL_BRIDGE_ROOM.coordinates,
    );
    this.progress.workingSnapshot = workingSnapshot;
    this.progress.creativeChecklist = evaluateCreativeChecklist(
      workingSnapshot,
      this.progress.creativeChecklist,
    );
    this.progress = this.store.save(this.progress);
    const context = this.context('private_editor', false);
    await this.runtime.openPrivateEditor(workingSnapshot, context, templates.bridgeRoom);
    this.persistAndRender(context);
  }

  private async restoreBridgeRoom(): Promise<void> {
    if (!this.progress || this.progress.stage !== 'creative_edit' || !this.progress.bridgeBackupSnapshot) return;
    const templates = await this.ensureTemplates();
    this.transition('RESTORE_BRIDGE');
    const workingSnapshot = cloneRoomSnapshot(this.progress.bridgeBackupSnapshot);
    this.progress.workingSnapshot = workingSnapshot;
    this.progress = this.store.save(this.progress);
    const context = this.context('private_editor', false);
    await this.runtime.openPrivateEditor(workingSnapshot, context, templates.bridgeRoom);
    this.persistAndRender(context);
  }

  private async continueToClaim(): Promise<void> {
    if (!this.progress || !['bridge_complete', 'creative_edit'].includes(this.progress.stage)) return;
    this.transition('CONTINUE_TO_CLAIM');
    const context = this.context('awaiting_claim', false);
    this.persistAndRender(context);
    await this.runtime.returnToBrowse(context, this.getTemplateRoomIds());
  }

  private skipChecklistItem(item: CreativeChecklistItem): void {
    if (!this.progress || this.progress.stage !== 'creative_edit') return;
    this.progress.creativeChecklist[item] = 'skipped';
    this.persistAndRender(this.context('private_editor', false));
  }

  private handleEditorMutation(detail: TutorialEditorMutationDetail): void {
    if (!this.matchesSession(detail.context) || !this.progress) return;
    if (!['bridge_edit', 'creative_edit', 'bridge_complete'].includes(this.progress.stage)) return;
    this.progress.workingSnapshot = cloneRoomSnapshot(detail.snapshot);
    if (this.progress.stage === 'creative_edit') {
      this.progress.creativeChecklist = evaluateCreativeChecklist(
        detail.snapshot,
        this.progress.creativeChecklist,
      );
    }
    this.persistAndRender(this.context('private_editor', false));
  }

  private handlePlaytestRequested(detail: TutorialPlaytestDetail): void {
    if (!this.matchesSession(detail.context) || !this.progress || this.progress.stage !== 'bridge_edit') return;
    const template = this.templates?.bridgeRoom;
    if (!template || !evaluateBridgeSnapshot(template, detail.snapshot).readyToPlaytest) {
      this.view.setStatus('Add at least three terrain tiles across the water first.', true);
      return;
    }
    this.progress.workingSnapshot = cloneRoomSnapshot(detail.snapshot);
    this.transition('BEGIN_PLAYTEST');
    this.persistAndRender(this.context('private_playtest', false));
  }

  private handlePlaytestCancelled(): void {
    if (!this.progress || this.progress.stage !== 'bridge_playtest') return;
    this.transition('CANCEL_PLAYTEST');
    this.persistAndRender(this.context('private_editor', false));
  }

  private async handleGoalCompleted(detail: TutorialRoomGoalCompletedDetail): Promise<void> {
    if (!this.matchesSession(detail.context) || !this.progress) return;
    if (this.progress.stage === 'room_traversal' && detail.roomId === TUTORIAL_WAKE_ROOM.id) {
      this.view.setStatus('Keep going →');
      return;
    }
    if (this.progress.stage !== 'bridge_playtest' || detail.roomId !== TUTORIAL_BRIDGE_ROOM.id) return;
    this.transition('COMPLETE_PLAYTEST');
    if (this.progress.workingSnapshot) {
      this.progress.bridgeBackupSnapshot = cloneRoomSnapshot(this.progress.workingSnapshot);
    }
    const context = this.context('private_editor', false);
    this.persistAndRender(context);
    this.runtime.setContext(context);
    await this.runtime.returnPlaytestToEditor(context);
    this.render();
  }

  private handleActiveSignChanged(detail: TutorialActiveSignChangedDetail): void {
    if (!this.matchesSession(detail.context) || !this.progress || this.progress.stage !== 'room_traversal') return;
    const sign = detail.sign;
    if (
      sign?.instanceId !== TUTORIAL_BRIDGE_ROOM.sign.instanceId
      || sign.text.trim() !== TUTORIAL_BRIDGE_ROOM.sign.text
      || sign.roomCoordinates.x !== TUTORIAL_BRIDGE_ROOM.coordinates.x
      || sign.roomCoordinates.y !== TUTORIAL_BRIDGE_ROOM.coordinates.y
    ) {
      return;
    }
    this.transition('BRIDGE_SIGN_REACHED');
    this.persistAndRender(this.context('traversal', false));
  }

  private async handleClaimRequested(detail: TutorialClaimRequestedDetail): Promise<void> {
    if (!this.matchesSession(detail.context) || !this.progress || this.progress.stage !== 'awaiting_claim') return;
    this.progress.selectedClaimCoordinates = { ...detail.coordinates };
    this.progress = this.store.save(this.progress);
    if (!this.getAuthState().authenticated) {
      this.showSignIn('Sign in to give this private draft a place in the world.');
      this.view.setStatus('Sign in, then this same room will be checked again.');
      return;
    }
    await this.claimSelectedRoom();
  }

  private async resumePendingClaimAfterAuth(): Promise<void> {
    if (
      !this.progress
      || this.progress.stage !== 'awaiting_claim'
      || !this.progress.selectedClaimCoordinates
      || !this.getAuthState().authenticated
    ) {
      return;
    }
    await this.claimSelectedRoom();
  }

  private async claimSelectedRoom(): Promise<void> {
    if (
      this.claimInFlight
      || !this.progress
      || !this.progress.workingSnapshot
      || !this.progress.selectedClaimCoordinates
    ) {
      return;
    }
    this.claimInFlight = true;
    this.view.setStatus('Checking and claiming this room…');
    try {
      const result = await this.claimService.claim(
        this.progress.workingSnapshot,
        this.progress.selectedClaimCoordinates,
      );
      if (!result.ok) {
        if (result.code === 'auth_required') this.showSignIn(result.message);
        if (result.code === 'stale_frontier' || result.code === 'concurrent_claim') {
          this.progress.selectedClaimCoordinates = null;
          this.progress = this.store.save(this.progress);
          await this.runtime.returnToBrowse(
            this.context('awaiting_claim', false),
            this.getTemplateRoomIds(),
            true,
          );
        }
        this.view.setStatus(result.message, true);
        return;
      }

      this.transition('CLAIM_SUCCEEDED');
      this.progress.workingSnapshot = null;
      this.progress.bridgeBackupSnapshot = null;
      this.progress.selectedClaimCoordinates = null;
      this.progress = this.store.save(this.progress);
      this.syncDocumentState();
      this.render();
      await this.runtime.openClaimedEditor(
        result.record.draft,
        'Now it has a place in the world.',
      );
      this.eventTarget.setTimeout(() => {
        if (this.progress?.stage === 'completed') this.view.hide();
      }, 4200);
    } finally {
      this.claimInFlight = false;
    }
  }

  private async ensureTemplates(): Promise<TutorialTemplates> {
    this.templates ??= await this.templateLoader.load();
    return this.templates;
  }

  private async ensureWorkingSnapshot(): Promise<RoomSnapshot> {
    if (this.progress?.workingSnapshot) return cloneRoomSnapshot(this.progress.workingSnapshot);
    const templates = await this.ensureTemplates();
    if (!this.progress) throw new Error('Tutorial progress is unavailable.');
    const workingSnapshot = cloneRoomSnapshot(templates.bridgeRoom);
    this.progress.workingSnapshot = workingSnapshot;
    this.progress = this.store.save(this.progress);
    return cloneRoomSnapshot(workingSnapshot);
  }

  private transition(event: TutorialTransitionEvent): void {
    if (!this.progress) return;
    this.progress = this.store.save(transitionTutorialProgress(this.progress, event));
  }

  private persistAndRender(context?: TutorialSceneContext): void {
    if (!this.progress) return;
    this.progress = this.store.save(this.progress);
    this.syncDocumentState(context);
    if (context) this.runtime.setContext(context);
    this.render();
  }

  private render(): void {
    if (!this.progress) {
      this.view.hide();
      return;
    }
    const model = buildTutorialCoachmark(this.progress);
    if (model) this.view.render(model);
    else this.view.hide();
  }

  private context(
    mode: TutorialRuntimeMode,
    inputLocked: boolean,
  ): TutorialSceneContext {
    if (!this.progress) throw new Error('Tutorial context requested without progress.');
    return {
      sessionId: this.progress.sessionId,
      stage: this.progress.stage,
      mode,
      private: mode !== 'awaiting_claim',
      inputLocked,
      templateVersions: { ...this.progress.templateVersions },
      checklist: cloneCreativeChecklist(this.progress.creativeChecklist),
    };
  }

  private matchesSession(context: TutorialSceneContext): boolean {
    return Boolean(
      this.progress
      && this.progress.terminalStatus === 'active'
      && context.sessionId === this.progress.sessionId,
    );
  }

  private syncDocumentState(context?: TutorialSceneContext): void {
    const active = this.progress?.terminalStatus === 'active';
    if (!active || !this.progress) {
      delete this.doc.body.dataset.tutorialStage;
      delete this.doc.body.dataset.tutorialInputLocked;
      delete this.doc.body.dataset.tutorialEditor;
      delete this.doc.body.dataset.tutorialPrivate;
      return;
    }
    const resolvedContext = cloneTutorialSceneContext(context);
    this.doc.body.dataset.tutorialStage = this.progress.stage;
    this.doc.body.dataset.tutorialInputLocked = String(resolvedContext?.inputLocked ?? false);
    this.doc.body.dataset.tutorialPrivate = String(
      resolvedContext?.private ?? this.progress.stage !== 'awaiting_claim',
    );
    this.doc.body.dataset.tutorialEditor = String(
      resolvedContext?.mode === 'private_editor',
    );
  }

  private getTemplateRoomIds(): string[] {
    return [TUTORIAL_WAKE_ROOM.id, TUTORIAL_BRIDGE_ROOM.id];
  }
}
