import type Phaser from 'phaser';
import type { RoomSnapshot } from '../persistence/roomModel';
import {
  getOverworldScene,
  type OverworldSceneBridge,
} from '../ui/setup/sceneBridge';
import type { TutorialSceneContext } from './model';
import type { TutorialTemplates } from './templateLoader';

export interface TutorialRuntimeGateway {
  startTraversal(
    templates: TutorialTemplates,
    focus: 'wake' | 'bridge',
    context: TutorialSceneContext,
  ): Promise<void>;
  playWakeSequence(context: TutorialSceneContext): Promise<void>;
  openPrivateEditor(
    snapshot: RoomSnapshot,
    context: TutorialSceneContext,
    templateSnapshot: RoomSnapshot,
  ): Promise<void>;
  setContext(context: TutorialSceneContext | null): void;
  returnPlaytestToEditor(context: TutorialSceneContext): Promise<void>;
  returnToBrowse(
    context: TutorialSceneContext | null,
    clearDraftRoomIds: string[],
    forceRefreshAround?: boolean,
  ): Promise<void>;
  openClaimedEditor(snapshot: RoomSnapshot, statusMessage: string): Promise<void>;
}

export class PhaserTutorialRuntimeGateway implements TutorialRuntimeGateway {
  constructor(private readonly game: Phaser.Game) {}

  async startTraversal(
    templates: TutorialTemplates,
    focus: 'wake' | 'bridge',
    context: TutorialSceneContext,
  ): Promise<void> {
    await this.requireMethod('startTutorialTraversal')({ templates, focus, context });
  }

  async playWakeSequence(context: TutorialSceneContext): Promise<void> {
    await this.requireMethod('playTutorialWakeSequence')(context);
  }

  async openPrivateEditor(
    snapshot: RoomSnapshot,
    context: TutorialSceneContext,
    templateSnapshot: RoomSnapshot,
  ): Promise<void> {
    await this.requireMethod('openTutorialEditor')(snapshot, context, templateSnapshot);
  }

  setContext(context: TutorialSceneContext | null): void {
    this.requireMethod('setTutorialContext')(context);
  }

  async returnPlaytestToEditor(context: TutorialSceneContext): Promise<void> {
    await this.requireMethod('returnTutorialPlaytestToEditor')(context);
  }

  async returnToBrowse(
    context: TutorialSceneContext | null,
    clearDraftRoomIds: string[],
    forceRefreshAround = false,
  ): Promise<void> {
    await this.requireMethod('returnTutorialToBrowse')(
      context,
      clearDraftRoomIds,
      forceRefreshAround,
    );
  }

  async openClaimedEditor(snapshot: RoomSnapshot, statusMessage: string): Promise<void> {
    await this.requireMethod('openTutorialClaimedEditor')(snapshot, statusMessage);
  }

  private requireMethod<Key extends keyof OverworldSceneBridge>(
    key: Key,
  ): NonNullable<OverworldSceneBridge[Key]> {
    const scene = getOverworldScene(this.game);
    const method = scene?.[key];
    if (typeof method !== 'function') {
      throw new Error(`Tutorial runtime is not ready (${String(key)}).`);
    }
    return method.bind(scene) as NonNullable<OverworldSceneBridge[Key]>;
  }
}
