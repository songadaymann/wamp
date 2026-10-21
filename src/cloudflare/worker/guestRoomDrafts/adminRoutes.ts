import type { AdminGuestRoomDraft } from '../../../admin/model';
import { requireAdminRequest, requireTrustedOriginForMutation } from '../auth/request';
import { HttpError, jsonResponse } from '../core/http';
import type { Env } from '../core/types';

/**
 * Submitted guest rooms go public in Explore straight away (there is deliberately no
 * pre-approval queue), so admins hide them afterwards. Hiding only takes a room out of public
 * lists; the guest who made it keeps their own copy.
 */
export async function handleAdminGuestRoomDrafts(request: Request, url: URL, env: Env): Promise<Response> {
  requireTrustedOriginForMutation(request);
  requireAdminRequest(env, request, 'moderate guest rooms');
  if (url.pathname === '/api/admin/guest-room-drafts' && request.method === 'GET') {
    const rows = await env.DB.prepare(
      `SELECT id, title, guest_display_name, room_x, room_y, submitted_at, moderation_status
       FROM guest_room_drafts WHERE status = 'submitted'
       ORDER BY COALESCE(submitted_at, updated_at) DESC LIMIT 50`,
    ).all<{ id: string; title: string | null; guest_display_name: string; room_x: number; room_y: number;
      submitted_at: string | null; moderation_status: string }>();
    const drafts: AdminGuestRoomDraft[] = rows.results.map((row) => ({
      id: row.id, title: row.title, guestDisplayName: row.guest_display_name, roomX: row.room_x, roomY: row.room_y,
      submittedAt: row.submitted_at, hidden: row.moderation_status === 'hidden',
    }));
    return jsonResponse(request, { drafts }, { headers: { 'Cache-Control': 'no-store' } });
  }
  const match = /^\/api\/admin\/guest-room-drafts\/([^/]+)\/(hide|show)$/.exec(url.pathname);
  if (!match || request.method !== 'POST') throw new HttpError(404, 'Guest room admin route not found.');
  const hide = match[2] === 'hide';
  // updated_at stays as it is: a guest's own save and claim checks compare it.
  const changed = await env.DB.prepare(
    `UPDATE guest_room_drafts SET moderation_status = ?
     WHERE id = ? AND status = 'submitted' AND moderation_status = ? RETURNING id`,
  ).bind(hide ? 'hidden' : 'public', decodeURIComponent(match[1]), hide ? 'public' : 'hidden').first<{ id: string }>();
  if (!changed) throw new HttpError(404, hide ? 'No public guest room with that id.' : 'No hidden guest room with that id.');
  return jsonResponse(request, { id: decodeURIComponent(match[1]), hidden: hide }, { headers: { 'Cache-Control': 'no-store' } });
}
