import Phaser from 'phaser';
import { type CourseGoalType } from '../../courses/model';
import { ROOM_PX_HEIGHT, ROOM_PX_WIDTH } from '../../config';
import {
  ROOM_GOAL_LABELS,
  type RoomGoalType,
} from '../../goals/roomGoals';
import { type RoomCoordinates } from '../../persistence/roomModel';
import { type WorldRoomSummary, type WorldWindow } from '../../persistence/worldModel';
import { RETRO_COLORS } from '../../visuals/starfield';
import {
  syncBadgePlacements,
  type OverworldBadgePlacement,
  type OverworldBadgeTierDisplay,
  type RoomBadgeScaleConfig,
} from './badgeOverlays';
import { type SelectedCellState } from './hudViewModel';
import { type OverworldMode } from '../sceneData';

const ROOM_BADGE_FADE_START_ZOOM = 0.14;
const ROOM_BADGE_HIDE_ZOOM = 0.11;
const ROOM_BADGE_SCALE_FULL_ZOOM = 0.5;
const ROOM_BADGE_LAYOUT_FULL_ZOOM = 0.32;
const ROOM_BADGE_MIN_SCREEN_SCALE = 0.72;
const ROOM_BADGE_MAX_SCREEN_SCALE = 1.45;
const ROOM_BADGE_DOT_TIER_MAX_ZOOM = 0.22;
const ROOM_BADGE_COMPACT_TIER_MAX_ZOOM = 0.95;
const ROOM_BADGE_TIER_FADE_SPAN = 0.032;
const ROOM_BADGE_TEXT_MIN_WIDTH = 98;
const ROOM_BADGE_TEXT_MAX_WIDTH = Math.round(
  (ROOM_PX_WIDTH * ROOM_BADGE_SCALE_FULL_ZOOM * 0.88) / ROOM_BADGE_MAX_SCREEN_SCALE,
);
const ROOM_BADGE_CORNER_INSET_X = 10;
const ROOM_BADGE_CORNER_INSET_Y = 8;
const ROOM_BADGE_CHIP_WIDTH = 22;
const ROOM_BADGE_CHIP_HEIGHT = 12;
const ROOM_BADGE_DOT_SIZE = 6;
const ROOM_BADGE_SEMANTIC_COLORS: Record<RoomGoalType, number> = {
  reach_exit: 0x6dd3ff,
  checkpoint_sprint: 0xffd166,
  collect_target: 0x7ee081,
  collect_race: 0x58d39b,
  defeat_all: 0xff7a7a,
  survival: 0xc297ff,
};
const ROOM_BADGE_SEMANTIC_CODES: Record<RoomGoalType, string> = {
  reach_exit: 'EX',
  checkpoint_sprint: 'CP',
  collect_target: 'CL',
  collect_race: 'RC',
  defeat_all: 'KO',
  survival: 'SV',
};
const SELECTED_ROOM_PLAY_BUTTON_RADIUS = 10;
const SELECTED_ROOM_PLAY_BUTTON_HIT_RADIUS = SELECTED_ROOM_PLAY_BUTTON_RADIUS + 4;
const SELECTED_ROOM_PLAY_BUTTON_SCALE_FACTOR = 0.9;
const SELECTED_ROOM_PLAY_BUTTON_MIN_SCALE = 1;
const SELECTED_ROOM_PLAY_BUTTON_MAX_SCALE = 8;
const SELECTED_ROOM_WARP_BUTTON_WIDTH = 144;
const SELECTED_ROOM_WARP_BUTTON_HEIGHT = 44;
const SELECTED_ROOM_WARP_BUTTON_SCALE_FACTOR = 0.62;
const SELECTED_ROOM_WARP_BUTTON_MIN_SCALE = 0.65;
const SELECTED_ROOM_WARP_BUTTON_MAX_SCALE = 2.8;
const MIN_ZOOM = 0.08;

type RoomActivityBadge = OverworldBadgePlacement;
type ExpandedRoomBadge = OverworldBadgePlacement;
type SemanticBadgeOwner = 'goal' | 'expanded-room';

interface SemanticRoomBadgeDescriptor {
  owner: SemanticBadgeOwner;
  title: string;
  typeLabel: string;
  compactCode: string;
  color: number;
  coordinates: RoomCoordinates;
}

interface SelectedRoomPlayAffordance {
  container: Phaser.GameObjects.Container;
  background: Phaser.GameObjects.Arc;
  icon: Phaser.GameObjects.Graphics;
  warpBackground: Phaser.GameObjects.Rectangle;
  warpLabel: Phaser.GameObjects.Text;
}

interface OverworldBrowseOverlayControllerHost {
  scene: Phaser.Scene;
  getWorldWindow(): WorldWindow | null;
  getMode(): OverworldMode;
  getSelectedCoordinates(): RoomCoordinates;
  getZoom(): number;
  getRoomOrigin(coordinates: RoomCoordinates): { x: number; y: number };
  getCellStateAt(coordinates: RoomCoordinates): SelectedCellState;
  getRoomSummaryForCoordinates(coordinates: RoomCoordinates): WorldRoomSummary | null;
  getRoomEditorCount(coordinates: RoomCoordinates): number;
  isWithinLoadedRoomBounds(coordinates: RoomCoordinates): boolean;
  canWarpToSelectedRoom(): boolean;
  playSelectedRoom(): void;
  warpToSelectedRoom(): void;
  truncateOverlayText(value: string, maxLength: number): string;
}

export class OverworldBrowseOverlayController {
  private readonly roomBadgeScaleConfig: RoomBadgeScaleConfig = {
    hideZoom: ROOM_BADGE_HIDE_ZOOM,
    fadeStartZoom: ROOM_BADGE_FADE_START_ZOOM,
    scaleFullZoom: ROOM_BADGE_SCALE_FULL_ZOOM,
    layoutFullZoom: ROOM_BADGE_LAYOUT_FULL_ZOOM,
    minScreenScale: ROOM_BADGE_MIN_SCREEN_SCALE,
    maxScreenScale: ROOM_BADGE_MAX_SCREEN_SCALE,
    dotTierMaxZoom: ROOM_BADGE_DOT_TIER_MAX_ZOOM,
    compactTierMaxZoom: ROOM_BADGE_COMPACT_TIER_MAX_ZOOM,
    tierFadeSpan: ROOM_BADGE_TIER_FADE_SPAN,
  };

  private roomActivityBadges: RoomActivityBadge[] = [];
  private expandedRoomBadges: ExpandedRoomBadge[] = [];
  private selectedRoomPlayAffordance: SelectedRoomPlayAffordance | null = null;

  constructor(private readonly host: OverworldBrowseOverlayControllerHost) {}

  create(): void {
    if (this.selectedRoomPlayAffordance) {
      return;
    }

    const background = this.host.scene.add.circle(
      0,
      0,
      SELECTED_ROOM_PLAY_BUTTON_RADIUS,
      RETRO_COLORS.backgroundNumber,
      0.9,
    );
    background.setStrokeStyle(1.5, RETRO_COLORS.selected, 0.92);

    const icon = this.host.scene.add.graphics();
    icon.fillStyle(RETRO_COLORS.selected, 1);
    icon.fillTriangle(-3, -5, -3, 5, 5, 0);

    const warpBackground = this.host.scene.add.rectangle(
      0,
      0,
      SELECTED_ROOM_WARP_BUTTON_WIDTH,
      SELECTED_ROOM_WARP_BUTTON_HEIGHT,
      0x79ccde,
      0.96,
    );
    warpBackground.setStrokeStyle(2, 0x18161c, 1);
    warpBackground.setVisible(false);

    const warpLabel = this.host.scene.add.text(0, 0, 'WARP', {
      fontFamily: 'Early GameBoy, monospace',
      fontSize: '12px',
      color: '#fff3db',
      stroke: '#18161c',
      strokeThickness: 0,
      align: 'center',
    });
    warpLabel.setOrigin(0.5, 0.5);
    warpLabel.setResolution(2);
    warpLabel.setVisible(false);

    const container = this.host.scene.add.container(0, 0, [
      background,
      icon,
      warpBackground,
      warpLabel,
    ]);
    container.setDepth(28);
    container.setVisible(false);
    container.setSize(
      SELECTED_ROOM_WARP_BUTTON_WIDTH,
      SELECTED_ROOM_WARP_BUTTON_HEIGHT,
    );
    container.setInteractive(
      new Phaser.Geom.Rectangle(
        -SELECTED_ROOM_WARP_BUTTON_WIDTH * 0.5,
        -SELECTED_ROOM_WARP_BUTTON_HEIGHT * 0.5,
        SELECTED_ROOM_WARP_BUTTON_WIDTH,
        SELECTED_ROOM_WARP_BUTTON_HEIGHT,
      ),
      Phaser.Geom.Rectangle.Contains,
    );
    if (container.input) {
      container.input.cursor = 'pointer';
    }
    container.on(
      Phaser.Input.Events.GAMEOBJECT_POINTER_OVER,
      () => {
        background.setFillStyle(RETRO_COLORS.backgroundNumber, 0.98);
        warpBackground.setFillStyle(0x79ccde, 1);
      },
    );
    container.on(
      Phaser.Input.Events.GAMEOBJECT_POINTER_OUT,
      () => {
        background.setFillStyle(RETRO_COLORS.backgroundNumber, 0.9);
        warpBackground.setFillStyle(0x79ccde, 0.96);
      },
    );
    container.on(
      Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN,
      (
        _pointer: Phaser.Input.Pointer,
        _localX: number,
        _localY: number,
        event: Phaser.Types.Input.EventData,
      ) => {
        event.stopPropagation();
        if (this.host.getMode() === 'play') {
          this.host.warpToSelectedRoom();
          return;
        }

        this.host.playSelectedRoom();
      },
    );

    this.selectedRoomPlayAffordance = {
      container,
      background,
      icon,
      warpBackground,
      warpLabel,
    };
  }

  destroy(): void {
    this.destroyRoomActivityBadges();
    this.destroyExpandedRoomBadges();
    this.selectedRoomPlayAffordance?.container.destroy(true);
    this.selectedRoomPlayAffordance = null;
  }

  getBackdropIgnoredObjects(): Phaser.GameObjects.GameObject[] {
    const ignoredObjects: Phaser.GameObjects.GameObject[] = [];
    for (const badge of this.roomActivityBadges) {
      ignoredObjects.push(badge.container);
    }
    for (const badge of this.expandedRoomBadges) {
      ignoredObjects.push(badge.container);
    }
    if (this.selectedRoomPlayAffordance) {
      ignoredObjects.push(this.selectedRoomPlayAffordance.container);
    }
    return ignoredObjects;
  }

  redrawBrowseOverlays(): void {
    this.destroyRoomActivityBadges();
    this.destroyExpandedRoomBadges();

    const worldWindow = this.host.getWorldWindow();
    if (!worldWindow || this.host.getMode() !== 'browse') {
      this.updateSelectedRoomPlayAffordance();
      return;
    }

    const gridSize = worldWindow.radius * 2 + 1;
    for (let row = 0; row < gridSize; row += 1) {
      for (let col = 0; col < gridSize; col += 1) {
        const coordinates = {
          x: worldWindow.center.x + col - worldWindow.radius,
          y: worldWindow.center.y + row - worldWindow.radius,
        };
        this.redrawActivityBadgeAt(coordinates);
        this.redrawExpandedRoomBadgeAt(coordinates);
      }
    }

    this.syncScale(this.host.getZoom());
    this.updateSelectedRoomPlayAffordance();
  }

  syncScale(zoom: number): void {
    syncBadgePlacements(this.roomActivityBadges, zoom, this.roomBadgeScaleConfig);
    syncBadgePlacements(this.expandedRoomBadges, zoom, this.roomBadgeScaleConfig);
    this.updateSelectedRoomPlayAffordance(zoom);
  }

  isSelectedRoomPlayAffordanceVisible(): boolean {
    return this.selectedRoomPlayAffordance?.container.visible ?? false;
  }

  private destroyRoomActivityBadges(): void {
    for (const badge of this.roomActivityBadges) {
      badge.container.destroy(true);
    }
    this.roomActivityBadges = [];
  }

  private destroyExpandedRoomBadges(): void {
    for (const badge of this.expandedRoomBadges) {
      badge.container.destroy(true);
    }
    this.expandedRoomBadges = [];
  }

  private redrawActivityBadgeAt(coordinates: RoomCoordinates): void {
    const editorCount = this.host.getRoomEditorCount(coordinates);
    if (editorCount <= 0) {
      return;
    }

    const origin = this.host.getRoomOrigin(coordinates);
    const label = editorCount === 1 ? 'BUILDING' : `${editorCount} BUILDING`;
    const backgroundWidth = Math.max(label.length * 5.9 + 10, 64);
    const background = this.host.scene.add.rectangle(
      0,
      0,
      backgroundWidth,
      14,
      RETRO_COLORS.backgroundNumber,
      0.88,
    );
    background.setOrigin(0, 0);
    background.setStrokeStyle(1, RETRO_COLORS.frontier, 0.94);

    const labelText = this.host.scene.add.text(5, 2, label, {
      fontFamily: 'Courier New',
      fontSize: '8px',
      color: '#ffcf86',
      stroke: '#050505',
      strokeThickness: 3,
    });

    const zoomedInPosition = { x: origin.x + 8, y: origin.y + ROOM_PX_HEIGHT - 34 };
    const zoomedOutPosition = {
      x: origin.x + (ROOM_PX_WIDTH - backgroundWidth) * 0.5,
      y: origin.y + ROOM_PX_HEIGHT - 34,
    };
    const container = this.host.scene.add.container(zoomedInPosition.x, zoomedInPosition.y, [
      background,
      labelText,
    ]);
    container.setDepth(18);
    this.roomActivityBadges.push({
      container,
      zoomedInPosition,
      zoomedOutPosition,
    });
  }

  private redrawExpandedRoomBadgeAt(coordinates: RoomCoordinates): void {
    const summary = this.host.getRoomSummaryForCoordinates(coordinates);
    const expandedRoom = summary?.expandedRoom ?? null;
    if (
      !expandedRoom ||
      expandedRoom.source === 'standalone_room' ||
      expandedRoom.cellCount <= 1 ||
      !this.isExpandedRoomBadgeAnchor(coordinates, expandedRoom.expandedRoomId)
    ) {
      return;
    }

    this.expandedRoomBadges.push(
      this.createSemanticRoomBadge({
        owner: 'expanded-room',
        title: (expandedRoom.title?.trim() || 'EXPANDED ROOM').toUpperCase(),
        typeLabel: this.getCourseGoalTypeBadgeLabel(expandedRoom.goalType),
        compactCode: this.getSemanticBadgeCode(expandedRoom.goalType),
        color: this.getSemanticBadgeColor(expandedRoom.goalType),
        coordinates,
      }),
    );
  }

  private isExpandedRoomBadgeAnchor(coordinates: RoomCoordinates, expandedRoomId: string): boolean {
    return ![
      { x: coordinates.x - 1, y: coordinates.y },
      { x: coordinates.x, y: coordinates.y - 1 },
    ].some(
      (neighbor) =>
        this.host.getRoomSummaryForCoordinates(neighbor)?.expandedRoom?.expandedRoomId
        === expandedRoomId,
    );
  }

  private updateSelectedRoomPlayAffordance(zoom: number = this.host.getZoom()): void {
    const affordance = this.selectedRoomPlayAffordance;
    if (!affordance) {
      return;
    }

    const selectedCoordinates = this.host.getSelectedCoordinates();
    const selectedState = this.host.getCellStateAt(selectedCoordinates);
    const mode = this.host.getMode();
    const shouldShow =
      Boolean(this.host.getWorldWindow()) &&
      (mode === 'browse' || this.host.canWarpToSelectedRoom()) &&
      (selectedState === 'published' || selectedState === 'draft') &&
      this.host.isWithinLoadedRoomBounds(selectedCoordinates);

    affordance.container.setVisible(shouldShow);
    if (!shouldShow) {
      return;
    }

    const origin = this.host.getRoomOrigin(selectedCoordinates);
    affordance.container.setPosition(
      origin.x + ROOM_PX_WIDTH * 0.5,
      origin.y + ROOM_PX_HEIGHT * 0.5,
    );
    this.syncSelectedRoomPlayAffordanceMode(affordance, mode);
    affordance.container.setScale(
      mode === 'play'
        ? this.getSelectedRoomWarpAffordanceScale(zoom)
        : this.getSelectedRoomPlayAffordanceScale(zoom),
    );
  }

  private syncSelectedRoomPlayAffordanceMode(
    affordance: SelectedRoomPlayAffordance,
    mode: OverworldMode,
  ): void {
    const warpMode = mode === 'play';
    affordance.background.setVisible(!warpMode);
    affordance.icon.setVisible(!warpMode);
    affordance.warpBackground.setVisible(warpMode);
    affordance.warpLabel.setVisible(warpMode);

    if (warpMode) {
      affordance.container.setSize(
        SELECTED_ROOM_WARP_BUTTON_WIDTH,
        SELECTED_ROOM_WARP_BUTTON_HEIGHT,
      );
      affordance.container.input?.hitArea.setTo(
        -SELECTED_ROOM_WARP_BUTTON_WIDTH * 0.5,
        -SELECTED_ROOM_WARP_BUTTON_HEIGHT * 0.5,
        SELECTED_ROOM_WARP_BUTTON_WIDTH,
        SELECTED_ROOM_WARP_BUTTON_HEIGHT,
      );
      return;
    }

    affordance.container.setSize(
      SELECTED_ROOM_PLAY_BUTTON_HIT_RADIUS * 2,
      SELECTED_ROOM_PLAY_BUTTON_HIT_RADIUS * 2,
    );
    affordance.container.input?.hitArea.setTo(
      -SELECTED_ROOM_PLAY_BUTTON_HIT_RADIUS,
      -SELECTED_ROOM_PLAY_BUTTON_HIT_RADIUS,
      SELECTED_ROOM_PLAY_BUTTON_HIT_RADIUS * 2,
      SELECTED_ROOM_PLAY_BUTTON_HIT_RADIUS * 2,
    );
  }

  private getSelectedRoomPlayAffordanceScale(zoom: number): number {
    return Phaser.Math.Clamp(
      SELECTED_ROOM_PLAY_BUTTON_SCALE_FACTOR / Math.max(zoom, MIN_ZOOM),
      SELECTED_ROOM_PLAY_BUTTON_MIN_SCALE,
      SELECTED_ROOM_PLAY_BUTTON_MAX_SCALE,
    );
  }

  private getSelectedRoomWarpAffordanceScale(zoom: number): number {
    return Phaser.Math.Clamp(
      SELECTED_ROOM_WARP_BUTTON_SCALE_FACTOR / Math.max(zoom, MIN_ZOOM),
      SELECTED_ROOM_WARP_BUTTON_MIN_SCALE,
      SELECTED_ROOM_WARP_BUTTON_MAX_SCALE,
    );
  }

  private getCornerRoomBadgeAnchorPosition(
    origin: { x: number; y: number },
    owner: SemanticBadgeOwner,
  ): { x: number; y: number } {
    return owner === 'goal'
      ? {
          x: origin.x + ROOM_BADGE_CORNER_INSET_X,
          y: origin.y + ROOM_BADGE_CORNER_INSET_Y,
        }
      : {
          x: origin.x + ROOM_PX_WIDTH - ROOM_BADGE_CORNER_INSET_X,
          y: origin.y + ROOM_BADGE_CORNER_INSET_Y,
        };
  }

  private getSemanticBadgeColor(goalType: RoomGoalType | CourseGoalType | null): number {
    if (!goalType) {
      return RETRO_COLORS.selected;
    }

    return ROOM_BADGE_SEMANTIC_COLORS[goalType];
  }

  private getSemanticBadgeCode(goalType: RoomGoalType | CourseGoalType | null): string {
    if (!goalType) {
      return '??';
    }

    return ROOM_BADGE_SEMANTIC_CODES[goalType];
  }

  private getCourseGoalTypeBadgeLabel(goalType: RoomGoalType | CourseGoalType | null): string {
    return (goalType ? ROOM_GOAL_LABELS[goalType] : 'Goal Missing').toUpperCase();
  }

  private createRoundedBadgeBackground(
    width: number,
    height: number,
    fillColor: number,
    fillAlpha: number,
    strokeColor: number,
    strokeAlpha: number,
    radius: number,
  ): Phaser.GameObjects.Graphics {
    const graphic = this.host.scene.add.graphics();
    graphic.fillStyle(fillColor, fillAlpha);
    graphic.fillRoundedRect(-width * 0.5, -height * 0.5, width, height, radius);
    graphic.lineStyle(1, strokeColor, strokeAlpha);
    graphic.strokeRoundedRect(-width * 0.5, -height * 0.5, width, height, radius);
    return graphic;
  }

  private createDiamondBadgeBackground(
    size: number,
    fillColor: number,
    fillAlpha: number,
    strokeColor: number,
    strokeAlpha: number,
  ): Phaser.GameObjects.Graphics {
    const half = size * 0.5;
    const points = [
      new Phaser.Math.Vector2(0, -half),
      new Phaser.Math.Vector2(half, 0),
      new Phaser.Math.Vector2(0, half),
      new Phaser.Math.Vector2(-half, 0),
    ];
    const graphic = this.host.scene.add.graphics();
    graphic.fillStyle(fillColor, fillAlpha);
    graphic.fillPoints(points, true, true);
    graphic.lineStyle(1, strokeColor, strokeAlpha);
    graphic.strokePoints(points, true, true);
    return graphic;
  }

  private createChamferBadgeBackground(
    width: number,
    height: number,
    fillColor: number,
    fillAlpha: number,
    strokeColor: number,
    strokeAlpha: number,
    chamfer: number,
  ): Phaser.GameObjects.Graphics {
    const halfWidth = width * 0.5;
    const halfHeight = height * 0.5;
    const points = [
      new Phaser.Math.Vector2(-halfWidth + chamfer, -halfHeight),
      new Phaser.Math.Vector2(halfWidth - chamfer, -halfHeight),
      new Phaser.Math.Vector2(halfWidth, -halfHeight + chamfer),
      new Phaser.Math.Vector2(halfWidth, halfHeight - chamfer),
      new Phaser.Math.Vector2(halfWidth - chamfer, halfHeight),
      new Phaser.Math.Vector2(-halfWidth + chamfer, halfHeight),
      new Phaser.Math.Vector2(-halfWidth, halfHeight - chamfer),
      new Phaser.Math.Vector2(-halfWidth, -halfHeight + chamfer),
    ];
    const graphic = this.host.scene.add.graphics();
    graphic.fillStyle(fillColor, fillAlpha);
    graphic.fillPoints(points, true, true);
    graphic.lineStyle(1, strokeColor, strokeAlpha);
    graphic.strokePoints(points, true, true);
    return graphic;
  }

  private fitTextBadgeTitle(
    rawTitle: string,
    titleText: Phaser.GameObjects.Text,
    typeText: Phaser.GameObjects.Text,
    maxWidth: number,
    horizontalPadding: number,
  ): string {
    const widestType = typeText.width;
    for (let maxLength = rawTitle.length; maxLength >= 1; maxLength -= 1) {
      const candidate =
        maxLength === rawTitle.length
          ? rawTitle
          : this.host.truncateOverlayText(rawTitle, maxLength);
      titleText.setText(candidate);
      if (Math.max(titleText.width, widestType) + horizontalPadding * 2 <= maxWidth) {
        return candidate;
      }
    }

    const fallback = this.host.truncateOverlayText(rawTitle, 1);
    titleText.setText(fallback);
    return fallback;
  }

  private createBadgeDotTier(
    owner: SemanticBadgeOwner,
    color: number,
  ): Phaser.GameObjects.Container {
    const shape =
      owner === 'goal'
        ? this.host.scene.add.circle(0, 0, ROOM_BADGE_DOT_SIZE * 0.5, color, 0.98)
        : this.createDiamondBadgeBackground(
            ROOM_BADGE_DOT_SIZE + 1,
            color,
            0.98,
            RETRO_COLORS.selected,
            0.88,
          );

    if (shape instanceof Phaser.GameObjects.Arc) {
      shape.setStrokeStyle(1, RETRO_COLORS.backgroundNumber, 0.72);
    }

    return this.host.scene.add.container(0, ROOM_BADGE_DOT_SIZE * 0.5, [shape]);
  }

  private createBadgeCompactTier(
    owner: SemanticBadgeOwner,
    color: number,
    compactCode: string,
  ): Phaser.GameObjects.Container {
    const background =
      owner === 'goal'
        ? this.createRoundedBadgeBackground(
            ROOM_BADGE_CHIP_WIDTH,
            ROOM_BADGE_CHIP_HEIGHT,
            color,
            0.98,
            RETRO_COLORS.backgroundNumber,
            0.84,
            6,
          )
        : this.createChamferBadgeBackground(
            ROOM_BADGE_CHIP_WIDTH,
            ROOM_BADGE_CHIP_HEIGHT,
            RETRO_COLORS.backgroundNumber,
            0.9,
            color,
            0.98,
            3,
          );

    const label = this.host.scene.add.text(0, 0, compactCode, {
      fontFamily: 'Courier New',
      fontSize: '8px',
      color: owner === 'goal' ? '#050505' : Phaser.Display.Color.IntegerToColor(color).rgba,
      stroke: owner === 'goal' ? '#f3eee2' : '#050505',
      strokeThickness: owner === 'goal' ? 0 : 2,
    });
    label.setOrigin(0.5, 0.5);

    return this.host.scene.add.container(
      owner === 'goal' ? ROOM_BADGE_CHIP_WIDTH * 0.5 : -ROOM_BADGE_CHIP_WIDTH * 0.5,
      ROOM_BADGE_CHIP_HEIGHT * 0.5,
      [background, label],
    );
  }

  private createBadgeTextTier(
    descriptor: SemanticRoomBadgeDescriptor,
  ): Phaser.GameObjects.Container {
    const titleText = this.host.scene.add.text(0, 0, descriptor.title, {
      fontFamily: 'Courier New',
      fontSize: '12px',
      color: '#f3eee2',
      stroke: '#050505',
      strokeThickness: 3,
      align: 'center',
    });
    titleText.setOrigin(0.5, 1);

    const typeText = this.host.scene.add.text(0, 0, descriptor.typeLabel, {
      fontFamily: 'Courier New',
      fontSize: '10px',
      color: Phaser.Display.Color.IntegerToColor(descriptor.color).rgba,
      stroke: '#050505',
      strokeThickness: 3,
      align: 'center',
    });
    typeText.setOrigin(0.5, 0);

    const horizontalPadding = 10;
    const verticalPadding = 8;
    this.fitTextBadgeTitle(
      descriptor.title,
      titleText,
      typeText,
      ROOM_BADGE_TEXT_MAX_WIDTH,
      horizontalPadding,
    );

    const backgroundWidth = Phaser.Math.Clamp(
      Math.max(titleText.width, typeText.width) + horizontalPadding * 2,
      ROOM_BADGE_TEXT_MIN_WIDTH,
      ROOM_BADGE_TEXT_MAX_WIDTH,
    );
    const backgroundHeight = 38;
    const background =
      descriptor.owner === 'goal'
        ? this.createRoundedBadgeBackground(
            backgroundWidth,
            backgroundHeight,
            RETRO_COLORS.backgroundNumber,
            0.9,
            descriptor.color,
            0.94,
            8,
          )
        : this.createChamferBadgeBackground(
            backgroundWidth,
            backgroundHeight,
            RETRO_COLORS.backgroundNumber,
            0.84,
            descriptor.color,
            0.98,
            5,
          );

    const accent =
      descriptor.owner === 'goal'
        ? this.host.scene.add.rectangle(
            -backgroundWidth * 0.5 + 8,
            -backgroundHeight * 0.5 + verticalPadding + 1,
            6,
            6,
            descriptor.color,
            0.98,
          )
        : this.createDiamondBadgeBackground(
            7,
            descriptor.color,
            0.98,
            RETRO_COLORS.selected,
            0.82,
          );
    if (descriptor.owner === 'expanded-room' && accent instanceof Phaser.GameObjects.Graphics) {
      accent.setPosition(
        -backgroundWidth * 0.5 + 10,
        -backgroundHeight * 0.5 + verticalPadding + 1,
      );
    }

    titleText.setPosition(0, -2);
    typeText.setPosition(0, 5);

    return this.host.scene.add.container(
      descriptor.owner === 'goal' ? backgroundWidth * 0.5 : -backgroundWidth * 0.5,
      backgroundHeight * 0.5,
      [background, accent, titleText, typeText],
    );
  }

  private createSemanticRoomBadge(
    descriptor: SemanticRoomBadgeDescriptor,
  ): OverworldBadgePlacement {
    const dotTier = this.createBadgeDotTier(descriptor.owner, descriptor.color);
    const compactTier = this.createBadgeCompactTier(
      descriptor.owner,
      descriptor.color,
      descriptor.compactCode,
    );
    const textTier = this.createBadgeTextTier(descriptor);
    const container = this.host.scene.add.container(0, 0, [dotTier, compactTier, textTier]);
    container.setDepth(18);

    const position = this.getCornerRoomBadgeAnchorPosition(
      this.host.getRoomOrigin(descriptor.coordinates),
      descriptor.owner,
    );

    const tierDisplays: OverworldBadgeTierDisplay[] = [
      { tier: 'dot', container: dotTier },
      { tier: 'compact', container: compactTier },
      { tier: 'text', container: textTier },
    ];

    return {
      container,
      zoomedInPosition: position,
      zoomedOutPosition: position,
      tierDisplays,
    };
  }
}
