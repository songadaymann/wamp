import { apiRequest } from '../api/request';
import type {
  GuestbookCreateRequestBody,
  GuestbookCreateResponse,
  GuestbookDeleteResponse,
  GuestbookListResponse,
} from './model';

export function fetchGuestbookEntries(limit = 40): Promise<GuestbookListResponse> {
  return apiRequest<GuestbookListResponse>(`/api/guestbook?limit=${encodeURIComponent(String(limit))}`);
}

export function signGuestbook(body: GuestbookCreateRequestBody): Promise<GuestbookCreateResponse> {
  return apiRequest<GuestbookCreateResponse>('/api/guestbook', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function hideGuestbookEntry(entryId: string): Promise<GuestbookDeleteResponse> {
  return apiRequest<GuestbookDeleteResponse>(`/api/guestbook/entries/${encodeURIComponent(entryId)}`, {
    method: 'DELETE',
  });
}
