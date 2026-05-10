export const GUESTBOOK_DISPLAY_NAME_MAX_LENGTH = 32;
export const GUESTBOOK_MESSAGE_MAX_LENGTH = 280;
export const DEFAULT_GUESTBOOK_LIMIT = 40;
export const MAX_GUESTBOOK_LIMIT = 80;

export interface GuestbookEntry {
  id: string;
  displayName: string;
  body: string;
  createdAt: string;
  signedIn: boolean;
}

export interface GuestbookConfigResponse {
  turnstileSiteKey: string | null;
  turnstileRequired: boolean;
}

export interface GuestbookListResponse {
  entries: GuestbookEntry[];
  config: GuestbookConfigResponse;
}

export interface GuestbookCreateRequestBody {
  displayName: string;
  body: string;
  guestSessionId?: string | null;
  turnstileToken?: string | null;
}

export interface GuestbookCreateResponse {
  entry: GuestbookEntry;
  config: GuestbookConfigResponse;
}

export interface GuestbookDeleteResponse {
  ok: true;
  entryId: string;
}
