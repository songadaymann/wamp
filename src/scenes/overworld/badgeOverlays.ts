import Phaser from 'phaser';

export type RoomBadgePresentationTier = 'dot' | 'compact' | 'text';

export interface OverworldBadgeTierDisplay {
  tier: RoomBadgePresentationTier;
  container: Phaser.GameObjects.Container;
  scaleMultiplier?: number;
}

export interface OverworldBadgePlacement {
  container: Phaser.GameObjects.Container;
  zoomedInPosition: { x: number; y: number };
  zoomedOutPosition: { x: number; y: number };
  tierDisplays?: OverworldBadgeTierDisplay[];
}

export interface RoomBadgeScaleConfig {
  hideZoom: number;
  fadeStartZoom: number;
  scaleFullZoom: number;
  layoutFullZoom: number;
  minScreenScale: number;
  maxScreenScale: number;
  dotTierMaxZoom: number;
  compactTierMaxZoom: number;
  tierFadeSpan: number;
}

export interface CenteredRoomBadgePositionOptions {
  origin: { x: number; y: number };
  backgroundWidth: number;
  backgroundHeight: number;
  stackIndex: number;
  stackCount: number;
  roomWidth: number;
  roomHeight: number;
  stackGap?: number;
  verticalBias?: number;
}

export function getCenteredRoomBadgePosition(
  options: CenteredRoomBadgePositionOptions,
): { x: number; y: number } {
  const {
    origin,
    backgroundWidth,
    backgroundHeight,
    stackIndex,
    stackCount,
    roomWidth,
    roomHeight,
    stackGap = 8,
    verticalBias = 0.44,
  } = options;
  const totalHeight =
    stackCount * backgroundHeight + Math.max(0, stackCount - 1) * stackGap;
  const centerX = origin.x + roomWidth * 0.5;
  const centerY = origin.y + roomHeight * verticalBias;
  return {
    x: centerX - backgroundWidth * 0.5,
    y: centerY - totalHeight * 0.5 + stackIndex * (backgroundHeight + stackGap),
  };
}

export function getRoomBadgeOverlayScale(
  zoom: number,
  config: RoomBadgeScaleConfig,
): number {
  const zoomProgress = Phaser.Math.Clamp(
    (zoom - config.hideZoom) / (config.scaleFullZoom - config.hideZoom),
    0,
    1,
  );
  const desiredScreenScale = Phaser.Math.Linear(
    config.minScreenScale,
    config.maxScreenScale,
    zoomProgress,
  );
  return desiredScreenScale / Math.max(zoom, 0.001);
}

export function getRoomBadgeLayoutProgress(
  zoom: number,
  config: RoomBadgeScaleConfig,
): number {
  return Phaser.Math.Clamp(
    (zoom - config.hideZoom) / (config.layoutFullZoom - config.hideZoom),
    0,
    1,
  );
}

export function getRoomBadgeFadeProgress(
  zoom: number,
  config: RoomBadgeScaleConfig,
): number {
  return Phaser.Math.Clamp(
    (zoom - config.hideZoom) / (config.fadeStartZoom - config.hideZoom),
    0,
    1,
  );
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) {
    return x >= edge1 ? 1 : 0;
  }

  const t = Phaser.Math.Clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function getTierAlphaMap(
  zoom: number,
  config: RoomBadgeScaleConfig,
): Record<RoomBadgePresentationTier, number> {
  const span = Math.max(0.001, config.tierFadeSpan);
  const dot = 1 - smoothstep(config.dotTierMaxZoom - span, config.dotTierMaxZoom + span, zoom);
  const compactIn = smoothstep(config.dotTierMaxZoom - span, config.dotTierMaxZoom + span, zoom);
  const compactOut =
    1 - smoothstep(config.compactTierMaxZoom - span, config.compactTierMaxZoom + span, zoom);
  const compact = Phaser.Math.Clamp(Math.min(compactIn, compactOut), 0, 1);
  const text = smoothstep(
    config.compactTierMaxZoom - span,
    config.compactTierMaxZoom + span,
    zoom,
  );

  return {
    dot,
    compact,
    text,
  };
}

export function syncBadgePlacements(
  badges: OverworldBadgePlacement[],
  zoom: number,
  config: RoomBadgeScaleConfig,
): void {
  const overlayScale = getRoomBadgeOverlayScale(zoom, config);
  const layoutProgress = getRoomBadgeLayoutProgress(zoom, config);
  const fadeProgress = getRoomBadgeFadeProgress(zoom, config);
  const tierAlphas = getTierAlphaMap(zoom, config);
  for (const badge of badges) {
    badge.container.setPosition(
      Phaser.Math.Linear(
        badge.zoomedOutPosition.x,
        badge.zoomedInPosition.x,
        layoutProgress,
      ),
      Phaser.Math.Linear(
        badge.zoomedOutPosition.y,
        badge.zoomedInPosition.y,
        layoutProgress,
      ),
    );
    badge.container.setScale(overlayScale);

    if (badge.tierDisplays && badge.tierDisplays.length > 0) {
      let visibleTierCount = 0;
      for (const display of badge.tierDisplays) {
        const alpha = fadeProgress * tierAlphas[display.tier];
        display.container.setScale(display.scaleMultiplier ?? 1);
        display.container.setAlpha(alpha);
        display.container.setVisible(alpha > 0.02);
        if (alpha > 0.02) {
          visibleTierCount += 1;
        }
      }

      badge.container.setAlpha(1);
      badge.container.setVisible(visibleTierCount > 0);
      continue;
    }

    badge.container.setAlpha(fadeProgress);
    badge.container.setVisible(fadeProgress > 0.02);
  }
}
