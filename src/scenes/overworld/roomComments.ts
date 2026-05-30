import Phaser from 'phaser';
import { getAuthDebugState } from '../../auth/client';
import { playSfx } from '../../audio/sfx';
import { ROOM_PX_HEIGHT, ROOM_PX_WIDTH } from '../../config';
import { ROOM_COMMENT_MAX_LENGTH, type RoomCommentRecord } from '../../roomComments/model';
import { fetchRoomComments, submitRoomComment } from '../../roomComments/client';
import { type RoomCoordinates, type RoomSnapshot } from '../../persistence/roomModel';
import { type WorldRoomSummary, type WorldWindow } from '../../persistence/worldModel';
import {
  getGameSettings,
  subscribeGameSettings,
  updateGameSettings,
  type GameSettings,
} from '../../settings/userSettings';
import type { OverworldMode } from '../sceneData';
import {
  syncBadgePlacements,
  type OverworldBadgePlacement,
  type RoomBadgeScaleConfig,
} from './badgeOverlays';

interface ComposerElements {
  root: HTMLDivElement;
  form: HTMLFormElement;
  input: HTMLTextAreaElement;
  counter: HTMLDivElement;
  cancelButton: HTMLButtonElement;
  submitButton: HTMLButtonElement;
}

interface RenderedRoomComment {
  comment: RoomCommentRecord;
  container: Phaser.GameObjects.Container;
  pin: Phaser.GameObjects.Image;
  panel: Phaser.GameObjects.Graphics;
  authorText: Phaser.GameObjects.Text;
  bodyText: Phaser.GameObjects.Text;
  timeText: Phaser.GameObjects.Text;
  pinned: boolean;
}

interface BrowseCommentTarget {
  signature: string;
  groupKey: string;
  roomId: string;
  version: number;
  coordinates: RoomCoordinates;
  displayCoordinates: RoomCoordinates;
  title: string | null;
}

interface BrowseCommentCacheEntry {
  comments: RoomCommentRecord[];
}

interface RenderedBrowseCommentMarker extends OverworldBadgePlacement {
  key: string;
  target: BrowseCommentTarget;
  comments: RoomCommentRecord[];
  commentSignature: string;
  accentColor: number;
  dotContainer: Phaser.GameObjects.Container;
  compactContainer: Phaser.GameObjects.Container;
  textContainer: Phaser.GameObjects.Container;
  compactCountText: Phaser.GameObjects.Text;
  textPanel: Phaser.GameObjects.Graphics;
  textHeaderText: Phaser.GameObjects.Text;
  textBodyText: Phaser.GameObjects.Text;
  textMetaText: Phaser.GameObjects.Text;
  jiggleOffsetMs: number;
}

interface OverworldRoomCommentsControllerOptions {
  scene: Phaser.Scene;
  getMode: () => OverworldMode;
  getCurrentRoomSnapshot: () => RoomSnapshot | null;
  isCurrentRoomPublished: () => boolean;
  getWorldWindow?: () => WorldWindow | null;
  getSelectedCoordinates?: () => RoomCoordinates;
  getRoomOrigin: (coordinates: RoomSnapshot['coordinates']) => { x: number; y: number };
  getPlayerCommentPosition: () => { x: number; y: number } | null;
  getZoom?: () => number;
  selectRoomCoordinates?: (coordinates: RoomCoordinates) => void;
  showTransientStatus?: (message: string) => void;
  onDisplayObjectsChanged?: () => void;
  document?: Document;
}

const COMMENT_PIN_DEPTH = 262;
const COMMENT_PIN_TEXTURE_KEY = 'room_comment_icon';
const COMMENT_PANEL_FILL = 0x050505;
const COMMENT_PANEL_STROKE = 0xffd65a;
const COMMENT_TEXT_COLOR = '#fff3dc';
const COMMENT_MUTED_COLOR = '#d0b98c';
const COMMENT_PANEL_WIDTH = 236;
const COMMENT_PANEL_PADDING = 9;
const BROWSE_COMMENT_DEPTH = 58;
const BROWSE_COMMENT_HIDE_ZOOM = 0.11;
const BROWSE_COMMENT_FADE_START_ZOOM = 0.145;
const BROWSE_COMMENT_SCALE_FULL_ZOOM = 0.52;
const BROWSE_COMMENT_LAYOUT_FULL_ZOOM = 0.34;
const BROWSE_COMMENT_MIN_SCREEN_SCALE = 0.82;
const BROWSE_COMMENT_MAX_SCREEN_SCALE = 1.38;
const BROWSE_COMMENT_DOT_TIER_MAX_ZOOM = 0.28;
const BROWSE_COMMENT_COMPACT_TIER_MAX_ZOOM = 0.92;
const BROWSE_COMMENT_TIER_FADE_SPAN = 0.04;
const BROWSE_COMMENT_PANEL_WIDTH = 172;
const BROWSE_COMMENT_PANEL_HEIGHT = 72;
const BROWSE_COMMENT_DOT_SIZE = 9;
const BROWSE_COMMENT_COMPACT_WIDTH = 31;
const BROWSE_COMMENT_COMPACT_HEIGHT = 21;
const BROWSE_COMMENT_INK = 0x18161c;
const BROWSE_COMMENT_PANEL_FILL = 0xfff3db;
const BROWSE_COMMENT_PANEL_LIGHT = 0xfffaf0;
const BROWSE_COMMENT_MUTED = '#6d5a34';
const BROWSE_COMMENT_BODY = '#18161c';
const BROWSE_COMMENT_JIGGLE_PERIOD_MS = 5600;
const BROWSE_COMMENT_JIGGLE_DURATION_MS = 460;
const BROWSE_COMMENT_COLORS = [
  0x7de5ff,
  0xffd65a,
  0xff7a7a,
  0x7ee081,
  0xc297ff,
  0xff9f68,
  0x58d39b,
];

export class OverworldRoomCommentsController {
  private readonly browseMarkerScaleConfig: RoomBadgeScaleConfig = {
    hideZoom: BROWSE_COMMENT_HIDE_ZOOM,
    fadeStartZoom: BROWSE_COMMENT_FADE_START_ZOOM,
    scaleFullZoom: BROWSE_COMMENT_SCALE_FULL_ZOOM,
    layoutFullZoom: BROWSE_COMMENT_LAYOUT_FULL_ZOOM,
    minScreenScale: BROWSE_COMMENT_MIN_SCREEN_SCALE,
    maxScreenScale: BROWSE_COMMENT_MAX_SCREEN_SCALE,
    dotTierMaxZoom: BROWSE_COMMENT_DOT_TIER_MAX_ZOOM,
    compactTierMaxZoom: BROWSE_COMMENT_COMPACT_TIER_MAX_ZOOM,
    tierFadeSpan: BROWSE_COMMENT_TIER_FADE_SPAN,
  };
  private composerElements: ComposerElements | null = null;
  private composerOpen = false;
  private submitting = false;
  private comments: RoomCommentRecord[] = [];
  private activeRoomSignature: string | null = null;
  private loadingRoomSignature: string | null = null;
  private commentsVisible = getGameSettings().roomCommentsVisible;
  private unsubscribeSettings: (() => void) | null = null;
  private readonly renderedCommentsById = new Map<string, RenderedRoomComment>();
  private readonly browseCommentCache = new Map<string, BrowseCommentCacheEntry>();
  private readonly browseCommentMarkersByKey = new Map<string, RenderedBrowseCommentMarker>();
  private readonly loadingBrowseRoomSignatures = new Set<string>();
  private readonly failedBrowseRoomSignaturesUntil = new Map<string, number>();
  private hoveredBrowseMarkerKey: string | null = null;
  private pinnedBrowseMarkerKey: string | null = null;

  constructor(private readonly options: OverworldRoomCommentsControllerOptions) {}

  initialize(): void {
    this.ensureComposerDom();
    this.unsubscribeSettings = subscribeGameSettings(this.handleSettingsChanged);
    this.renderComposer();
  }

  reset(): void {
    this.closeComposer(false);
    this.comments = [];
    this.activeRoomSignature = null;
    this.loadingRoomSignature = null;
    this.loadingBrowseRoomSignatures.clear();
    this.failedBrowseRoomSignaturesUntil.clear();
    this.browseCommentCache.clear();
    this.hoveredBrowseMarkerKey = null;
    this.pinnedBrowseMarkerKey = null;
    this.destroyRenderedComments();
    this.destroyBrowseCommentMarkers();
  }

  destroy(): void {
    this.unsubscribeSettings?.();
    this.unsubscribeSettings = null;
    this.reset();
    this.destroyComposerDom();
  }

  update(): void {
    const room = this.getRenderableRoom();
    const nextSignature = room ? this.getRoomSignature(room) : null;
    if (nextSignature !== this.activeRoomSignature) {
      this.activeRoomSignature = nextSignature;
      this.comments = [];
      this.destroyRenderedComments();
      if (room) {
        void this.loadComments(room, this.getRoomSignature(room));
      }
    }

    if (!room) {
      this.closeComposer(false);
    }

    this.syncRenderedComments(room);
    this.syncBrowseCommentMarkers();
    this.renderComposer();
  }

  openComposer(): boolean {
    const room = this.getRenderableRoom();
    if (!room) {
      this.options.showTransientStatus?.('Play a published room to leave a comment.');
      return false;
    }

    const authState = getAuthDebugState();
    if (!authState.authenticated || !authState.user) {
      this.options.showTransientStatus?.('Sign in to comment on rooms.');
      return false;
    }
    if (authState.schoolManaged) {
      this.options.showTransientStatus?.('Classroom accounts cannot comment on rooms.');
      return false;
    }

    this.ensureComposerDom();
    this.composerOpen = true;
    this.renderComposer();
    this.composerElements?.input.focus();
    return true;
  }

  openSelectedBrowseComments(): boolean {
    if (this.options.getMode() !== 'browse') {
      return this.openComposer();
    }

    this.setCommentsVisible(true);
    const selectedCoordinates = this.options.getSelectedCoordinates?.();
    const target = selectedCoordinates ? this.getBrowseCommentTargetForCoordinates(selectedCoordinates) : null;
    if (!target) {
      this.options.showTransientStatus?.('Select a published room to view comments.');
      return false;
    }

    this.pinnedBrowseMarkerKey = target.signature;
    const cached = this.browseCommentCache.get(target.signature);
    if (cached) {
      this.syncBrowseCommentMarkers();
      this.options.showTransientStatus?.(
        cached.comments.length > 0 ? 'Room comments opened.' : 'No comments here yet.',
      );
      return cached.comments.length > 0;
    }

    void this.loadBrowseComments(target, true);
    this.syncBrowseCommentMarkers();
    this.options.showTransientStatus?.('Loading room comments...');
    return true;
  }

  closeComposer(focusCanvas = true): void {
    if (!this.composerOpen) {
      this.renderComposer();
      return;
    }

    this.composerOpen = false;
    this.submitting = false;
    if (this.composerElements) {
      this.composerElements.form.reset();
      this.composerElements.input.blur();
    }
    this.renderComposer();

    if (focusCanvas) {
      this.options.scene.game.canvas.focus();
    }
  }

  isComposerOpen(): boolean {
    return this.composerOpen;
  }

  areCommentsVisible(): boolean {
    return this.commentsVisible;
  }

  setCommentsVisible(visible: boolean): void {
    if (this.commentsVisible === visible) {
      return;
    }

    this.commentsVisible = visible;
    updateGameSettings({ roomCommentsVisible: visible });
    this.syncRenderedComments(this.getRenderableRoom());
    this.syncBrowseCommentMarkers();
    this.renderComposer();
  }

  toggleCommentsVisible(): boolean {
    this.setCommentsVisible(!this.commentsVisible);
    return this.commentsVisible;
  }

  handleEscapeKey(): boolean {
    if (!this.composerOpen) {
      return false;
    }

    this.closeComposer();
    return true;
  }

  refreshAuthState(): void {
    this.renderComposer();
  }

  getBackdropIgnoredObjects(): Phaser.GameObjects.GameObject[] {
    return [
      ...Array.from(this.renderedCommentsById.values(), (rendered) => rendered.container),
      ...Array.from(this.browseCommentMarkersByKey.values(), (rendered) => rendered.container),
    ];
  }

  getDebugSnapshot(): {
    activeRoomSignature: string | null;
    loadingRoomSignature: string | null;
    commentCount: number;
    renderedCommentCount: number;
    commentsVisible: boolean;
    currentRoomPublished: boolean;
    currentRoomSnapshot: {
      roomId: string;
      status: string;
      version: number;
      coordinates: RoomSnapshot['coordinates'];
    } | null;
    composerOpen: boolean;
    submitting: boolean;
    browseMarkerCount: number;
    browseCacheEntryCount: number;
    browseLoadingCount: number;
    pinnedBrowseMarkerKey: string | null;
  } {
    const currentRoom = this.options.getCurrentRoomSnapshot();
    return {
      activeRoomSignature: this.activeRoomSignature,
      loadingRoomSignature: this.loadingRoomSignature,
      commentCount: this.comments.length,
      renderedCommentCount: this.renderedCommentsById.size,
      commentsVisible: this.commentsVisible,
      currentRoomPublished: this.options.isCurrentRoomPublished(),
      currentRoomSnapshot: currentRoom
        ? {
            roomId: currentRoom.id,
            status: currentRoom.status,
            version: currentRoom.version,
            coordinates: { ...currentRoom.coordinates },
          }
        : null,
      composerOpen: this.composerOpen,
      submitting: this.submitting,
      browseMarkerCount: this.browseCommentMarkersByKey.size,
      browseCacheEntryCount: this.browseCommentCache.size,
      browseLoadingCount: this.loadingBrowseRoomSignatures.size,
      pinnedBrowseMarkerKey: this.pinnedBrowseMarkerKey,
    };
  }

  private readonly handleComposerSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    void this.submitComposer();
  };

  private readonly handleComposerInput = () => {
    this.renderCounter();
  };

  private readonly handleComposerKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') {
      return;
    }

    event.preventDefault();
    this.closeComposer();
  };

  private readonly handleComposerCancel = () => {
    this.closeComposer();
  };

  private readonly handleSettingsChanged = (settings: GameSettings): void => {
    if (this.commentsVisible === settings.roomCommentsVisible) {
      return;
    }

    this.commentsVisible = settings.roomCommentsVisible;
    this.syncRenderedComments(this.getRenderableRoom());
    this.syncBrowseCommentMarkers();
    this.renderComposer();
  };

  private async loadComments(room: RoomSnapshot, signature: string): Promise<void> {
    if (this.loadingRoomSignature === signature) {
      return;
    }

    this.loadingRoomSignature = signature;
    try {
      const response = await fetchRoomComments(room.id, room.coordinates, room.version);
      if (this.activeRoomSignature !== signature) {
        return;
      }
      this.comments = response.comments;
      this.syncRenderedComments(room);
    } catch (error) {
      console.warn('Failed to load room comments', error);
    } finally {
      if (this.loadingRoomSignature === signature) {
        this.loadingRoomSignature = null;
      }
    }
  }

  private async loadBrowseComments(
    target: BrowseCommentTarget,
    pinWhenLoaded = false,
  ): Promise<void> {
    if (this.loadingBrowseRoomSignatures.has(target.signature)) {
      return;
    }

    this.loadingBrowseRoomSignatures.add(target.signature);
    try {
      const response = await fetchRoomComments(target.roomId, target.coordinates, target.version);
      const comments = [...response.comments].sort(compareCommentsNewestFirst);
      this.browseCommentCache.set(target.signature, {
        comments,
      });
      this.failedBrowseRoomSignaturesUntil.delete(target.signature);
      if (pinWhenLoaded) {
        this.pinnedBrowseMarkerKey = target.signature;
        this.options.showTransientStatus?.(
          comments.length > 0 ? 'Room comments opened.' : 'No comments here yet.',
        );
      }
      this.syncBrowseCommentMarkers();
    } catch (error) {
      console.warn('Failed to load browse room comments', error);
      this.failedBrowseRoomSignaturesUntil.set(target.signature, Date.now() + 15000);
      if (pinWhenLoaded) {
        this.options.showTransientStatus?.('Could not load comments for this room.');
      }
    } finally {
      this.loadingBrowseRoomSignatures.delete(target.signature);
    }
  }

  private syncBrowseCommentMarkers(): void {
    if (this.options.getMode() !== 'browse' || !this.commentsVisible) {
      this.hoveredBrowseMarkerKey = null;
      this.pinnedBrowseMarkerKey = null;
      this.destroyBrowseCommentMarkers();
      return;
    }

    const targets = this.getBrowseCommentTargets();
    if (targets.length === 0) {
      this.hoveredBrowseMarkerKey = null;
      this.pinnedBrowseMarkerKey = null;
      this.destroyBrowseCommentMarkers();
      return;
    }

    const targetSignatures = new Set<string>();
    const desiredMarkerKeys = new Set<string>();
    let structureChanged = false;
    for (const target of targets) {
      targetSignatures.add(target.signature);
      this.queueBrowseCommentLoad(target);
      const cached = this.browseCommentCache.get(target.signature);
      if (!cached || cached.comments.length === 0) {
        continue;
      }

      desiredMarkerKeys.add(target.signature);
      const origin = this.options.getRoomOrigin(target.displayCoordinates);
      const markerPosition = this.getBrowseMarkerPosition(origin);
      const commentSignature = getCommentsSignature(cached.comments);
      const existing = this.browseCommentMarkersByKey.get(target.signature);
      if (!existing) {
        const marker = this.createBrowseCommentMarker(target, cached.comments, commentSignature);
        marker.zoomedInPosition = markerPosition.zoomedIn;
        marker.zoomedOutPosition = markerPosition.zoomedOut;
        this.browseCommentMarkersByKey.set(target.signature, marker);
        structureChanged = true;
        continue;
      }

      existing.target = target;
      existing.zoomedInPosition = markerPosition.zoomedIn;
      existing.zoomedOutPosition = markerPosition.zoomedOut;
      if (existing.commentSignature !== commentSignature) {
        existing.comments = cached.comments;
        existing.commentSignature = commentSignature;
        this.redrawBrowseCommentMarker(existing);
      }
    }

    for (const [key, marker] of this.browseCommentMarkersByKey.entries()) {
      if (desiredMarkerKeys.has(key)) {
        continue;
      }
      this.destroyBrowseCommentMarker(marker);
      this.browseCommentMarkersByKey.delete(key);
      structureChanged = true;
    }

    if (
      this.pinnedBrowseMarkerKey &&
      !targetSignatures.has(this.pinnedBrowseMarkerKey)
    ) {
      this.pinnedBrowseMarkerKey = null;
    }
    if (
      this.hoveredBrowseMarkerKey &&
      !targetSignatures.has(this.hoveredBrowseMarkerKey)
    ) {
      this.hoveredBrowseMarkerKey = null;
    }

    this.syncBrowseCommentMarkerPresentation();
    if (structureChanged) {
      this.options.onDisplayObjectsChanged?.();
    }
  }

  private queueBrowseCommentLoad(target: BrowseCommentTarget): void {
    if (
      this.browseCommentCache.has(target.signature) ||
      this.loadingBrowseRoomSignatures.has(target.signature)
    ) {
      return;
    }

    const retryAt = this.failedBrowseRoomSignaturesUntil.get(target.signature) ?? 0;
    if (Date.now() < retryAt) {
      return;
    }

    void this.loadBrowseComments(target);
  }

  private getBrowseCommentTargets(): BrowseCommentTarget[] {
    const worldWindow = this.options.getWorldWindow?.();
    if (!worldWindow) {
      return [];
    }

    const selectedCoordinates = this.options.getSelectedCoordinates?.() ?? null;
    const targetsByGroup = new Map<string, WorldRoomSummary>();
    for (const summary of worldWindow.rooms) {
      if (summary.state !== 'published' || summary.version === null) {
        continue;
      }

      const groupKey = this.getBrowseCommentGroupKey(summary);
      const existing = targetsByGroup.get(groupKey);
      if (!existing) {
        targetsByGroup.set(groupKey, summary);
        continue;
      }

      if (
        selectedCoordinates &&
        coordinatesEqual(summary.coordinates, selectedCoordinates) &&
        !coordinatesEqual(existing.coordinates, selectedCoordinates)
      ) {
        targetsByGroup.set(groupKey, summary);
        continue;
      }

      if (compareCoordinates(summary.coordinates, existing.coordinates) < 0) {
        targetsByGroup.set(groupKey, summary);
      }
    }

    return Array.from(targetsByGroup.values(), (summary) => this.createBrowseTarget(summary));
  }

  private getBrowseCommentTargetForCoordinates(
    coordinates: RoomCoordinates,
  ): BrowseCommentTarget | null {
    const worldWindow = this.options.getWorldWindow?.();
    if (!worldWindow) {
      return null;
    }

    const selectedSummary = worldWindow.rooms.find((summary) =>
      coordinatesEqual(summary.coordinates, coordinates)
    );
    if (!selectedSummary || selectedSummary.state !== 'published' || selectedSummary.version === null) {
      return null;
    }

    const groupKey = this.getBrowseCommentGroupKey(selectedSummary);
    const targetSummary =
      this.getBrowseCommentTargets().find((target) => target.groupKey === groupKey)
      ?? this.createBrowseTarget(selectedSummary);
    return targetSummary;
  }

  private createBrowseTarget(summary: WorldRoomSummary): BrowseCommentTarget {
    const groupKey = this.getBrowseCommentGroupKey(summary);
    const version = summary.version ?? 0;
    return {
      signature: `${groupKey}:v${version}`,
      groupKey,
      roomId: summary.id,
      version,
      coordinates: { ...summary.coordinates },
      displayCoordinates: { ...summary.coordinates },
      title: summary.expandedRoom?.title?.trim() || summary.title?.trim() || null,
    };
  }

  private getBrowseCommentGroupKey(summary: WorldRoomSummary): string {
    return summary.expandedRoom?.expandedRoomId ?? summary.id;
  }

  private getBrowseMarkerPosition(origin: { x: number; y: number }): {
    zoomedIn: { x: number; y: number };
    zoomedOut: { x: number; y: number };
  } {
    return {
      zoomedIn: {
        x: origin.x + ROOM_PX_WIDTH * 0.5 - BROWSE_COMMENT_COMPACT_WIDTH * 0.5,
        y: origin.y + ROOM_PX_HEIGHT * 0.3,
      },
      zoomedOut: {
        x: origin.x + ROOM_PX_WIDTH * 0.5 - BROWSE_COMMENT_COMPACT_WIDTH * 0.5,
        y: origin.y + ROOM_PX_HEIGHT * 0.5 - BROWSE_COMMENT_COMPACT_HEIGHT * 0.5,
      },
    };
  }

  private createBrowseCommentMarker(
    target: BrowseCommentTarget,
    comments: RoomCommentRecord[],
    commentSignature: string,
  ): RenderedBrowseCommentMarker {
    const accentColor = getBrowseCommentAccentColor(target.signature);
    const dotContainer = this.createBrowseCommentDot(accentColor);
    const compactContainer = this.createBrowseCommentCompact(accentColor, comments.length);
    const compactCountText = compactContainer.getByName('count') as Phaser.GameObjects.Text;
    const textMarker = this.createBrowseCommentTextMarker(accentColor);
    const container = this.options.scene.add.container(0, 0, [
      dotContainer,
      compactContainer,
      textMarker.container,
    ]);
    container.setDepth(BROWSE_COMMENT_DEPTH);
    container.setSize(BROWSE_COMMENT_COMPACT_WIDTH, BROWSE_COMMENT_COMPACT_HEIGHT);
    container.setInteractive(
      new Phaser.Geom.Rectangle(-7, -7, 45, 35),
      Phaser.Geom.Rectangle.Contains,
    );
    if (container.input) {
      container.input.cursor = 'pointer';
    }

    const marker: RenderedBrowseCommentMarker = {
      key: target.signature,
      target,
      comments,
      commentSignature,
      accentColor,
      container,
      dotContainer,
      compactContainer,
      textContainer: textMarker.container,
      compactCountText,
      textPanel: textMarker.panel,
      textHeaderText: textMarker.headerText,
      textBodyText: textMarker.bodyText,
      textMetaText: textMarker.metaText,
      jiggleOffsetMs: hashStringToPositiveNumber(target.signature) % BROWSE_COMMENT_JIGGLE_PERIOD_MS,
      zoomedInPosition: { x: 0, y: 0 },
      zoomedOutPosition: { x: 0, y: 0 },
      tierDisplays: [
        { tier: 'dot', container: dotContainer, scaleMultiplier: 1 },
        { tier: 'compact', container: compactContainer, scaleMultiplier: 1 },
        { tier: 'text', container: textMarker.container, scaleMultiplier: 1 },
      ],
    };

    this.redrawBrowseCommentMarker(marker);
    container.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, () => {
      this.hoveredBrowseMarkerKey = marker.key;
      this.syncBrowseCommentMarkerPresentation();
    });
    container.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OUT, () => {
      if (this.hoveredBrowseMarkerKey === marker.key) {
        this.hoveredBrowseMarkerKey = null;
        this.syncBrowseCommentMarkerPresentation();
      }
    });
    container.on(
      Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN,
      (
        _pointer: Phaser.Input.Pointer,
        _localX: number,
        _localY: number,
        event: Phaser.Types.Input.EventData,
      ) => {
        event.stopPropagation();
        this.options.selectRoomCoordinates?.(marker.target.displayCoordinates);
        this.pinnedBrowseMarkerKey =
          this.pinnedBrowseMarkerKey === marker.key ? null : marker.key;
        this.syncBrowseCommentMarkerPresentation();
      },
    );

    return marker;
  }

  private createBrowseCommentDot(accentColor: number): Phaser.GameObjects.Container {
    const shadow = this.options.scene.add.rectangle(
      2,
      2,
      BROWSE_COMMENT_DOT_SIZE,
      BROWSE_COMMENT_DOT_SIZE,
      BROWSE_COMMENT_INK,
      0.82,
    );
    shadow.setOrigin(0, 0);
    const dot = this.options.scene.add.rectangle(
      0,
      0,
      BROWSE_COMMENT_DOT_SIZE,
      BROWSE_COMMENT_DOT_SIZE,
      accentColor,
      1,
    );
    dot.setOrigin(0, 0);
    dot.setStrokeStyle(1, BROWSE_COMMENT_INK, 1);
    return this.options.scene.add.container(0, 0, [shadow, dot]);
  }

  private createBrowseCommentCompact(
    accentColor: number,
    count: number,
  ): Phaser.GameObjects.Container {
    const panel = this.options.scene.add.graphics();
    drawBrowseCompactPanel(panel, accentColor);
    const countText = this.options.scene.add.text(0, 0, String(count), {
      fontFamily: 'IBM Plex Mono, Courier New, monospace',
      fontSize: '11px',
      color: '#18161c',
      fontStyle: '700',
      align: 'center',
      fixedWidth: BROWSE_COMMENT_COMPACT_WIDTH,
      fixedHeight: BROWSE_COMMENT_COMPACT_HEIGHT,
    });
    countText.setName('count');
    countText.setPosition(0, 3);
    return this.options.scene.add.container(0, 0, [panel, countText]);
  }

  private createBrowseCommentTextMarker(accentColor: number): {
    container: Phaser.GameObjects.Container;
    panel: Phaser.GameObjects.Graphics;
    headerText: Phaser.GameObjects.Text;
    bodyText: Phaser.GameObjects.Text;
    metaText: Phaser.GameObjects.Text;
  } {
    const panel = this.options.scene.add.graphics();
    const headerText = this.options.scene.add.text(12, 8, '', {
      fontFamily: 'IBM Plex Mono, Courier New, monospace',
      fontSize: '10px',
      color: BROWSE_COMMENT_MUTED,
      fontStyle: '700',
    });
    const bodyText = this.options.scene.add.text(12, 24, '', {
      fontFamily: 'IBM Plex Mono, Courier New, monospace',
      fontSize: '11px',
      color: BROWSE_COMMENT_BODY,
      wordWrap: { width: BROWSE_COMMENT_PANEL_WIDTH - 24 },
      maxLines: 2,
      lineSpacing: 2,
    });
    const metaText = this.options.scene.add.text(12, 56, '', {
      fontFamily: 'IBM Plex Mono, Courier New, monospace',
      fontSize: '9px',
      color: BROWSE_COMMENT_MUTED,
    });
    const container = this.options.scene.add.container(0, 0, [
      panel,
      headerText,
      bodyText,
      metaText,
    ]);
    drawBrowseTextPanel(panel, accentColor);
    return { container, panel, headerText, bodyText, metaText };
  }

  private redrawBrowseCommentMarker(marker: RenderedBrowseCommentMarker): void {
    const latestComment = marker.comments[0];
    const count = marker.comments.length;
    marker.compactCountText.setText(count > 99 ? '99+' : String(count));
    if (!latestComment) {
      marker.textHeaderText.setText('No comments');
      marker.textBodyText.setText('');
      marker.textMetaText.setText(marker.target.title ?? '');
      drawBrowseTextPanel(marker.textPanel, marker.accentColor);
      return;
    }

    marker.textHeaderText.setText(formatCommentCount(count));
    marker.textBodyText.setText(truncateCommentBody(latestComment.body, 82));
    marker.textMetaText.setText(
      `${truncateCommentBody(latestComment.authorDisplayName, 18)} - ${formatCommentTime(latestComment.createdAt)}`,
    );
    drawBrowseTextPanel(marker.textPanel, marker.accentColor);
  }

  private syncBrowseCommentMarkerPresentation(): void {
    const markers = Array.from(this.browseCommentMarkersByKey.values());
    if (markers.length === 0) {
      return;
    }

    const zoom = this.options.getZoom?.() ?? this.options.scene.cameras.main.zoom;
    syncBadgePlacements(markers, zoom, this.browseMarkerScaleConfig);
    const reduceMotion = prefersReducedMotion();
    const now = this.options.scene.time.now;
    for (const marker of markers) {
      const popoverVisible =
        marker.key === this.hoveredBrowseMarkerKey ||
        marker.key === this.pinnedBrowseMarkerKey;
      if (popoverVisible) {
        marker.container.setVisible(true);
        marker.container.setAlpha(1);
        marker.textContainer.setVisible(true);
        marker.textContainer.setAlpha(1);
        marker.compactContainer.setAlpha(0);
        marker.dotContainer.setAlpha(0);
      }

      marker.container.setRotation(
        this.getBrowseMarkerJiggleRotation(marker, zoom, now, reduceMotion, popoverVisible),
      );
    }
  }

  private getBrowseMarkerJiggleRotation(
    marker: RenderedBrowseCommentMarker,
    zoom: number,
    now: number,
    reduceMotion: boolean,
    popoverVisible: boolean,
  ): number {
    if (reduceMotion || popoverVisible || zoom >= BROWSE_COMMENT_COMPACT_TIER_MAX_ZOOM) {
      return 0;
    }

    const localTime =
      (now + marker.jiggleOffsetMs) % BROWSE_COMMENT_JIGGLE_PERIOD_MS;
    if (localTime > BROWSE_COMMENT_JIGGLE_DURATION_MS) {
      return 0;
    }

    const wave = Math.sin((localTime / BROWSE_COMMENT_JIGGLE_DURATION_MS) * Math.PI * 5);
    return wave * 0.085;
  }

  private destroyBrowseCommentMarkers(): void {
    for (const marker of this.browseCommentMarkersByKey.values()) {
      this.destroyBrowseCommentMarker(marker);
    }
    this.browseCommentMarkersByKey.clear();
  }

  private destroyBrowseCommentMarker(marker: RenderedBrowseCommentMarker): void {
    marker.container.destroy(true);
  }

  private async submitComposer(): Promise<void> {
    if (this.submitting || !this.composerElements) {
      return;
    }

    const room = this.getRenderableRoom();
    if (!room) {
      this.options.showTransientStatus?.('Play a published room to leave a comment.');
      return;
    }

    const body = this.composerElements.input.value.replace(/\s+/g, ' ').trim();
    if (!body) {
      this.options.showTransientStatus?.('Type a comment first.');
      return;
    }
    if (body.length > ROOM_COMMENT_MAX_LENGTH) {
      this.options.showTransientStatus?.(`Keep comments under ${ROOM_COMMENT_MAX_LENGTH} characters.`);
      return;
    }

    const position = this.options.getPlayerCommentPosition() ?? {
      x: Math.round(ROOM_PX_WIDTH / 2),
      y: Math.round(ROOM_PX_HEIGHT / 2),
    };

    this.submitting = true;
    this.renderComposer();
    try {
      await submitRoomComment(room.id, room.coordinates, {
        roomVersion: room.version,
        position,
        body,
      });
      playSfx('chat-send');
      this.closeComposer(false);
      this.options.showTransientStatus?.('Comment submitted for review.');
    } catch (error) {
      this.options.showTransientStatus?.(getErrorMessage(error, 'Comment failed to submit.'));
    } finally {
      this.submitting = false;
      this.renderComposer();
    }
  }

  private syncRenderedComments(room: RoomSnapshot | null): void {
    const visibleComments = room && this.commentsVisible ? this.comments : [];
    const nextIds = new Set<string>();
    let structureChanged = false;

    for (const comment of visibleComments) {
      nextIds.add(comment.id);
      const position = this.getCommentWorldPosition(comment);
      const existing = this.renderedCommentsById.get(comment.id);
      if (!existing) {
        const rendered = this.createRenderedComment(comment);
        rendered.container.setPosition(position.x, position.y);
        this.renderedCommentsById.set(comment.id, rendered);
        structureChanged = true;
        continue;
      }

      existing.comment = comment;
      existing.container.setPosition(position.x, position.y);
    }

    for (const [commentId, rendered] of this.renderedCommentsById.entries()) {
      if (nextIds.has(commentId)) {
        continue;
      }

      this.destroyRenderedComment(rendered);
      this.renderedCommentsById.delete(commentId);
      structureChanged = true;
    }

    if (structureChanged) {
      this.options.onDisplayObjectsChanged?.();
    }
  }

  private getCommentWorldPosition(comment: RoomCommentRecord): { x: number; y: number } {
    const origin = this.options.getRoomOrigin(comment.roomCoordinates);
    return {
      x: origin.x + comment.position.x,
      y: origin.y + comment.position.y - 22,
    };
  }

  private createRenderedComment(comment: RoomCommentRecord): RenderedRoomComment {
    const pin = this.options.scene.add.image(0, 0, COMMENT_PIN_TEXTURE_KEY);
    pin.setOrigin(0.5, 0.5);
    pin.setDisplaySize(20, 20);
    const panel = this.options.scene.add.graphics();
    const authorText = this.options.scene.add.text(0, 0, comment.authorDisplayName, {
      fontFamily: 'IBM Plex Mono, Courier New, monospace',
      fontSize: '11px',
      color: COMMENT_MUTED_COLOR,
    });
    const bodyText = this.options.scene.add.text(0, 0, comment.body, {
      fontFamily: 'IBM Plex Mono, Courier New, monospace',
      fontSize: '12px',
      color: COMMENT_TEXT_COLOR,
      wordWrap: { width: COMMENT_PANEL_WIDTH - COMMENT_PANEL_PADDING * 2 },
      lineSpacing: 3,
    });
    const timeText = this.options.scene.add.text(0, 0, formatCommentTime(comment.createdAt), {
      fontFamily: 'IBM Plex Mono, Courier New, monospace',
      fontSize: '10px',
      color: COMMENT_MUTED_COLOR,
    });
    const container = this.options.scene.add.container(0, 0, [
      pin,
      panel,
      authorText,
      bodyText,
      timeText,
    ]);
    container.setDepth(COMMENT_PIN_DEPTH);
    container.setSize(30, 30);
    container.setInteractive(
      new Phaser.Geom.Rectangle(-15, -15, 30, 30),
      Phaser.Geom.Rectangle.Contains,
    );

    const rendered: RenderedRoomComment = {
      comment,
      container,
      pin,
      panel,
      authorText,
      bodyText,
      timeText,
      pinned: false,
    };

    this.redrawRenderedComment(rendered);
    this.setPopoverVisible(rendered, false);

    container.on('pointerover', () => this.setPopoverVisible(rendered, true));
    container.on('pointerout', () => {
      if (!rendered.pinned) {
        this.setPopoverVisible(rendered, false);
      }
    });
    container.on('pointerdown', () => {
      rendered.pinned = !rendered.pinned;
      this.setPopoverVisible(rendered, rendered.pinned);
    });

    return rendered;
  }

  private redrawRenderedComment(rendered: RenderedRoomComment): void {
    rendered.authorText.setText(rendered.comment.authorDisplayName);
    rendered.bodyText.setText(rendered.comment.body);
    rendered.timeText.setText(formatCommentTime(rendered.comment.createdAt));
    const panelX = 16;
    const panelY = -12;
    const authorY = panelY + COMMENT_PANEL_PADDING;
    const bodyY = authorY + rendered.authorText.height + 4;
    const timeY = bodyY + rendered.bodyText.height + 7;
    const panelHeight = COMMENT_PANEL_PADDING + rendered.authorText.height + 4 + rendered.bodyText.height + 7 + rendered.timeText.height + COMMENT_PANEL_PADDING;

    rendered.panel.clear();
    rendered.panel.fillStyle(COMMENT_PANEL_FILL, 0.94);
    rendered.panel.lineStyle(2, COMMENT_PANEL_STROKE, 1);
    rendered.panel.fillRoundedRect(panelX, panelY, COMMENT_PANEL_WIDTH, panelHeight, 6);
    rendered.panel.strokeRoundedRect(panelX, panelY, COMMENT_PANEL_WIDTH, panelHeight, 6);
    rendered.panel.fillStyle(COMMENT_PANEL_FILL, 0.94);
    rendered.panel.fillTriangle(10, 2, panelX + 2, panelY + 14, panelX + 2, panelY + 26);

    rendered.authorText.setPosition(panelX + COMMENT_PANEL_PADDING, authorY);
    rendered.bodyText.setPosition(panelX + COMMENT_PANEL_PADDING, bodyY);
    rendered.timeText.setPosition(panelX + COMMENT_PANEL_PADDING, timeY);
  }

  private setPopoverVisible(rendered: RenderedRoomComment, visible: boolean): void {
    rendered.panel.setVisible(visible);
    rendered.authorText.setVisible(visible);
    rendered.bodyText.setVisible(visible);
    rendered.timeText.setVisible(visible);
  }

  private destroyRenderedComments(): void {
    for (const rendered of this.renderedCommentsById.values()) {
      this.destroyRenderedComment(rendered);
    }
    this.renderedCommentsById.clear();
  }

  private destroyRenderedComment(rendered: RenderedRoomComment): void {
    rendered.container.destroy(true);
  }

  private ensureComposerDom(): void {
    if (this.composerElements) {
      return;
    }

    const doc = this.options.document ?? document;
    const host = this.options.scene.game.canvas.parentElement ?? doc.body;
    const root = doc.createElement('div');
    root.id = 'room-comment-composer';
    root.className = 'room-comment-composer hidden';

    const form = doc.createElement('form');
    form.className = 'room-comment-composer-form';

    const input = doc.createElement('textarea');
    input.id = 'room-comment-input';
    input.className = 'room-comment-input';
    input.maxLength = ROOM_COMMENT_MAX_LENGTH;
    input.placeholder = 'Leave a comment for this room';
    input.rows = 3;
    input.spellcheck = true;

    const footer = doc.createElement('div');
    footer.className = 'room-comment-composer-footer';

    const counter = doc.createElement('div');
    counter.className = 'room-comment-counter';
    counter.textContent = `0/${ROOM_COMMENT_MAX_LENGTH}`;

    const cancelButton = doc.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'bar-btn bar-btn-small room-comment-cancel';
    cancelButton.textContent = 'Cancel';

    const submitButton = doc.createElement('button');
    submitButton.type = 'submit';
    submitButton.className = 'bar-btn bar-btn-small room-comment-submit';
    submitButton.textContent = 'Submit';

    footer.append(counter, cancelButton, submitButton);
    form.append(input, footer);
    root.append(form);
    host.append(root);

    form.addEventListener('submit', this.handleComposerSubmit);
    input.addEventListener('input', this.handleComposerInput);
    input.addEventListener('keydown', this.handleComposerKeydown);
    cancelButton.addEventListener('click', this.handleComposerCancel);

    this.composerElements = {
      root,
      form,
      input,
      counter,
      cancelButton,
      submitButton,
    };
  }

  private destroyComposerDom(): void {
    if (!this.composerElements) {
      return;
    }

    this.composerElements.form.removeEventListener('submit', this.handleComposerSubmit);
    this.composerElements.input.removeEventListener('input', this.handleComposerInput);
    this.composerElements.input.removeEventListener('keydown', this.handleComposerKeydown);
    this.composerElements.cancelButton.removeEventListener('click', this.handleComposerCancel);
    this.composerElements.root.remove();
    this.composerElements = null;
  }

  private renderComposer(): void {
    const elements = this.composerElements;
    if (!elements) {
      return;
    }

    const authState = getAuthDebugState();
    const room = this.getRenderableRoom();
    const open = this.composerOpen && Boolean(room);
    elements.root.classList.toggle('hidden', !open);
    elements.input.disabled = !authState.authenticated || authState.schoolManaged || this.submitting;
    elements.submitButton.disabled = !authState.authenticated || authState.schoolManaged || this.submitting;
    elements.cancelButton.disabled = this.submitting;
    elements.submitButton.textContent = this.submitting ? 'Submitting...' : 'Submit';
    elements.input.placeholder = authState.schoolManaged
      ? 'Classroom comments are disabled'
      : authState.authenticated
      ? 'Leave a comment for this room'
      : 'Sign in to comment on rooms';
    this.renderCounter();
  }

  private renderCounter(): void {
    if (!this.composerElements) {
      return;
    }

    const count = this.composerElements.input.value.length;
    this.composerElements.counter.textContent = `${count}/${ROOM_COMMENT_MAX_LENGTH}`;
  }

  private getRenderableRoom(): RoomSnapshot | null {
    if (this.options.getMode() !== 'play' || !this.options.isCurrentRoomPublished()) {
      return null;
    }

    return this.options.getCurrentRoomSnapshot();
  }

  private getRoomSignature(room: RoomSnapshot): string {
    return `${room.id}:v${room.version}`;
  }
}

function formatCommentTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function formatCommentCount(count: number): string {
  return count === 1 ? '1 comment' : `${count} comments`;
}

function truncateCommentBody(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function compareCommentsNewestFirst(left: RoomCommentRecord, right: RoomCommentRecord): number {
  return getCommentTimeMs(right.createdAt) - getCommentTimeMs(left.createdAt);
}

function getCommentTimeMs(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getCommentsSignature(comments: RoomCommentRecord[]): string {
  return comments.map((comment) => `${comment.id}:${comment.createdAt}`).join('|');
}

function coordinatesEqual(left: RoomCoordinates, right: RoomCoordinates): boolean {
  return left.x === right.x && left.y === right.y;
}

function compareCoordinates(left: RoomCoordinates, right: RoomCoordinates): number {
  if (left.y !== right.y) {
    return left.y - right.y;
  }

  return left.x - right.x;
}

function hashStringToPositiveNumber(value: string): number {
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function getBrowseCommentAccentColor(key: string): number {
  return BROWSE_COMMENT_COLORS[hashStringToPositiveNumber(key) % BROWSE_COMMENT_COLORS.length];
}

function drawBrowseCompactPanel(panel: Phaser.GameObjects.Graphics, accentColor: number): void {
  panel.clear();
  panel.fillStyle(BROWSE_COMMENT_INK, 0.88);
  panel.fillRoundedRect(3, 3, BROWSE_COMMENT_COMPACT_WIDTH, BROWSE_COMMENT_COMPACT_HEIGHT, 5);
  panel.fillStyle(BROWSE_COMMENT_PANEL_FILL, 0.98);
  panel.lineStyle(2, BROWSE_COMMENT_INK, 1);
  panel.fillRoundedRect(0, 0, BROWSE_COMMENT_COMPACT_WIDTH, BROWSE_COMMENT_COMPACT_HEIGHT, 5);
  panel.strokeRoundedRect(0, 0, BROWSE_COMMENT_COMPACT_WIDTH, BROWSE_COMMENT_COMPACT_HEIGHT, 5);
  panel.fillStyle(accentColor, 1);
  panel.fillRoundedRect(2, 2, 7, BROWSE_COMMENT_COMPACT_HEIGHT - 4, 3);
}

function drawBrowseTextPanel(panel: Phaser.GameObjects.Graphics, accentColor: number): void {
  panel.clear();
  panel.fillStyle(BROWSE_COMMENT_INK, 0.88);
  panel.fillRoundedRect(
    4,
    4,
    BROWSE_COMMENT_PANEL_WIDTH,
    BROWSE_COMMENT_PANEL_HEIGHT,
    6,
  );
  panel.fillStyle(BROWSE_COMMENT_PANEL_FILL, 0.99);
  panel.lineStyle(2, BROWSE_COMMENT_INK, 1);
  panel.fillRoundedRect(
    0,
    0,
    BROWSE_COMMENT_PANEL_WIDTH,
    BROWSE_COMMENT_PANEL_HEIGHT,
    6,
  );
  panel.strokeRoundedRect(
    0,
    0,
    BROWSE_COMMENT_PANEL_WIDTH,
    BROWSE_COMMENT_PANEL_HEIGHT,
    6,
  );
  panel.fillStyle(accentColor, 1);
  panel.fillRoundedRect(3, 3, 5, BROWSE_COMMENT_PANEL_HEIGHT - 6, 3);
  panel.fillStyle(BROWSE_COMMENT_PANEL_LIGHT, 0.92);
  panel.fillRoundedRect(10, 20, BROWSE_COMMENT_PANEL_WIDTH - 18, 28, 4);
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }

  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
