import type { PostRunRatingRequestDetail } from './postRunRatingEvents';

const STORAGE_KEY = 'wamp_guest_run_progress_v1';
const MAX_RECORDS = 50;
const ROOM_CLEAR_POTENTIAL_PXP = 20;
const COURSE_CLEAR_POTENTIAL_PXP = 40;
const EXPANDED_ROOM_CLEAR_POTENTIAL_PXP = COURSE_CLEAR_POTENTIAL_PXP;

export interface GuestRunProgressRecord {
  id: string;
  contentType: PostRunRatingRequestDetail['contentType'];
  contentId: string;
  contentTitle: string | null;
  version: number;
  elapsedMs: number;
  deaths: number;
  score: number | null;
  potentialPxp: number;
  completedAt: string;
}

export interface GuestRunProgressSummary {
  latest: GuestRunProgressRecord | null;
  records: GuestRunProgressRecord[];
  totalClears: number;
  roomClears: number;
  courseClears: number;
  expandedRoomClears: number;
  potentialPxp: number;
}

interface StoredGuestRunProgress {
  records?: unknown;
}

export function recordGuestRunClear(
  detail: PostRunRatingRequestDetail,
  now: Date = new Date(),
): GuestRunProgressSummary {
  const record: GuestRunProgressRecord = {
    id: buildRecordId(detail, now),
    contentType: detail.contentType,
    contentId: detail.contentId,
    contentTitle: normalizeTitle(detail.contentTitle),
    version: detail.version,
    elapsedMs: Math.max(0, Math.round(detail.elapsedMs)),
    deaths: Math.max(0, Math.round(detail.deaths)),
    score: typeof detail.score === 'number' ? Math.round(detail.score) : null,
    potentialPxp: getPotentialPxp(detail.contentType),
    completedAt: now.toISOString(),
  };

  const storage = getStorage();
  if (!storage) {
    return summarizeRecords([record], record);
  }

  const records = [record, ...readRecords(storage)].slice(0, MAX_RECORDS);
  writeRecords(storage, records);
  return summarizeRecords(records, record);
}

export function loadGuestRunProgress(): GuestRunProgressSummary {
  const storage = getStorage();
  return summarizeRecords(storage ? readRecords(storage) : [], null);
}

function getPotentialPxp(contentType: PostRunRatingRequestDetail['contentType']): number {
  if (contentType === 'expanded_room') {
    return EXPANDED_ROOM_CLEAR_POTENTIAL_PXP;
  }
  return contentType === 'course' ? COURSE_CLEAR_POTENTIAL_PXP : ROOM_CLEAR_POTENTIAL_PXP;
}

function buildRecordId(detail: PostRunRatingRequestDetail, now: Date): string {
  const score = typeof detail.score === 'number' ? String(Math.round(detail.score)) : 'none';
  return [
    detail.contentType,
    detail.contentId,
    detail.version,
    Math.round(detail.elapsedMs),
    Math.round(detail.deaths),
    score,
    now.getTime().toString(36),
  ].join(':');
}

function normalizeTitle(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? '';
  return normalized.length > 0 ? normalized.slice(0, 80) : null;
}

function summarizeRecords(
  records: GuestRunProgressRecord[],
  latest: GuestRunProgressRecord | null,
): GuestRunProgressSummary {
  let roomClears = 0;
  let courseClears = 0;
  let expandedRoomClears = 0;
  let potentialPxp = 0;

  for (const record of records) {
    if (record.contentType === 'expanded_room') {
      expandedRoomClears += 1;
    } else if (record.contentType === 'course') {
      courseClears += 1;
    } else {
      roomClears += 1;
    }
    potentialPxp += record.potentialPxp;
  }

  return {
    latest,
    records,
    totalClears: records.length,
    roomClears,
    courseClears,
    expandedRoomClears,
    potentialPxp,
  };
}

function readRecords(storage: Storage): GuestRunProgressRecord[] {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as StoredGuestRunProgress;
    if (!Array.isArray(parsed.records)) {
      return [];
    }

    return parsed.records
      .map(normalizeRecord)
      .filter((record): record is GuestRunProgressRecord => record !== null)
      .slice(0, MAX_RECORDS);
  } catch {
    return [];
  }
}

function writeRecords(storage: Storage, records: GuestRunProgressRecord[]): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ records }));
  } catch {
    // Guest progress is a conversion aid; storage failures must not interrupt play.
  }
}

function normalizeRecord(value: unknown): GuestRunProgressRecord | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Partial<GuestRunProgressRecord>;
  if (
    typeof record.id !== 'string' ||
    (record.contentType !== 'room' && record.contentType !== 'course' && record.contentType !== 'expanded_room') ||
    typeof record.contentId !== 'string' ||
    typeof record.version !== 'number' ||
    typeof record.elapsedMs !== 'number' ||
    typeof record.deaths !== 'number' ||
    typeof record.potentialPxp !== 'number' ||
    typeof record.completedAt !== 'string'
  ) {
    return null;
  }

  return {
    id: record.id,
    contentType: record.contentType,
    contentId: record.contentId,
    contentTitle: normalizeTitle(record.contentTitle),
    version: record.version,
    elapsedMs: Math.max(0, Math.round(record.elapsedMs)),
    deaths: Math.max(0, Math.round(record.deaths)),
    score: typeof record.score === 'number' ? Math.round(record.score) : null,
    potentialPxp: Math.max(0, Math.round(record.potentialPxp)),
    completedAt: record.completedAt,
  };
}

function getStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
