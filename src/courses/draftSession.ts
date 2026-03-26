import {
  areCourseSnapshotsEquivalent,
  cloneCourseRecord,
  cloneCourseSnapshot,
  getCourseRoomOrder,
  type CourseRecord,
  type CourseSnapshot,
} from './model';
import { cloneRoomSnapshot, type RoomSnapshot } from '../persistence/roomModel';

let activeCourseRecord: CourseRecord | null = null;
let activePersistedCourseRecord: CourseRecord | null = null;
let activeSelectedRoomId: string | null = null;
let activeCourseRoomOverridesByRoomId = new Map<string, RoomSnapshot>();

function cloneRecordOrNull(record: CourseRecord | null): CourseRecord | null {
  return record ? cloneCourseRecord(record) : null;
}

function pruneActiveCourseRoomOverrides(): void {
  if (!activeCourseRecord) {
    activeCourseRoomOverridesByRoomId = new Map();
    return;
  }

  const activeRoomIds = new Set(activeCourseRecord.draft.roomRefs.map((roomRef) => roomRef.roomId));
  activeCourseRoomOverridesByRoomId = new Map(
    Array.from(activeCourseRoomOverridesByRoomId.entries()).filter(([roomId]) =>
      activeRoomIds.has(roomId)
    )
  );
}

export function clearActiveCourseDraftSession(): void {
  activeCourseRecord = null;
  activePersistedCourseRecord = null;
  activeSelectedRoomId = null;
  activeCourseRoomOverridesByRoomId = new Map();
}

export function getActiveCourseDraftSessionRecord(): CourseRecord | null {
  return cloneRecordOrNull(activeCourseRecord);
}

export function getActiveCourseDraftSessionDraft(): CourseSnapshot | null {
  return activeCourseRecord ? cloneCourseSnapshot(activeCourseRecord.draft) : null;
}

export function getActiveCourseDraftSessionPublished(): CourseSnapshot | null {
  return activeCourseRecord?.published ? cloneCourseSnapshot(activeCourseRecord.published) : null;
}

export function getActiveCourseDraftSessionCourseId(): string | null {
  return activeCourseRecord?.draft.id ?? null;
}

export function setActiveCourseDraftSessionRecord(
  record: CourseRecord | null,
  options: { selectedRoomId?: string | null } = {}
): CourseRecord | null {
  const previousCourseId = activeCourseRecord?.draft.id ?? null;
  activeCourseRecord = cloneRecordOrNull(record);
  activePersistedCourseRecord = cloneRecordOrNull(record);
  const nextCourseId = activeCourseRecord?.draft.id ?? null;
  if (previousCourseId !== nextCourseId) {
    activeCourseRoomOverridesByRoomId = new Map();
  } else {
    pruneActiveCourseRoomOverrides();
  }

  const nextSelectedRoomId = options.selectedRoomId ?? activeSelectedRoomId;
  if (
    activeCourseRecord &&
    nextSelectedRoomId &&
    getCourseRoomOrder(activeCourseRecord.draft.roomRefs, nextSelectedRoomId) >= 0
  ) {
    activeSelectedRoomId = nextSelectedRoomId;
  } else {
    activeSelectedRoomId = activeCourseRecord?.draft.roomRefs[0]?.roomId ?? null;
  }

  return cloneRecordOrNull(activeCourseRecord);
}

export function updateActiveCourseDraftSession(
  mutator: (draft: CourseSnapshot, record: CourseRecord) => void
): CourseRecord | null {
  if (!activeCourseRecord) {
    return null;
  }

  const nextRecord = cloneCourseRecord(activeCourseRecord);
  mutator(nextRecord.draft, nextRecord);
  nextRecord.draft.updatedAt = new Date().toISOString();
  activeCourseRecord = nextRecord;
  pruneActiveCourseRoomOverrides();
  if (
    activeSelectedRoomId &&
    getCourseRoomOrder(nextRecord.draft.roomRefs, activeSelectedRoomId) < 0
  ) {
    activeSelectedRoomId = nextRecord.draft.roomRefs[0]?.roomId ?? null;
  }

  return cloneCourseRecord(nextRecord);
}

export function setActiveCourseDraftSessionSelectedRoom(roomId: string | null): void {
  if (!activeCourseRecord) {
    activeSelectedRoomId = null;
    return;
  }

  if (roomId && getCourseRoomOrder(activeCourseRecord.draft.roomRefs, roomId) >= 0) {
    activeSelectedRoomId = roomId;
    return;
  }

  activeSelectedRoomId = activeCourseRecord.draft.roomRefs[0]?.roomId ?? null;
}

export function getActiveCourseDraftSessionSelectedRoomId(): string | null {
  if (
    activeCourseRecord &&
    activeSelectedRoomId &&
    getCourseRoomOrder(activeCourseRecord.draft.roomRefs, activeSelectedRoomId) >= 0
  ) {
    return activeSelectedRoomId;
  }

  return activeCourseRecord?.draft.roomRefs[0]?.roomId ?? null;
}

export function getActiveCourseDraftSessionSelectedRoomOrder(): number | null {
  const selectedRoomId = getActiveCourseDraftSessionSelectedRoomId();
  if (!activeCourseRecord || !selectedRoomId) {
    return null;
  }

  const order = getCourseRoomOrder(activeCourseRecord.draft.roomRefs, selectedRoomId);
  return order >= 0 ? order : null;
}

export function isRoomInActiveCourseDraftSession(roomId: string): boolean {
  return Boolean(
    activeCourseRecord && getCourseRoomOrder(activeCourseRecord.draft.roomRefs, roomId) >= 0
  );
}

export function getActiveCourseDraftSessionRoomOverride(roomId: string): RoomSnapshot | null {
  if (!isRoomInActiveCourseDraftSession(roomId)) {
    return null;
  }

  const snapshot = activeCourseRoomOverridesByRoomId.get(roomId);
  return snapshot ? cloneRoomSnapshot(snapshot) : null;
}

export function getActiveCourseDraftSessionRoomOverrides(): RoomSnapshot[] {
  pruneActiveCourseRoomOverrides();
  return Array.from(activeCourseRoomOverridesByRoomId.values()).map((room) =>
    cloneRoomSnapshot(room)
  );
}

export function setActiveCourseDraftSessionRoomOverride(room: RoomSnapshot): void {
  if (!isRoomInActiveCourseDraftSession(room.id)) {
    return;
  }

  activeCourseRoomOverridesByRoomId.set(room.id, cloneRoomSnapshot(room));
}

export function clearActiveCourseDraftSessionRoomOverride(roomId: string): void {
  activeCourseRoomOverridesByRoomId.delete(roomId);
}

export function isActiveCourseDraftSessionDirty(): boolean {
  if (!activeCourseRecord || !activePersistedCourseRecord) {
    return false;
  }

  return !areCourseSnapshotsEquivalent(
    activeCourseRecord.draft,
    activePersistedCourseRecord.draft
  );
}
