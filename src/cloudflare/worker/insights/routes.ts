import type { RoomInsightTarget, RoomInsightsResponse } from '../../../insights/model';
import { emptyInsightSummary, insightTargetKey } from '../../../insights/model';
import type { RoomCoordinates } from '../../../persistence/roomModel';
import type { Env } from '../core/types';
import { HttpError, jsonResponse } from '../core/http';
import { loadInsightDeathMap, loadInsightSummaries } from './store';

interface Metadata { target: RoomInsightTarget; title: string | null; cells: RoomCoordinates[] }
interface PublishedRow { id: string; published_json: string; published_version?: number; legacy_course_id?: string | null }
interface VersionRow { snapshot_json: string }
export async function resolveInsightMetadata(env: Env, input: RoomInsightTarget): Promise<Metadata> {
  const { contentType, contentId } = input;
  if (contentType === 'expanded_room' && contentId.startsWith('room:')) return resolveInsightMetadata(env, { ...input, contentType: 'room', contentId: contentId.slice(5) });
  if (contentType === 'expanded_room' && contentId.startsWith('course:')) return resolveInsightMetadata(env, { ...input, contentType: 'course', contentId: contentId.slice(7) });
  let row: PublishedRow | null;
  if (contentType === 'room') row = await env.DB.prepare('SELECT id,published_json FROM rooms WHERE id = ? AND published_json IS NOT NULL').bind(contentId).first<PublishedRow>();
  else if (contentType === 'course') row = await env.DB.prepare('SELECT id,published_json,published_version FROM courses WHERE id = ? AND published_json IS NOT NULL').bind(contentId).first<PublishedRow>();
  else row = await env.DB.prepare('SELECT id,published_json,published_version,legacy_course_id FROM expanded_rooms WHERE id = ? AND published_json IS NOT NULL AND archived_at IS NULL').bind(contentId).first<PublishedRow>();
  if (!row) throw new HttpError(404, 'Published level not found.');
  const published = JSON.parse(row.published_json) as { version: number };
  const version = input.version ?? row.published_version ?? published.version;
  const table = contentType === 'room' ? 'room_versions' : contentType === 'course' ? 'course_versions' : 'expanded_room_versions';
  const idColumn = contentType === 'room' ? 'room_id' : contentType === 'course' ? 'course_id' : 'expanded_room_id';
  const stored = await env.DB.prepare(`SELECT snapshot_json FROM ${table} WHERE ${idColumn} = ? AND version = ?`).bind(contentId,version).first<VersionRow>();
  if (!stored) throw new HttpError(404, 'Published level version not found.');
  const snapshot = JSON.parse(stored.snapshot_json) as { title: string | null; coordinates?: RoomCoordinates; roomRefs?: { coordinates: RoomCoordinates }[] };
  let target: RoomInsightTarget = { ...input, version };
  let cells = contentType === 'room' ? [snapshot.coordinates!] : snapshot.roomRefs?.map(ref => ref.coordinates) ?? [];
  if (contentType === 'course') {
    const native = await env.DB.prepare('SELECT id FROM expanded_rooms WHERE legacy_course_id = ?').bind(contentId).first<{ id: string }>();
    target = { contentType: 'expanded_room', contentId: native?.id ?? `course:${contentId}`, version };
  } else if (contentType === 'expanded_room') {
    const rows = await env.DB.prepare('SELECT room_x AS x,room_y AS y FROM expanded_room_cells WHERE expanded_room_id = ? AND expanded_room_version = ? ORDER BY cell_order').bind(contentId,version).all<RoomCoordinates>();
    cells = rows.results;
  }
  return { target, title: snapshot.title ?? null, cells };
}
export async function handleRoomInsights(request: Request, url: URL, env: Env, type: RoomInsightTarget['contentType'], id: string): Promise<Response> {
  const raw = url.searchParams.get('version'); const version = raw === null ? undefined : Number(raw);
  if (version !== undefined && (!Number.isSafeInteger(version) || version < 1)) throw new HttpError(400, 'Choose a published version.');
  const db = env.DB.withSession?.('first-primary') ?? env.DB;
  const context = { ...env, DB: db };
  const metadata = await resolveInsightMetadata(context, { contentType: type, contentId: id, version });
  const [summaries,map] = await Promise.all([loadInsightSummaries(context,[metadata.target]),loadInsightDeathMap(context,metadata.target)]);
  const result: RoomInsightsResponse = { ...metadata, summary: summaries.get(`${insightTargetKey(metadata.target)}:${metadata.target.version}`) ?? emptyInsightSummary(), ...map };
  return jsonResponse(request,result,{ headers: { 'Cache-Control': 'public, max-age=30' } });
}
