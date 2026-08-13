import Phaser from 'phaser';
import type { RoomCoordinates } from '../../persistence/roomModel';
import type { RoomCommentRecord } from '../../roomComments/model';

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

interface RoomCommentsPlayPresentationControllerOptions {
  scene: Phaser.Scene;
  getRoomOrigin: (coordinates: RoomCoordinates) => { x: number; y: number };
  onDisplayObjectsChanged?: () => void;
}

const COMMENT_PIN_DEPTH = 262;
const COMMENT_PIN_TEXTURE_KEY = 'room_comment_icon';
const COMMENT_PANEL_FILL = 0x050505;
const COMMENT_PANEL_STROKE = 0xffd65a;
const COMMENT_TEXT_COLOR = '#fff3dc';
const COMMENT_MUTED_COLOR = '#d0b98c';
const COMMENT_PANEL_WIDTH = 236;
const COMMENT_PANEL_PADDING = 9;

export class RoomCommentsPlayPresentationController {
  private readonly renderedCommentsById = new Map<string, RenderedRoomComment>();

  constructor(private readonly options: RoomCommentsPlayPresentationControllerOptions) {}

  sync(comments: readonly RoomCommentRecord[]): void {
    const nextIds = new Set<string>();
    let structureChanged = false;

    for (const comment of comments) {
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
      if (nextIds.has(commentId)) continue;
      rendered.container.destroy(true);
      this.renderedCommentsById.delete(commentId);
      structureChanged = true;
    }

    if (structureChanged) this.options.onDisplayObjectsChanged?.();
  }

  reset(): void {
    if (this.renderedCommentsById.size === 0) return;
    for (const rendered of this.renderedCommentsById.values()) {
      rendered.container.destroy(true);
    }
    this.renderedCommentsById.clear();
  }

  getIgnoredObjects(): Phaser.GameObjects.GameObject[] {
    return Array.from(this.renderedCommentsById.values(), ({ container }) => container);
  }

  getRenderedCount(): number {
    return this.renderedCommentsById.size;
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
    const timeText = this.options.scene.add.text(0, 0, comment.createdAt, {
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
      if (!rendered.pinned) this.setPopoverVisible(rendered, false);
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
    const panelHeight = COMMENT_PANEL_PADDING + rendered.authorText.height + 4
      + rendered.bodyText.height + 7 + rendered.timeText.height + COMMENT_PANEL_PADDING;

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
}

function formatCommentTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(date);
}
