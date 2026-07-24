import type { CourseGoalType } from '../courses/model';
import type { RoomGoalType } from '../goals/roomGoals';
import type { RoomCoordinates } from '../persistence/roomModel';
import type { TrustTier } from '../progression/model';

export type ExpandedRoomSource = 'native_expanded_room' | 'standalone_room' | 'legacy_course';
export type ExpandedRoomGoalType = CourseGoalType | RoomGoalType;

export interface ExpandedRoomMembershipSummary {
  expandedRoomId: string;
  title: string | null;
  goalType: ExpandedRoomGoalType | null;
  cellCount: number;
  source: ExpandedRoomSource;
  legacyCourseId: string | null;
}

export interface ExpandedRoomCellMembership extends ExpandedRoomMembershipSummary {
  roomId: string;
  coordinates: RoomCoordinates;
  roomVersion: number | null;
  roomTitle: string | null;
  protectedMinted: boolean;
}

export interface ExpandedRoomCellRef {
  roomId: string;
  coordinates: RoomCoordinates;
  roomVersion: number | null;
  roomTitle: string | null;
  protectedMinted: boolean;
}

export interface ResolvedExpandedRoomTarget extends ExpandedRoomMembershipSummary {
  ownerUserId: string | null;
  ownerDisplayName: string | null;
  anchorRoomId: string;
  anchorCoordinates: RoomCoordinates;
  focusedCoordinates: RoomCoordinates | null;
  version: number | null;
  publishedAt: string | null;
  cells: ExpandedRoomCellRef[];
}

export interface ExpandedRoomFootprintCell {
  roomId: string;
  coordinates: RoomCoordinates;
  protectedMinted?: boolean;
}

export const EXPANDED_ROOM_CELL_LIMITS_BY_TRUST_TIER: Record<TrustTier, number> = {
  T0: 1,
  T1: 2,
  T2: 4,
  T3: 9,
  T4: 16,
};

export function getExpandedRoomCellLimitForTrustTier(trustTier: TrustTier): number {
  return EXPANDED_ROOM_CELL_LIMITS_BY_TRUST_TIER[trustTier];
}

export function expandedRoomIdFromLegacyCourseId(courseId: string): string {
  return `course:${courseId}`;
}

export function expandedRoomIdFromStandaloneRoomId(roomId: string): string {
  return `room:${roomId}`;
}

export function createExpandedRoomSummaryFromLegacyCourse(input: {
  courseId: string;
  courseTitle: string | null;
  goalType: CourseGoalType | null;
  roomCount: number;
}): ExpandedRoomMembershipSummary {
  return {
    expandedRoomId: expandedRoomIdFromLegacyCourseId(input.courseId),
    title: input.courseTitle,
    goalType: input.goalType,
    cellCount: input.roomCount,
    source: 'legacy_course',
    legacyCourseId: input.courseId,
  };
}

export function createExpandedRoomSummaryFromStandaloneRoom(input: {
  roomId: string;
  roomTitle: string | null;
  goalType: RoomGoalType | null;
}): ExpandedRoomMembershipSummary {
  return {
    expandedRoomId: expandedRoomIdFromStandaloneRoomId(input.roomId),
    title: input.roomTitle,
    goalType: input.goalType,
    cellCount: 1,
    source: 'standalone_room',
    legacyCourseId: null,
  };
}

export function createExpandedRoomSummaryFromResolvedTarget(
  target: ResolvedExpandedRoomTarget
): ExpandedRoomMembershipSummary {
  return {
    expandedRoomId: target.expandedRoomId,
    title: target.title,
    goalType: target.goalType,
    cellCount: target.cellCount,
    source: target.source,
    legacyCourseId: target.legacyCourseId,
  };
}

export function isExpandedRoomGoalType(value: unknown): value is ExpandedRoomGoalType {
  return (
    value === 'reach_exit' ||
    value === 'collect_target' ||
    value === 'collect_race' ||
    value === 'defeat_all' ||
    value === 'checkpoint_sprint' ||
    value === 'survival' ||
    value === 'npc_quest'
  );
}

export function expandedRoomFootprintIsConnected(cells: ExpandedRoomFootprintCell[]): boolean {
  if (cells.length <= 1) {
    return true;
  }

  const cellsById = new Map(cells.map((cell) => [cell.roomId, cell]));
  const visited = new Set<string>();
  const queue: string[] = [cells[0].roomId];
  visited.add(cells[0].roomId);

  while (queue.length > 0) {
    const roomId = queue.shift();
    const cell = roomId ? cellsById.get(roomId) : null;
    if (!cell) {
      continue;
    }

    for (const neighbor of getExpandedRoomOrthogonalNeighborIds(cell.coordinates)) {
      if (!cellsById.has(neighbor) || visited.has(neighbor)) {
        continue;
      }
      visited.add(neighbor);
      queue.push(neighbor);
    }
  }

  return visited.size === cells.length;
}

export function getExpandedRoomFootprintValidationError(
  cells: ExpandedRoomFootprintCell[],
  cellLimit: number,
): string | null {
  if (cells.length === 0) {
    return 'Expanded rooms need at least one cell.';
  }
  if (cells.length > cellLimit) {
    return `Expanded rooms can use at most ${cellLimit} cell${cellLimit === 1 ? '' : 's'} at this tier.`;
  }
  return expandedRoomFootprintIsConnected(cells)
    ? null
    : 'Expanded room cells must stay connected.';
}

export function getExpandedRoomCellRemovalError(
  cells: ExpandedRoomFootprintCell[],
  roomId: string,
  anchorRoomId: string,
): string | null {
  const cell = cells.find((candidate) => candidate.roomId === roomId) ?? null;
  if (!cell) {
    return 'Cell is not part of this expanded room.';
  }
  if (roomId === anchorRoomId) {
    return 'Anchor cells cannot be removed.';
  }
  if (cell.protectedMinted) {
    return 'Minted protected cells cannot be removed.';
  }

  const remaining = cells.filter((candidate) => candidate.roomId !== roomId);
  return expandedRoomFootprintIsConnected(remaining)
    ? null
    : 'Removing this cell would split the expanded room.';
}

function getExpandedRoomOrthogonalNeighborIds(coordinates: RoomCoordinates): string[] {
  return [
    `${coordinates.x + 1},${coordinates.y}`,
    `${coordinates.x - 1},${coordinates.y}`,
    `${coordinates.x},${coordinates.y + 1}`,
    `${coordinates.x},${coordinates.y - 1}`,
  ];
}
