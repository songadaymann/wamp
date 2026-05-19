import Phaser from 'phaser';
import { getAuthDebugState } from '../../auth/client';
import { playSfx } from '../../audio/sfx';
import { ROOM_PX_HEIGHT, ROOM_PX_WIDTH } from '../../config';
import { ROOM_COMMENT_MAX_LENGTH, type RoomCommentRecord } from '../../roomComments/model';
import { fetchRoomComments, submitRoomComment } from '../../roomComments/client';
import { type RoomSnapshot } from '../../persistence/roomModel';
import {
  getGameSettings,
  subscribeGameSettings,
  updateGameSettings,
  type GameSettings,
} from '../../settings/userSettings';
import type { OverworldMode } from '../sceneData';

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

interface OverworldRoomCommentsControllerOptions {
  scene: Phaser.Scene;
  getMode: () => OverworldMode;
  getCurrentRoomSnapshot: () => RoomSnapshot | null;
  isCurrentRoomPublished: () => boolean;
  getRoomOrigin: (coordinates: RoomSnapshot['coordinates']) => { x: number; y: number };
  getPlayerCommentPosition: () => { x: number; y: number } | null;
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

export class OverworldRoomCommentsController {
  private composerElements: ComposerElements | null = null;
  private composerOpen = false;
  private submitting = false;
  private comments: RoomCommentRecord[] = [];
  private activeRoomSignature: string | null = null;
  private loadingRoomSignature: string | null = null;
  private commentsVisible = getGameSettings().roomCommentsVisible;
  private unsubscribeSettings: (() => void) | null = null;
  private readonly renderedCommentsById = new Map<string, RenderedRoomComment>();

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
    this.destroyRenderedComments();
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
    return Array.from(this.renderedCommentsById.values(), (rendered) => rendered.container);
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

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
