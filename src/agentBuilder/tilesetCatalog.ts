import {
  TILESETS,
  decodeTileDataValue,
  getTilesetByGid,
  type TerrainCollisionProfileId,
  type TilesetConfig,
} from '../config';
import {
  cloneRoomSnapshot,
  type RoomRecord,
  type RoomSnapshot,
  type RoomTilesetHint,
  type RoomVersionRecord,
} from '../persistence/roomModel';

export interface AgentTilesetBuildStyle {
  id: string;
  label: string;
  description: string;
  surfaceLocalIndices: number[];
  surfaceGids: number[];
  fillLocalIndices: number[];
  fillGids: number[];
}

export interface AgentTilesetCatalogEntry {
  key: string;
  name: string;
  gidStart: number;
  gidEnd: number;
  decoratedTopLocalIndices: number[];
  decoratedTopGids: number[];
  nonCollidingLocalIndices: number[];
  nonCollidingGids: number[];
  buildStyles: AgentTilesetBuildStyle[];
}

interface AgentTilesetBuildStyleDefinition {
  id: string;
  label: string;
  description: string;
  surfaceLocalIndices: number[];
  fillLocalIndices: number[];
}

const AGENT_TILESET_BUILD_STYLE_DEFINITIONS: Record<string, AgentTilesetBuildStyleDefinition[]> = {
  forest: [
    {
      id: 'forest_flat',
      label: 'Forest Flat',
      description: 'Grass-topped dirt platforms that match the common forest ground language.',
      surfaceLocalIndices: [14, 15, 16, 17],
      fillLocalIndices: [27, 28, 39, 40],
    },
  ],
  desert: [
    {
      id: 'desert_flat',
      label: 'Desert Flat',
      description: 'Sandstone platforms with the standard desert top edge and fill blocks.',
      surfaceLocalIndices: [14, 15, 16, 17],
      fillLocalIndices: [27, 28, 39, 40],
    },
  ],
  dirt: [
    {
      id: 'dirt_flat',
      label: 'Dirt Flat',
      description: 'Neutral dirt platforms that use the shared standard top edge and fill blocks.',
      surfaceLocalIndices: [14, 15, 16, 17],
      fillLocalIndices: [27, 28, 39, 40],
    },
  ],
  lava: [
    {
      id: 'lava_shelf',
      label: 'Lava Shelf',
      description: 'Jagged lava shelf pieces for readable floating ledges and thicker lava rock platforms.',
      surfaceLocalIndices: [31, 32, 33, 34, 35],
      fillLocalIndices: [46, 47, 48, 49, 50],
    },
  ],
  snow: [
    {
      id: 'snow_flat',
      label: 'Snow Flat',
      description: 'Snowy top edge with cold stone fill blocks for standard snowy ground.',
      surfaceLocalIndices: [13, 14, 15, 18],
      fillLocalIndices: [24, 25, 36, 37],
    },
  ],
  water: [
    {
      id: 'water_flat',
      label: 'Water Flat',
      description: 'Water-theme rock platforms with the shared grassy top edge and fill blocks.',
      surfaceLocalIndices: [14, 15, 16, 17],
      fillLocalIndices: [27, 28, 39, 40],
    },
  ],
  smb_lvl1_3_5: [
    {
      id: 'smb_ground',
      label: 'SMB Ground',
      description: 'Classic side-scroller ground tiles for simple flat SMB-style platforms.',
      surfaceLocalIndices: [24, 25, 26, 27],
      fillLocalIndices: [16, 17, 18, 19],
    },
  ],
};

function sortIndicesAscending(values: Iterable<number>): number[] {
  return Array.from(values).sort((left, right) => left - right);
}

function localIndicesToGids(tileset: TilesetConfig, localIndices: number[]): number[] {
  return localIndices.map((localIndex) => tileset.firstGid + localIndex);
}

function getCollisionIndicesByProfile(
  tileset: TilesetConfig,
  profileId: TerrainCollisionProfileId,
): number[] {
  const result = new Set<number>();
  for (const [localIndex, candidateProfileId] of Object.entries(tileset.terrainCollisionProfiles ?? {})) {
    if (candidateProfileId === profileId) {
      result.add(Number(localIndex));
    }
  }
  return sortIndicesAscending(result);
}

function buildCatalogEntry(tileset: TilesetConfig): AgentTilesetCatalogEntry {
  const decoratedTopLocalIndices = getCollisionIndicesByProfile(tileset, 'decoratedTop');
  const nonCollidingLocalIndices = getCollisionIndicesByProfile(tileset, 'none');
  const buildStyles = (AGENT_TILESET_BUILD_STYLE_DEFINITIONS[tileset.key] ?? []).map((definition) => ({
    ...definition,
    surfaceGids: localIndicesToGids(tileset, definition.surfaceLocalIndices),
    fillGids: localIndicesToGids(tileset, definition.fillLocalIndices),
  }));

  return {
    key: tileset.key,
    name: tileset.name,
    gidStart: tileset.firstGid,
    gidEnd: tileset.firstGid + tileset.tileCount - 1,
    decoratedTopLocalIndices,
    decoratedTopGids: localIndicesToGids(tileset, decoratedTopLocalIndices),
    nonCollidingLocalIndices,
    nonCollidingGids: localIndicesToGids(tileset, nonCollidingLocalIndices),
    buildStyles,
  };
}

const AGENT_TILESET_CATALOG = TILESETS.map(buildCatalogEntry);

export function getAgentTilesetCatalog(): AgentTilesetCatalogEntry[] {
  return AGENT_TILESET_CATALOG.map((entry) => ({
    ...entry,
    decoratedTopLocalIndices: [...entry.decoratedTopLocalIndices],
    decoratedTopGids: [...entry.decoratedTopGids],
    nonCollidingLocalIndices: [...entry.nonCollidingLocalIndices],
    nonCollidingGids: [...entry.nonCollidingGids],
    buildStyles: entry.buildStyles.map((style) => ({
      ...style,
      surfaceLocalIndices: [...style.surfaceLocalIndices],
      surfaceGids: [...style.surfaceGids],
      fillLocalIndices: [...style.fillLocalIndices],
      fillGids: [...style.fillGids],
    })),
  }));
}

export function getAgentTilesetCatalogEntry(key: string): AgentTilesetCatalogEntry | null {
  const entry = AGENT_TILESET_CATALOG.find((candidate) => candidate.key === key);
  if (!entry) {
    return null;
  }

  return {
    ...entry,
    decoratedTopLocalIndices: [...entry.decoratedTopLocalIndices],
    decoratedTopGids: [...entry.decoratedTopGids],
    nonCollidingLocalIndices: [...entry.nonCollidingLocalIndices],
    nonCollidingGids: [...entry.nonCollidingGids],
    buildStyles: entry.buildStyles.map((style) => ({
      ...style,
      surfaceLocalIndices: [...style.surfaceLocalIndices],
      surfaceGids: [...style.surfaceGids],
      fillLocalIndices: [...style.fillLocalIndices],
      fillGids: [...style.fillGids],
    })),
  };
}

export function getAgentTilesetCatalogResponse(): { tilesets: AgentTilesetCatalogEntry[] } {
  return {
    tilesets: getAgentTilesetCatalog(),
  };
}

interface TilesetUsageStats {
  totalTiles: number;
  surfaceCounts: Map<number, number>;
  fillCounts: Map<number, number>;
}

function sortGidsByFrequency(counts: Map<number, number>): number[] {
  return Array.from(counts.entries())
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }
      return left[0] - right[0];
    })
    .map(([gid]) => gid);
}

function resolveRecommendedBuildStyleId(
  tilesetKey: string,
  observedSurfaceGids: number[],
  observedFillGids: number[],
): string | null {
  const entry = AGENT_TILESET_CATALOG.find((candidate) => candidate.key === tilesetKey);
  if (!entry || entry.buildStyles.length === 0) {
    return null;
  }

  const observedSurfaceLocalIndices = new Set(
    observedSurfaceGids
      .filter((gid) => gid >= entry.gidStart && gid <= entry.gidEnd)
      .map((gid) => gid - entry.gidStart),
  );
  const observedFillLocalIndices = new Set(
    observedFillGids
      .filter((gid) => gid >= entry.gidStart && gid <= entry.gidEnd)
      .map((gid) => gid - entry.gidStart),
  );

  let bestStyleId: string | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const style of entry.buildStyles) {
    const surfaceMatches = style.surfaceLocalIndices.filter((localIndex) => observedSurfaceLocalIndices.has(localIndex)).length;
    const fillMatches = style.fillLocalIndices.filter((localIndex) => observedFillLocalIndices.has(localIndex)).length;
    const score = surfaceMatches * 3 + fillMatches * 2;
    if (score > bestScore) {
      bestStyleId = style.id;
      bestScore = score;
    }
  }

  return bestStyleId ?? entry.buildStyles[0]?.id ?? null;
}

export function buildRoomTilesetHint(room: RoomSnapshot): RoomTilesetHint | null {
  const usageByTilesetKey = new Map<string, TilesetUsageStats>();

  for (let tileY = 0; tileY < room.tileData.terrain.length; tileY += 1) {
    const row = room.tileData.terrain[tileY];
    for (let tileX = 0; tileX < row.length; tileX += 1) {
      const decoded = decodeTileDataValue(row[tileX] ?? -1);
      if (decoded.gid <= 0) {
        continue;
      }

      const tileset = getTilesetByGid(decoded.gid);
      if (!tileset) {
        continue;
      }

      let usage = usageByTilesetKey.get(tileset.key);
      if (!usage) {
        usage = {
          totalTiles: 0,
          surfaceCounts: new Map<number, number>(),
          fillCounts: new Map<number, number>(),
        };
        usageByTilesetKey.set(tileset.key, usage);
      }

      usage.totalTiles += 1;
      const aboveDecoded = tileY > 0 ? decodeTileDataValue(room.tileData.terrain[tileY - 1]?.[tileX] ?? -1) : { gid: -1, flipX: false, flipY: false };
      const counts = aboveDecoded.gid <= 0 ? usage.surfaceCounts : usage.fillCounts;
      counts.set(decoded.gid, (counts.get(decoded.gid) ?? 0) + 1);
    }
  }

  if (usageByTilesetKey.size === 0) {
    return null;
  }

  const tilesetsUsed = Array.from(usageByTilesetKey.entries())
    .sort((left, right) => {
      if (right[1].totalTiles !== left[1].totalTiles) {
        return right[1].totalTiles - left[1].totalTiles;
      }
      return TILESETS.findIndex((candidate) => candidate.key === left[0]) - TILESETS.findIndex((candidate) => candidate.key === right[0]);
    })
    .map(([tilesetKey]) => tilesetKey);

  const primaryTilesetKey = tilesetsUsed[0] ?? null;
  if (!primaryTilesetKey) {
    return null;
  }

  const primaryUsage = usageByTilesetKey.get(primaryTilesetKey);
  if (!primaryUsage) {
    return null;
  }

  const observedSurfaceGids = sortGidsByFrequency(primaryUsage.surfaceCounts);
  const observedFillGids = sortGidsByFrequency(primaryUsage.fillCounts);

  return {
    primaryTilesetKey,
    tilesetsUsed,
    observedSurfaceGids,
    observedFillGids,
    recommendedBuildStyleId: resolveRecommendedBuildStyleId(
      primaryTilesetKey,
      observedSurfaceGids,
      observedFillGids,
    ),
  };
}

export function annotateRoomSnapshotWithTilesetHint(room: RoomSnapshot): RoomSnapshot {
  return {
    ...cloneRoomSnapshot(room),
    tilesetHint: buildRoomTilesetHint(room),
  };
}

export function annotateRoomVersionRecordsWithTilesetHints(versions: RoomVersionRecord[]): RoomVersionRecord[] {
  return versions.map((version) => ({
    ...version,
    snapshot: annotateRoomSnapshotWithTilesetHint(version.snapshot),
  }));
}

export function annotateRoomRecordWithTilesetHints(record: RoomRecord): RoomRecord {
  return {
    ...record,
    draft: annotateRoomSnapshotWithTilesetHint(record.draft),
    published: record.published ? annotateRoomSnapshotWithTilesetHint(record.published) : null,
    versions: annotateRoomVersionRecordsWithTilesetHints(record.versions),
  };
}

function renderIndices(label: string, values: number[]): string {
  if (values.length === 0) {
    return `- ${label}: none`;
  }

  return `- ${label}: ${values.join(', ')}`;
}

function renderBuildStyle(style: AgentTilesetBuildStyle): string {
  return [
    `### \`${style.id}\``,
    '',
    `- Label: ${style.label}`,
    `- ${style.description}`,
    `- Surface local indices: ${style.surfaceLocalIndices.join(', ')}`,
    `- Surface gids: ${style.surfaceGids.join(', ')}`,
    `- Fill local indices: ${style.fillLocalIndices.join(', ')}`,
    `- Fill gids: ${style.fillGids.join(', ')}`,
    '',
  ].join('\n');
}

export function renderAgentTilesetMarkdown(): string {
  const sections = AGENT_TILESET_CATALOG.map((entry) => {
    const buildStyles = entry.buildStyles.length > 0
      ? entry.buildStyles.map(renderBuildStyle).join('')
      : '_No curated build styles yet. Use nearby room hints or the raw snapshot path for this tileset._\n\n';

    return [
      `## ${entry.name} \`${entry.key}\``,
      '',
      `- gid range: ${entry.gidStart}-${entry.gidEnd}`,
      renderIndices('Decorated-top local indices', entry.decoratedTopLocalIndices),
      renderIndices('Decorated-top gids', entry.decoratedTopGids),
      renderIndices('Non-colliding local indices', entry.nonCollidingLocalIndices),
      renderIndices('Non-colliding gids', entry.nonCollidingGids),
      '',
      buildStyles,
    ].join('\n');
  });

  return [
    '# Agent Tileset Reference',
    '',
    'This is the canonical agent-facing tileset catalog.',
    '',
    '## How terrain actually works',
    '',
    '- Any terrain gid `<= 0` is empty.',
    '- Positive terrain gids collide by default.',
    '- Transparency does not mean a tile is non-solid.',
    '- Only gids explicitly listed as non-colliding are safe decoration-only terrain.',
    '- The safest build path is: pick one tileset, use one named build style, then compose.',
    '',
    '## Use this with room hints',
    '',
    '- `GET /api/tilesets` returns the same catalog in JSON.',
    '- Room reads can include `tilesetHint` with the dominant tileset and observed surface/fill gids.',
    '- `POST /api/rooms/{roomId}/draft/commands` uses `tilesetKey` + `styleId`, not raw gids, for terrain commands.',
    '',
    ...sections,
  ].join('\n');
}
