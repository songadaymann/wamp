import Phaser from 'phaser';
import { getAuthDebugState } from '../../auth/client';
import { playSfx } from '../../audio/sfx';
import {
  ROOM_CHAT_BUBBLE_MAX_WIDTH,
  ROOM_CHAT_MESSAGE_MAX_LENGTH,
  type RoomChatMessageRecord,
} from '../../chat/roomChatModel';
import { roomIdFromCoordinates, type RoomCoordinates } from '../../persistence/roomModel';
import { type WorldChunkBounds } from '../../persistence/worldModel';
import {
  WorldRoomChatClient,
  type WorldRoomChatSnapshot,
} from '../../presence/roomChat';
import {
  resolveWorldPresenceConfig,
  resolveWorldPresenceIdentity,
  type WorldPresenceIdentity,
  type WorldPresencePayload,
} from '../../presence/worldPresence';
import type { OverworldMode } from '../sceneData';
import type { RenderedGhost } from './presence';

interface ComposerElements {
  root: HTMLDivElement;
  form: HTMLFormElement;
  input: HTMLInputElement;
  sendButton: HTMLButtonElement;
}

interface RenderedRoomChatBubble {
  userId: string;
  message: RoomChatMessageRecord;
  container: Phaser.GameObjects.Container;
  background: Phaser.GameObjects.Graphics;
  text: Phaser.GameObjects.Text;
}

interface LocalPresenceInput {
  mode: OverworldMode;
  roomCoordinates: RoomCoordinates;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  facing: number;
  animationState: WorldPresencePayload['animationState'];
}

interface OverworldRoomChatControllerOptions {
  scene: Phaser.Scene;
  getMode: () => OverworldMode;
  getCurrentRoomCoordinates: () => RoomCoordinates;
  getPlayerAnchor: () => { x: number; y: number } | null;
  getRenderedGhostsByConnectionId: () => Map<string, RenderedGhost>;
  showTransientStatus?: (message: string) => void;
  onDisplayObjectsChanged?: () => void;
  document?: Document;
}

const SUBSCRIPTION_RETAIN_MS = 1_200;
const BUBBLE_STROKE_COLOR = 0xe7c977;
const BUBBLE_FILL_COLOR = 0x050505;
const BUBBLE_TEXT_COLOR = '#f7edd8';

export class OverworldRoomChatController {
  private client: WorldRoomChatClient | null = null;
  private identity: WorldPresenceIdentity | null = null;
  private snapshot: WorldRoomChatSnapshot | null = null;
  private composerElements: ComposerElements | null = null;
  private composerOpen = false;
  private readonly renderedBubblesByUserId = new Map<string, RenderedRoomChatBubble>();
  private subscribedChunkBounds: WorldChunkBounds | null = null;
  private subscribedBoundsRetainUntil = 0;
  private lastLatestMessageId: string | null = null;

  constructor(private readonly options: OverworldRoomChatControllerOptions) {}

  initialize(): void {
    this.ensureComposerDom();

    const config = resolveWorldPresenceConfig();
    if (!config) {
      this.identity = null;
      this.snapshot = this.createDisabledSnapshot();
      this.renderComposer();
      return;
    }

    this.identity = resolveWorldPresenceIdentity();
    this.client = new WorldRoomChatClient({
      ...config,
      identity: this.identity,
      onSnapshot: (snapshot) => {
        const previousLatestId = this.lastLatestMessageId;
        this.snapshot = snapshot;
        this.lastLatestMessageId = snapshot.latestMessage?.id ?? null;
        if (
          snapshot.latestMessage &&
          snapshot.latestMessage.id !== previousLatestId &&
          snapshot.latestMessage.userId !== this.identity?.userId
        ) {
          playSfx('chat-receive');
        }
        this.syncRenderedBubbles();
        this.renderComposer();
      },
    });

    this.renderComposer();
  }

  refreshIdentity(): boolean {
    const config = resolveWorldPresenceConfig();
    const nextIdentity = config ? resolveWorldPresenceIdentity() : null;
    const currentIdentity = this.identity;
    const existingBounds = this.subscribedChunkBounds ? { ...this.subscribedChunkBounds } : null;

    if (!config) {
      if (!this.client && !currentIdentity) {
        return false;
      }

      this.destroyClientState();
      this.identity = null;
      this.snapshot = this.createDisabledSnapshot();
      this.renderComposer();
      return true;
    }

    if (
      currentIdentity &&
      nextIdentity &&
      currentIdentity.userId === nextIdentity.userId &&
      currentIdentity.displayName === nextIdentity.displayName &&
      currentIdentity.avatarId === nextIdentity.avatarId
    ) {
      return false;
    }

    this.destroyClientState();
    this.initialize();
    if (existingBounds) {
      this.setSubscribedChunkBounds(existingBounds);
    }
    return true;
  }

  reset(): void {
    this.destroy();
    this.identity = null;
    this.snapshot = null;
    this.subscribedChunkBounds = null;
    this.subscribedBoundsRetainUntil = 0;
    this.lastLatestMessageId = null;
  }

  destroy(): void {
    this.destroyClientState();
    this.destroyComposerDom();
    this.identity = null;
    this.snapshot = null;
    this.subscribedChunkBounds = null;
    this.subscribedBoundsRetainUntil = 0;
    this.lastLatestMessageId = null;
  }

  setSubscribedChunkBounds(bounds: WorldChunkBounds | null): void {
    if (!this.client || !bounds) {
      return;
    }

    if (this.subscribedChunkBounds && this.areChunkBoundsEqual(this.subscribedChunkBounds, bounds)) {
      return;
    }

    const now = Date.now();
    if (
      this.subscribedChunkBounds &&
      this.containsChunkBounds(this.subscribedChunkBounds, bounds) &&
      now < this.subscribedBoundsRetainUntil
    ) {
      return;
    }

    const chunks = [];
    for (let chunkY = bounds.minChunkY; chunkY <= bounds.maxChunkY; chunkY += 1) {
      for (let chunkX = bounds.minChunkX; chunkX <= bounds.maxChunkX; chunkX += 1) {
        chunks.push({ x: chunkX, y: chunkY });
      }
    }

    this.client.setSubscribedShards(chunks);
    this.subscribedChunkBounds = { ...bounds };
    this.subscribedBoundsRetainUntil = now + SUBSCRIPTION_RETAIN_MS;
  }

  updateLocalPresence(input: LocalPresenceInput | null): void {
    if (!this.client || !input || input.mode !== 'play') {
      this.client?.updateLocalPresence(null);
      this.closeComposer(false);
      return;
    }

    this.client.updateLocalPresence({
      roomCoordinates: { ...input.roomCoordinates },
      x: input.x,
      y: input.y,
      velocityX: input.velocityX,
      velocityY: input.velocityY,
      facing: input.facing,
      animationState: input.animationState,
      mode: 'play',
      timestamp: Date.now(),
    });
  }

  update(): void {
    this.client?.tick();
    this.syncRenderedBubbles();
  }

  openComposer(): boolean {
    if (this.options.getMode() !== 'play') {
      return false;
    }

    const authState = getAuthDebugState();
    if (!authState.authenticated || !authState.user) {
      this.options.showTransientStatus?.('Sign in to chat in-room.');
      return false;
    }

    if (!this.client || !this.snapshot?.enabled) {
      this.options.showTransientStatus?.('Room chat is unavailable right now.');
      return false;
    }

    this.ensureComposerDom();
    this.composerOpen = true;
    this.renderComposer();
    this.composerElements?.input.focus();
    this.composerElements?.input.select();
    return true;
  }

  closeComposer(focusCanvas = true): void {
    if (!this.composerOpen) {
      this.renderComposer();
      return;
    }

    this.composerOpen = false;
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

  handleEscapeKey(): boolean {
    if (!this.composerOpen) {
      return false;
    }

    this.closeComposer();
    return true;
  }

  getBackdropIgnoredObjects(): Phaser.GameObjects.GameObject[] {
    return Array.from(this.renderedBubblesByUserId.values(), (bubble) => bubble.container);
  }

  getDebugSnapshot(): {
    identity: WorldPresenceIdentity | null;
    snapshot: WorldRoomChatSnapshot | null;
    composerOpen: boolean;
    subscribedChunkBounds: WorldChunkBounds | null;
    activeBubbleCount: number;
    latestMessage: RoomChatMessageRecord | null;
  } {
    return {
      identity: this.identity,
      snapshot: this.snapshot,
      composerOpen: this.composerOpen,
      subscribedChunkBounds: this.subscribedChunkBounds ? { ...this.subscribedChunkBounds } : null,
      activeBubbleCount: this.renderedBubblesByUserId.size,
      latestMessage: this.snapshot?.latestMessage ?? null,
    };
  }

  private readonly handleComposerSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    void this.submitComposerMessage();
  };

  private readonly handleComposerInputKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') {
      return;
    }

    event.preventDefault();
    this.closeComposer();
  };

  private async submitComposerMessage(): Promise<void> {
    const input = this.composerElements?.input ?? null;
    if (!input) {
      return;
    }

    const result = this.client?.send(input.value) ?? { ok: false as const, reason: 'connecting' as const };
    if (!result.ok) {
      this.options.showTransientStatus?.(this.getSendFailureMessage(result.reason));
      this.renderComposer();
      return;
    }

    playSfx('chat-send');
    this.closeComposer(false);
  }

  private getSendFailureMessage(
    reason: 'unauthenticated' | 'not-playing' | 'connecting' | 'empty' | 'too-long' | 'rate-limited'
  ): string {
    switch (reason) {
      case 'unauthenticated':
        return 'Sign in to chat in-room.';
      case 'not-playing':
        return 'Room chat only works while playing.';
      case 'connecting':
        return 'Room chat is still syncing.';
      case 'empty':
        return 'Type a message first.';
      case 'too-long':
        return `Keep room chat under ${ROOM_CHAT_MESSAGE_MAX_LENGTH} characters.`;
      case 'rate-limited':
        return 'Room chat is limited to one message per second.';
      default:
        return 'Room chat failed to send.';
    }
  }

  private ensureComposerDom(): void {
    if (this.composerElements) {
      return;
    }

    const doc = this.options.document ?? document;
    const host = this.options.scene.game.canvas.parentElement ?? doc.body;
    const root = doc.createElement('div');
    root.id = 'room-chat-composer';
    root.className = 'room-chat-composer hidden';

    const form = doc.createElement('form');
    form.className = 'room-chat-composer-form';

    const input = doc.createElement('input');
    input.id = 'room-chat-input';
    input.className = 'room-chat-input';
    input.type = 'text';
    input.maxLength = ROOM_CHAT_MESSAGE_MAX_LENGTH;
    input.placeholder = 'Say something in this room';
    input.spellcheck = true;
    input.autocomplete = 'off';

    const sendButton = doc.createElement('button');
    sendButton.id = 'btn-room-chat-send';
    sendButton.className = 'bar-btn bar-btn-small room-chat-send';
    sendButton.type = 'submit';
    sendButton.textContent = 'Say';

    form.append(input, sendButton);
    root.append(form);
    host.append(root);

    form.addEventListener('submit', this.handleComposerSubmit);
    input.addEventListener('keydown', this.handleComposerInputKeydown);

    this.composerElements = {
      root,
      form,
      input,
      sendButton,
    };
  }

  private destroyComposerDom(): void {
    if (!this.composerElements) {
      return;
    }

    this.composerElements.form.removeEventListener('submit', this.handleComposerSubmit);
    this.composerElements.input.removeEventListener('keydown', this.handleComposerInputKeydown);
    this.composerElements.root.remove();
    this.composerElements = null;
  }

  private renderComposer(): void {
    const elements = this.composerElements;
    if (!elements) {
      return;
    }

    const authenticated = Boolean(getAuthDebugState().authenticated);
    const open = this.composerOpen && this.options.getMode() === 'play';
    elements.root.classList.toggle('hidden', !open);
    elements.input.disabled = !authenticated;
    elements.sendButton.disabled = !authenticated;
    elements.input.placeholder = authenticated
      ? 'Say something in this room'
      : 'Sign in to chat in-room';
  }

  private destroyClientState(): void {
    this.closeComposer(false);
    this.client?.destroy();
    this.client = null;
    this.destroyRenderedBubbles();
  }

  private syncRenderedBubbles(): void {
    const currentRoomId = roomIdFromCoordinates(this.options.getCurrentRoomCoordinates());
    const shouldRender = this.options.getMode() === 'play';
    const nextMessages = shouldRender
      ? (this.snapshot?.messages ?? []).filter((message) => message.roomId === currentRoomId)
      : [];
    const nextUserIds = new Set<string>();
    let structureChanged = false;

    for (const message of nextMessages) {
      const anchor = this.resolveBubbleAnchor(message);
      if (!anchor) {
        continue;
      }

      nextUserIds.add(message.userId);
      const existing = this.renderedBubblesByUserId.get(message.userId);
      if (!existing) {
        const bubble = this.createRenderedBubble(message);
        bubble.container.setPosition(anchor.x, anchor.y);
        this.renderedBubblesByUserId.set(message.userId, bubble);
        structureChanged = true;
        continue;
      }

      if (existing.message.id !== message.id || existing.message.text !== message.text) {
        existing.message = message;
        this.redrawBubble(existing);
      } else {
        existing.message = message;
      }
      existing.container.setPosition(anchor.x, anchor.y);
      existing.container.setVisible(true);
    }

    for (const [userId, bubble] of this.renderedBubblesByUserId.entries()) {
      if (nextUserIds.has(userId)) {
        continue;
      }

      this.destroyRenderedBubble(bubble);
      this.renderedBubblesByUserId.delete(userId);
      structureChanged = true;
    }

    if (structureChanged) {
      this.options.onDisplayObjectsChanged?.();
    }
  }

  private resolveBubbleAnchor(message: RoomChatMessageRecord): { x: number; y: number } | null {
    if (
      this.identity &&
      message.userId === this.identity.userId
    ) {
      const playerAnchor = this.options.getPlayerAnchor();
      if (!playerAnchor) {
        return null;
      }

      return {
        x: playerAnchor.x,
        y: playerAnchor.y - 40,
      };
    }

    for (const ghost of this.options.getRenderedGhostsByConnectionId().values()) {
      if (
        ghost.presence.userId !== message.userId ||
        ghost.presence.roomId !== message.roomId ||
        !ghost.sprite.visible
      ) {
        continue;
      }

      return {
        x: ghost.sprite.x,
        y: ghost.sprite.y - 40,
      };
    }

    return null;
  }

  private createRenderedBubble(message: RoomChatMessageRecord): RenderedRoomChatBubble {
    const background = this.options.scene.add.graphics();
    const text = this.options.scene.add.text(0, 0, message.text, {
      fontFamily: 'IBM Plex Mono, Courier New, monospace',
      fontSize: '12px',
      color: BUBBLE_TEXT_COLOR,
      align: 'center',
      wordWrap: {
        width: ROOM_CHAT_BUBBLE_MAX_WIDTH - 20,
        useAdvancedWrap: true,
      },
    });
    text.setOrigin(0.5, 0.5);
    text.setLineSpacing(2);

    const container = this.options.scene.add.container(0, 0, [background, text]);
    container.setDepth(27);

    const bubble: RenderedRoomChatBubble = {
      userId: message.userId,
      message,
      container,
      background,
      text,
    };

    this.redrawBubble(bubble);
    return bubble;
  }

  private redrawBubble(bubble: RenderedRoomChatBubble): void {
    bubble.text.setText(bubble.message.text);

    const paddingX = 10;
    const paddingY = 6;
    const tailHeight = 8;
    const radius = 9;
    const width = Math.min(
      ROOM_CHAT_BUBBLE_MAX_WIDTH,
      Math.max(42, Math.ceil(bubble.text.width + paddingX * 2))
    );
    const height = Math.max(24, Math.ceil(bubble.text.height + paddingY * 2));
    const rectLeft = -width / 2;
    const rectTop = -(height + tailHeight + 4);

    bubble.background.clear();
    bubble.background.fillStyle(BUBBLE_FILL_COLOR, 0.9);
    bubble.background.lineStyle(1, BUBBLE_STROKE_COLOR, 0.72);
    bubble.background.fillRoundedRect(rectLeft, rectTop, width, height, radius);
    bubble.background.strokeRoundedRect(rectLeft, rectTop, width, height, radius);
    bubble.background.fillTriangle(-7, -tailHeight - 2, 7, -tailHeight - 2, 0, 0);
    bubble.background.strokeTriangle(-7, -tailHeight - 2, 7, -tailHeight - 2, 0, 0);

    bubble.text.setPosition(0, rectTop + height / 2);
  }

  private destroyRenderedBubbles(): void {
    if (this.renderedBubblesByUserId.size === 0) {
      return;
    }

    for (const bubble of this.renderedBubblesByUserId.values()) {
      this.destroyRenderedBubble(bubble);
    }
    this.renderedBubblesByUserId.clear();
    this.options.onDisplayObjectsChanged?.();
  }

  private destroyRenderedBubble(bubble: RenderedRoomChatBubble): void {
    bubble.background.destroy();
    bubble.text.destroy();
    bubble.container.destroy();
  }

  private createDisabledSnapshot(): WorldRoomChatSnapshot {
    return {
      enabled: false,
      status: 'disabled',
      subscribedShards: [],
      connectedShards: [],
      publishedShard: null,
      messages: [],
      latestMessage: null,
    };
  }

  private areChunkBoundsEqual(left: WorldChunkBounds, right: WorldChunkBounds): boolean {
    return (
      left.minChunkX === right.minChunkX &&
      left.maxChunkX === right.maxChunkX &&
      left.minChunkY === right.minChunkY &&
      left.maxChunkY === right.maxChunkY
    );
  }

  private containsChunkBounds(container: WorldChunkBounds, inner: WorldChunkBounds): boolean {
    return (
      container.minChunkX <= inner.minChunkX &&
      container.maxChunkX >= inner.maxChunkX &&
      container.minChunkY <= inner.minChunkY &&
      container.maxChunkY >= inner.maxChunkY
    );
  }
}
