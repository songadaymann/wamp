import { normalizePositiveInteger } from '../goals/roomGoals';
import {
  normalizeRoomTitle,
  roomIdFromCoordinates,
  type RoomCoordinates,
} from '../persistence/roomModel';

export const COURSE_GOAL_TYPES = [
  'reach_exit',
  'collect_target',
  'defeat_all',
  'checkpoint_sprint',
  'survival',
] as const;

export type CourseGoalType = typeof COURSE_GOAL_TYPES[number];
export type CourseStatus = 'draft' | 'published';

export interface CourseMarkerPoint {
  roomId: string;
  x: number;
  y: number;
}

export interface CourseRoomRef {
  roomId: string;
  coordinates: RoomCoordinates;
  roomVersion: number;
  roomTitle: string | null;
}

export interface CourseReachExitGoal {
  type: 'reach_exit';
  exit: CourseMarkerPoint | null;
  timeLimitMs: number | null;
}

export interface CourseCollectTargetGoal {
  type: 'collect_target';
  requiredCount: number;
  timeLimitMs: number | null;
}

export interface CourseDefeatAllGoal {
  type: 'defeat_all';
  timeLimitMs: number | null;
}

export interface CourseCheckpointSprintGoal {
  type: 'checkpoint_sprint';
  checkpoints: CourseMarkerPoint[];
  finish: CourseMarkerPoint | null;
  timeLimitMs: number | null;
}

export interface CourseSurvivalGoal {
  type: 'survival';
  durationMs: number;
}

export type CourseGoal =
  | CourseReachExitGoal
  | CourseCollectTargetGoal
  | CourseDefeatAllGoal
  | CourseCheckpointSprintGoal
  | CourseSurvivalGoal;

export interface CourseSnapshot {
  id: string;
  title: string | null;
  roomRefs: CourseRoomRef[];
  startPoint: CourseMarkerPoint | null;
  goal: CourseGoal | null;
  version: number;
  status: CourseStatus;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export interface CourseVersionRecord {
  version: number;
  snapshot: CourseSnapshot;
  createdAt: string;
  publishedByUserId: string | null;
  publishedByDisplayName: string | null;
}

export interface CoursePermissions {
  canSaveDraft: boolean;
  canPublish: boolean;
}

export interface CourseRecord {
  draft: CourseSnapshot;
  published: CourseSnapshot | null;
  versions: CourseVersionRecord[];
  ownerUserId: string | null;
  ownerDisplayName: string | null;
  permissions: CoursePermissions;
}

export interface CourseMembershipSummary {
  courseId: string;
  courseTitle: string | null;
  goalType: CourseGoalType | null;
  roomIndex: number;
  roomCount: number;
}

export const MAX_COURSE_TITLE_LENGTH = 40;
export const MAX_COURSE_ROOMS = 4;
export const MIN_COURSE_ROOMS = 2;

export const COURSE_GOAL_LABELS: Record<CourseGoalType, string> = {
  reach_exit: 'Reach Exit',
  collect_target: 'Collect Target',
  defeat_all: 'Defeat All',
  checkpoint_sprint: 'Checkpoint Sprint',
  survival: 'Survival',
};

export function normalizeCourseTitle(value: unknown): string | null {
  const normalized = normalizeRoomTitle(value);
  if (!normalized) {
    return null;
  }

  return normalized.slice(0, MAX_COURSE_TITLE_LENGTH);
}

export function createCourseId(): string {
  return crypto.randomUUID();
}

export function createDefaultCoursePermissions(): CoursePermissions {
  return {
    canSaveDraft: true,
    canPublish: true,
  };
}

export function createDefaultCourseGoal(type: CourseGoalType): CourseGoal {
  switch (type) {
    case 'reach_exit':
      return {
        type,
        exit: null,
        timeLimitMs: null,
      };
    case 'collect_target':
      return {
        type,
        requiredCount: 5,
        timeLimitMs: null,
      };
    case 'defeat_all':
      return {
        type,
        timeLimitMs: null,
      };
    case 'checkpoint_sprint':
      return {
        type,
        checkpoints: [],
        finish: null,
        timeLimitMs: null,
      };
    case 'survival':
      return {
        type,
        durationMs: 30_000,
      };
  }
}

export function createDefaultCourseSnapshot(
  courseId: string = createCourseId()
): CourseSnapshot {
  const now = new Date().toISOString();
  return {
    id: courseId,
    title: null,
    roomRefs: [],
    startPoint: null,
    goal: null,
    version: 1,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    publishedAt: null,
  };
}

export function areCourseRoomRefsOrthogonallyAdjacent(
  left: Pick<CourseRoomRef, 'coordinates'>,
  right: Pick<CourseRoomRef, 'coordinates'>
): boolean {
  const dx = Math.abs(left.coordinates.x - right.coordinates.x);
  const dy = Math.abs(left.coordinates.y - right.coordinates.y);
  return dx + dy === 1;
}

export function courseRoomRefsHaveUniqueRoomIds(roomRefs: CourseRoomRef[]): boolean {
  const seen = new Set<string>();
  for (const roomRef of roomRefs) {
    if (seen.has(roomRef.roomId)) {
      return false;
    }
    seen.add(roomRef.roomId);
  }

  return true;
}

export function courseRoomRefsFollowLinearPath(roomRefs: CourseRoomRef[]): boolean {
  if (roomRefs.length <= 1) {
    return true;
  }

  if (!courseRoomRefsHaveUniqueRoomIds(roomRefs)) {
    return false;
  }

  for (let index = 1; index < roomRefs.length; index += 1) {
    if (!areCourseRoomRefsOrthogonallyAdjacent(roomRefs[index - 1], roomRefs[index])) {
      return false;
    }
  }

  return true;
}

export function getCourseRoomOrder(roomRefs: CourseRoomRef[], roomId: string): number {
  return roomRefs.findIndex((roomRef) => roomRef.roomId === roomId);
}

export function cloneCourseMarkerPoint(point: CourseMarkerPoint): CourseMarkerPoint {
  return {
    roomId: point.roomId,
    x: point.x,
    y: point.y,
  };
}

export function cloneCourseRoomRef(roomRef: CourseRoomRef): CourseRoomRef {
  return {
    roomId: roomRef.roomId,
    coordinates: { ...roomRef.coordinates },
    roomVersion: roomRef.roomVersion,
    roomTitle: normalizeRoomTitle(roomRef.roomTitle),
  };
}

export function cloneCourseGoal(goal: CourseGoal | null): CourseGoal | null {
  if (!goal) {
    return null;
  }

  switch (goal.type) {
    case 'reach_exit':
      return {
        type: goal.type,
        exit: goal.exit ? cloneCourseMarkerPoint(goal.exit) : null,
        timeLimitMs: goal.timeLimitMs,
      };
    case 'collect_target':
      return {
        type: goal.type,
        requiredCount: goal.requiredCount,
        timeLimitMs: goal.timeLimitMs,
      };
    case 'defeat_all':
      return {
        type: goal.type,
        timeLimitMs: goal.timeLimitMs,
      };
    case 'checkpoint_sprint':
      return {
        type: goal.type,
        checkpoints: goal.checkpoints.map(cloneCourseMarkerPoint),
        finish: goal.finish ? cloneCourseMarkerPoint(goal.finish) : null,
        timeLimitMs: goal.timeLimitMs,
      };
    case 'survival':
      return {
        type: goal.type,
        durationMs: goal.durationMs,
      };
  }
}

export function cloneCourseSnapshot(snapshot: CourseSnapshot): CourseSnapshot {
  return {
    ...snapshot,
    title: normalizeCourseTitle(snapshot.title),
    roomRefs: snapshot.roomRefs.map(cloneCourseRoomRef),
    startPoint: snapshot.startPoint ? cloneCourseMarkerPoint(snapshot.startPoint) : null,
    goal: cloneCourseGoal(snapshot.goal),
  };
}

export function createCourseVersionRecord(
  snapshot: CourseSnapshot,
  overrides: Partial<Omit<CourseVersionRecord, 'snapshot'>> = {}
): CourseVersionRecord {
  return {
    version: overrides.version ?? snapshot.version,
    snapshot: cloneCourseSnapshot(snapshot),
    createdAt: overrides.createdAt ?? snapshot.publishedAt ?? snapshot.updatedAt,
    publishedByUserId: overrides.publishedByUserId ?? null,
    publishedByDisplayName: overrides.publishedByDisplayName ?? null,
  };
}

export function cloneCourseVersionRecord(version: CourseVersionRecord): CourseVersionRecord {
  return {
    ...version,
    snapshot: cloneCourseSnapshot(version.snapshot),
  };
}

export function cloneCourseRecord(record: CourseRecord): CourseRecord {
  return {
    draft: cloneCourseSnapshot(record.draft),
    published: record.published ? cloneCourseSnapshot(record.published) : null,
    versions: record.versions.map(cloneCourseVersionRecord),
    ownerUserId: record.ownerUserId,
    ownerDisplayName: record.ownerDisplayName,
    permissions: { ...record.permissions },
  };
}

export function createDefaultCourseRecord(courseId: string = createCourseId()): CourseRecord {
  return {
    draft: createDefaultCourseSnapshot(courseId),
    published: null,
    versions: [],
    ownerUserId: null,
    ownerDisplayName: null,
    permissions: createDefaultCoursePermissions(),
  };
}

export function getComparableCourseSnapshot(snapshot: CourseSnapshot) {
  return {
    title: snapshot.title,
    roomRefs: snapshot.roomRefs.map((roomRef) => ({
      roomId: roomRef.roomId,
      coordinates: roomRef.coordinates,
      roomVersion: roomRef.roomVersion,
      roomTitle: roomRef.roomTitle,
    })),
    startPoint: snapshot.startPoint,
    goal: snapshot.goal,
  };
}

export function areCourseSnapshotsEquivalent(
  left: CourseSnapshot,
  right: CourseSnapshot
): boolean {
  return JSON.stringify(getComparableCourseSnapshot(left)) === JSON.stringify(getComparableCourseSnapshot(right));
}

function isRoomCoordinatesLike(value: unknown): value is RoomCoordinates {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const coordinates = value as Partial<RoomCoordinates>;
  return (
    typeof coordinates.x === 'number' &&
    Number.isFinite(coordinates.x) &&
    typeof coordinates.y === 'number' &&
    Number.isFinite(coordinates.y)
  );
}

function isCourseMarkerPointLike(value: unknown): value is CourseMarkerPoint {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const point = value as Partial<CourseMarkerPoint>;
  return (
    typeof point.roomId === 'string' &&
    point.roomId.trim().length > 0 &&
    typeof point.x === 'number' &&
    Number.isFinite(point.x) &&
    typeof point.y === 'number' &&
    Number.isFinite(point.y)
  );
}

export function normalizeCourseGoal(value: unknown): CourseGoal | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const goal = value as Partial<CourseGoal> & {
    checkpoints?: unknown;
    finish?: unknown;
    exit?: unknown;
  };

  switch (goal.type) {
    case 'reach_exit':
      return {
        type: 'reach_exit',
        exit: isCourseMarkerPointLike(goal.exit) ? cloneCourseMarkerPoint(goal.exit) : null,
        timeLimitMs: normalizePositiveInteger(goal.timeLimitMs),
      };
    case 'collect_target':
      return {
        type: 'collect_target',
        requiredCount: normalizePositiveInteger(goal.requiredCount) ?? 1,
        timeLimitMs: normalizePositiveInteger(goal.timeLimitMs),
      };
    case 'defeat_all':
      return {
        type: 'defeat_all',
        timeLimitMs: normalizePositiveInteger(goal.timeLimitMs),
      };
    case 'checkpoint_sprint':
      return {
        type: 'checkpoint_sprint',
        checkpoints: Array.isArray(goal.checkpoints)
          ? goal.checkpoints.filter(isCourseMarkerPointLike).map(cloneCourseMarkerPoint)
          : [],
        finish: isCourseMarkerPointLike(goal.finish) ? cloneCourseMarkerPoint(goal.finish) : null,
        timeLimitMs: normalizePositiveInteger(goal.timeLimitMs),
      };
    case 'survival':
      return {
        type: 'survival',
        durationMs: normalizePositiveInteger(goal.durationMs) ?? 30_000,
      };
    default:
      return null;
  }
}

export function normalizeCourseRoomRef(value: unknown): CourseRoomRef | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const roomRef = value as Partial<CourseRoomRef>;
  const roomId =
    typeof roomRef.roomId === 'string' && roomRef.roomId.trim()
      ? roomRef.roomId.trim()
      : isRoomCoordinatesLike(roomRef.coordinates)
        ? roomIdFromCoordinates(roomRef.coordinates)
        : null;

  if (!roomId || !isRoomCoordinatesLike(roomRef.coordinates)) {
    return null;
  }

  const roomVersion = normalizePositiveInteger(roomRef.roomVersion) ?? 1;

  return {
    roomId,
    coordinates: { ...roomRef.coordinates },
    roomVersion,
    roomTitle: normalizeRoomTitle(roomRef.roomTitle),
  };
}

function isCourseSnapshotLike(value: unknown): value is CourseSnapshot {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const snapshot = value as Partial<CourseSnapshot>;
  return Boolean(
    typeof snapshot.id === 'string' &&
      Array.isArray(snapshot.roomRefs) &&
      ('startPoint' in snapshot ? true : true) &&
      typeof snapshot.version === 'number'
  );
}

export function normalizeCourseSnapshot(
  value: unknown,
  fallbackCourseId: string
): CourseSnapshot {
  const base = createDefaultCourseSnapshot(fallbackCourseId);
  if (!isCourseSnapshotLike(value)) {
    return base;
  }

  const snapshot = value as Partial<CourseSnapshot>;
  return {
    id: typeof snapshot.id === 'string' && snapshot.id.trim() ? snapshot.id.trim() : fallbackCourseId,
    title: normalizeCourseTitle(snapshot.title),
    roomRefs: Array.isArray(snapshot.roomRefs)
      ? snapshot.roomRefs
          .map((roomRef) => normalizeCourseRoomRef(roomRef))
          .filter((roomRef): roomRef is CourseRoomRef => roomRef !== null)
      : [],
    startPoint: isCourseMarkerPointLike(snapshot.startPoint)
      ? cloneCourseMarkerPoint(snapshot.startPoint)
      : null,
    goal: normalizeCourseGoal(snapshot.goal),
    version: normalizePositiveInteger(snapshot.version) ?? 1,
    status: snapshot.status === 'published' ? 'published' : 'draft',
    createdAt: typeof snapshot.createdAt === 'string' ? snapshot.createdAt : base.createdAt,
    updatedAt: typeof snapshot.updatedAt === 'string' ? snapshot.updatedAt : base.updatedAt,
    publishedAt:
      typeof snapshot.publishedAt === 'string' && snapshot.publishedAt.trim()
        ? snapshot.publishedAt
        : null,
  };
}

export function normalizeCourseVersionRecord(value: unknown): CourseVersionRecord | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const versionRecord = value as Partial<CourseVersionRecord> & { snapshot?: unknown };
  if (!isCourseSnapshotLike(versionRecord.snapshot)) {
    return null;
  }

  const snapshot = normalizeCourseSnapshot(versionRecord.snapshot, versionRecord.snapshot.id);
  return {
    version: normalizePositiveInteger(versionRecord.version) ?? snapshot.version,
    snapshot,
    createdAt:
      typeof versionRecord.createdAt === 'string'
        ? versionRecord.createdAt
        : snapshot.publishedAt ?? snapshot.updatedAt,
    publishedByUserId:
      typeof versionRecord.publishedByUserId === 'string'
        ? versionRecord.publishedByUserId
        : null,
    publishedByDisplayName:
      typeof versionRecord.publishedByDisplayName === 'string'
        ? versionRecord.publishedByDisplayName
        : null,
  };
}

export function normalizeCourseRecord(value: unknown, fallbackCourseId: string): CourseRecord {
  if (!value || typeof value !== 'object') {
    return createDefaultCourseRecord(fallbackCourseId);
  }

  const record = value as Partial<CourseRecord>;
  const draft = normalizeCourseSnapshot(record.draft, fallbackCourseId);
  const published = isCourseSnapshotLike(record.published)
    ? normalizeCourseSnapshot(record.published, draft.id)
    : null;

  return {
    draft,
    published,
    versions: Array.isArray(record.versions)
      ? record.versions
          .map((version) => normalizeCourseVersionRecord(version))
          .filter((version): version is CourseVersionRecord => version !== null)
      : [],
    ownerUserId: typeof record.ownerUserId === 'string' ? record.ownerUserId : null,
    ownerDisplayName:
      typeof record.ownerDisplayName === 'string' ? record.ownerDisplayName : null,
    permissions: {
      canSaveDraft: record.permissions?.canSaveDraft ?? true,
      canPublish: record.permissions?.canPublish ?? true,
    },
  };
}
