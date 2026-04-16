import type Phaser from 'phaser';
import type { RoomCoordinates } from '../persistence/roomModel';

type PlayableState = 'published' | 'claimed_unpublished' | 'draft' | 'frontier' | 'empty' | 'missing';

interface OverworldSceneHarness {
  jumpToCoordinates: (coordinates: RoomCoordinates) => Promise<void>;
  zoomIn: () => void;
  zoomOut: () => void;
  playSelectedRoom: () => void;
  returnToWorld: () => void;
  describeState: () => Record<string, unknown>;
}

interface OverworldStressStepResult {
  label: string;
  ok: boolean;
  mode: string | null;
  zoom: number | null;
  activeChunkCount: number;
  previewRoomCount: number;
  previewChunkCount: number;
  protectedVisiblePreviewRoomCount: number;
  previewTileSize: number;
  previewTextureMegapixels: number;
  previewRoomBudget: number;
  fullRoomCount: number;
  fullRoomBudget: number;
  subscribedShardCount: number;
  visibleGhostCount: number;
  ghostRenderBudget: number;
  issues: string[];
}

export async function runOverworldLodStress(game: Phaser.Game): Promise<{
  passed: boolean;
  skippedPlayMode: boolean;
  results: OverworldStressStepResult[];
}> {
  const scene = game.scene.getScene('OverworldPlayScene') as unknown as OverworldSceneHarness | null;
  if (!scene || typeof scene.describeState !== 'function') {
    throw new Error('OverworldPlayScene is not active.');
  }

  const results: OverworldStressStepResult[] = [];
  let skippedPlayMode = false;

  const capture = async (label: string): Promise<void> => {
    await settle(450);
    const state = scene.describeState();
    results.push(validateState(label, state));
  };

  scene.returnToWorld();
  await capture('browse-start');

  const initialState = scene.describeState();
  const selectedState = readSelectedState(initialState);
  if (selectedState === 'published' || selectedState === 'draft') {
    scene.playSelectedRoom();
    await capture('play-start');
    for (let index = 0; index < 2; index += 1) {
      scene.zoomOut();
    }
    await capture('play-zoomed-out');
    scene.returnToWorld();
    await capture('browse-return');
  } else {
    skippedPlayMode = true;
  }

  for (let index = 0; index < 5; index += 1) {
    scene.zoomOut();
  }
  await capture('browse-far-zoom');

  if (selectedState === 'published' || selectedState === 'draft') {
    scene.playSelectedRoom();
    await capture('play-from-far-overview');
    scene.returnToWorld();
    await capture('browse-return-from-far-overview');
  }

  await scene.jumpToCoordinates({ x: 12, y: 0 });
  await capture('browse-jump-east');

  await scene.jumpToCoordinates({ x: -12, y: 0 });
  await capture('browse-jump-west');

  await scene.jumpToCoordinates({ x: 0, y: 12 });
  await capture('browse-jump-south');

  await scene.jumpToCoordinates({ x: 0, y: 0 });
  for (let index = 0; index < 5; index += 1) {
    scene.zoomIn();
  }
  await capture('browse-reset');

  return {
    passed: results.every((result) => result.ok),
    skippedPlayMode,
    results,
  };
}

async function settle(ms: number): Promise<void> {
  if (typeof window.advanceTime === 'function') {
    await window.advanceTime(ms);
    return;
  }

  await new Promise((resolve) => window.setTimeout(resolve, ms));
}

function readSelectedState(state: Record<string, unknown>): PlayableState {
  const value = state.selectedState;
  return typeof value === 'string' ? (value as PlayableState) : 'missing';
}

function validateState(label: string, state: Record<string, unknown>): OverworldStressStepResult {
  const lodMetrics = readRecord(state.lodMetrics);
  const presence = readRecord(state.presence);
  const activeChunkCount = readNumber(lodMetrics.activeChunkCount);
  const previewRoomCount = readNumber(lodMetrics.loadedPreviewRoomCount, readNumber(state.loadedPreviewRooms));
  const previewChunkCount = readNumber(lodMetrics.loadedPreviewChunkCount);
  const protectedVisiblePreviewRoomCount = readNumber(lodMetrics.protectedVisiblePreviewRoomCount);
  const previewTileSize = readNumber(lodMetrics.previewTileSize);
  const approximatePreviewTexturePixels = readNumber(lodMetrics.approximatePreviewTexturePixels);
  const previewRoomBudget = readNumber(lodMetrics.previewRoomBudget);
  const fullRoomCount = readNumber(lodMetrics.loadedFullRoomCount, readNumber(state.loadedFullRooms));
  const fullRoomBudget = readNumber(lodMetrics.fullRoomBudget);
  const subscribedShardCount = readNumber(presence.subscribedShardCount);
  const visibleGhostCount = readNumber(presence.visibleGhostCount);
  const ghostRenderBudget = readNumber(presence.ghostRenderBudget);
  const issues: string[] = [];
  const mode = typeof state.mode === 'string' ? state.mode : null;
  const zoom = typeof state.zoom === 'number' ? state.zoom : null;
  const performanceProfile = typeof state.performanceProfile === 'string'
    ? state.performanceProfile
    : null;
  const overviewChunkCap =
    mode === 'browse'
      && performanceProfile === 'default'
      && zoom !== null
      && zoom <= 0.14
      ? 81
      : 49;

  if (previewRoomBudget > 0 && previewRoomCount > previewRoomBudget) {
    issues.push(`preview rooms ${previewRoomCount} exceeded budget ${previewRoomBudget}`);
  }

  if (fullRoomBudget > 0 && fullRoomCount > fullRoomBudget) {
    issues.push(`full rooms ${fullRoomCount} exceeded budget ${fullRoomBudget}`);
  }

  if (ghostRenderBudget > 0 && visibleGhostCount > ghostRenderBudget) {
    issues.push(`visible ghosts ${visibleGhostCount} exceeded budget ${ghostRenderBudget}`);
  }

  if (activeChunkCount > overviewChunkCap) {
    issues.push(`active chunks ${activeChunkCount} exceeded hard cap ${overviewChunkCap}`);
  }

  if (
    mode === 'browse'
    && zoom !== null
    && zoom <= 0.14
    && protectedVisiblePreviewRoomCount > previewRoomCount
  ) {
    issues.push(
      `visible preview rooms ${protectedVisiblePreviewRoomCount} exceeded loaded previews ${previewRoomCount}`
    );
  }

  if (subscribedShardCount > overviewChunkCap) {
    issues.push(`subscribed shards ${subscribedShardCount} exceeded hard cap ${overviewChunkCap}`);
  }

  return {
    label,
    ok: issues.length === 0,
    mode,
    zoom,
    activeChunkCount,
    previewRoomCount,
    previewChunkCount,
    protectedVisiblePreviewRoomCount,
    previewTileSize,
    previewTextureMegapixels: Number((approximatePreviewTexturePixels / 1_000_000).toFixed(2)),
    previewRoomBudget,
    fullRoomCount,
    fullRoomBudget,
    subscribedShardCount,
    visibleGhostCount,
    ghostRenderBudget,
    issues,
  };
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function readNumber(primary: unknown, fallback = 0): number {
  return typeof primary === 'number' && Number.isFinite(primary) ? primary : fallback;
}
