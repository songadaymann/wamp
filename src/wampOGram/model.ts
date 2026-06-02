import {
  cloneRoomSnapshot,
  type RoomSnapshot,
  type RoomStatus,
} from '../persistence/roomModel';

export const WAMP_O_GRAM_LABEL = 'Wamp-O-Gram';
export const WAMP_O_GRAM_MAX_TITLE_LENGTH = 60;
export const WAMP_O_GRAM_MAX_NAME_LENGTH = 40;
export const WAMP_O_GRAM_MAX_MESSAGE_LENGTH = 240;
export const WAMP_O_GRAM_MAX_OCCASION_LENGTH = 32;
export const WAMP_O_GRAM_MAX_EMAIL_LENGTH = 254;

export type WampOGramDeliveryStatus = 'draft' | 'queued' | 'sent' | 'failed';

export interface WampOGramPostcardFields {
  title: string | null;
  recipientName: string | null;
  recipientEmail: string | null;
  senderName: string | null;
  message: string | null;
  occasion: string | null;
}

export interface WampOGramCreateRequest {
  postcard: WampOGramPostcardFields;
  roomSnapshot: RoomSnapshot;
}

export interface WampOGramRecord extends WampOGramPostcardFields {
  id: string;
  slug: string;
  roomSnapshot: RoomSnapshot;
  sourceRoomId: string;
  sourceRoomVersion: number | null;
  sourceRoomStatus: RoomStatus;
  creatorUserId: string | null;
  creatorDisplayName: string | null;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
  deliveryStatus: WampOGramDeliveryStatus;
  deliveryError: string | null;
}

export interface WampOGramPublicRecord extends Omit<WampOGramRecord, 'recipientEmail' | 'deliveryError'> {
  recipientEmail: null;
  deliveryError: null;
}

export function normalizeWampOGramPostcardFields(value: unknown): WampOGramPostcardFields {
  const input = isObject(value) ? value : {};
  return {
    title: normalizeTextField(input.title, WAMP_O_GRAM_MAX_TITLE_LENGTH),
    recipientName: normalizeTextField(input.recipientName, WAMP_O_GRAM_MAX_NAME_LENGTH),
    recipientEmail: normalizeEmailField(input.recipientEmail),
    senderName: normalizeTextField(input.senderName, WAMP_O_GRAM_MAX_NAME_LENGTH),
    message: normalizeTextField(input.message, WAMP_O_GRAM_MAX_MESSAGE_LENGTH),
    occasion: normalizeTextField(input.occasion, WAMP_O_GRAM_MAX_OCCASION_LENGTH),
  };
}

export function normalizeWampOGramCreateRequest(value: unknown): WampOGramCreateRequest {
  if (!isObject(value)) {
    throw new Error('Request body must be an object.');
  }

  if (!isObject(value.roomSnapshot)) {
    throw new Error('roomSnapshot is required.');
  }

  const roomSnapshot = cloneRoomSnapshot(value.roomSnapshot as unknown as RoomSnapshot);
  const sourceRoomStatus = normalizeRoomStatus(roomSnapshot.status);
  roomSnapshot.status = sourceRoomStatus;

  return {
    postcard: normalizeWampOGramPostcardFields(value.postcard),
    roomSnapshot,
  };
}

export function makePublicWampOGramRecord(record: WampOGramRecord): WampOGramPublicRecord {
  return {
    ...record,
    recipientEmail: null,
    deliveryError: null,
    roomSnapshot: cloneRoomSnapshot(record.roomSnapshot),
  };
}

export function cloneWampOGramRecord(record: WampOGramRecord): WampOGramRecord {
  return {
    ...record,
    roomSnapshot: cloneRoomSnapshot(record.roomSnapshot),
  };
}

export function getWampOGramDisplayTitle(record: Pick<WampOGramRecord, 'title' | 'recipientName'>): string {
  if (record.title) {
    return record.title;
  }

  if (record.recipientName) {
    return `A ${WAMP_O_GRAM_LABEL} for ${record.recipientName}`;
  }

  return WAMP_O_GRAM_LABEL;
}

export function normalizeWampOGramSlug(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  const slug = value.trim();
  return /^[a-zA-Z0-9_-]{12,80}$/.test(slug) ? slug : '';
}

export function normalizeWampOGramDeliveryStatus(value: unknown): WampOGramDeliveryStatus {
  return value === 'queued' || value === 'sent' || value === 'failed' ? value : 'draft';
}

function normalizeTextField(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizeEmailField(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized.length > WAMP_O_GRAM_MAX_EMAIL_LENGTH) {
    throw new Error('Recipient email is too long.');
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error('Recipient email is invalid.');
  }

  return normalized;
}

function normalizeRoomStatus(value: unknown): RoomStatus {
  return value === 'published' ? 'published' : 'draft';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
