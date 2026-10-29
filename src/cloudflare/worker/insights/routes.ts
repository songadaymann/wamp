import { ensureInsightRoomFacts, insightEquivalentVersions, previousInsightLayout } from './lineage';
import type { RoomInsightTarget, RoomInsightsResponse, RoomInsightVersionStats } from '../../../insights/model';
import { emptyInsightSummary, insightTargetKey } from '../../../insights/model';
import type { RoomCoordinates } from '../../../persistence/roomModel';
import type { Env } from '../core/types';
import { HttpError, jsonResponse } from '../core/http';
import { loadInsightDeathMap, loadInsightSummaries } from './store';
import { HIDDEN_VERSION_TITLE } from '../rooms/versionRedaction';

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
  const stored = await env.DB.prepare(`SELECT snapshot_json${contentType === 'room' ? ', redacted_at' : ''} FROM ${table} WHERE ${idColumn} = ? AND version = ?`)
    .bind(contentId,version).first<VersionRow & { redacted_at?: string | null }>();
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
  return { target, title: stored.redacted_at ? HIDDEN_VERSION_TITLE : snapshot.title ?? null, cells };
}
export async function handleRoomInsights(request: Request, url: URL, env: Env, type: RoomInsightTarget['contentType'], id: string): Promise<Response> {
  const raw = url.searchParams.get('version'); const version = raw === null ? undefined : Number(raw);
  if (version !== undefined && (!Number.isSafeInteger(version) || version < 1)) throw new HttpError(400, 'Choose a published version.');
  const db = env.DB.withSession?.('first-primary') ?? env.DB;
  const context = { ...env, DB: db };
  const metadata = await resolveInsightMetadata(context, { contentType: type, contentId: id, version });
  const unavailable=await ensureInsightRoomFacts(context,[metadata.target],true);
  const previousVersion=await previousInsightLayout(context,metadata.target);
  const previous=previousVersion===null?null:await resolveInsightMetadata(context,{...metadata.target,version:previousVersion});
  const targets=previous?[metadata.target,previous.target]:[metadata.target];
  const [summaries,map,previousMap,versions,previousVersions]=await Promise.all([
    loadInsightSummaries(context,targets,{factsReady:true}),loadInsightDeathMap(context,metadata.target,{factsReady:true}),
    previous?loadInsightDeathMap(context,previous.target,{factsReady:true}):null,
    insightEquivalentVersions(context,metadata.target),previous?insightEquivalentVersions(context,previous.target):[],
  ]);
  const stats=(meta:Metadata,points:Awaited<ReturnType<typeof loadInsightDeathMap>>,equivalentVersions:number[]):RoomInsightVersionStats=>({
    ...meta,summary:summaries.get(`${insightTargetKey(meta.target)}:${meta.target.version}`)??emptyInsightSummary(),...points,equivalentVersions,
    versionGrouping:meta.target.contentType==='room'&&!unavailable.has(`${insightTargetKey(meta.target)}:${meta.target.version}`)?'matching':'exact',
  });
  const result:RoomInsightsResponse={...stats(metadata,map,versions),comparison:previous&&previousMap?stats(previous,previousMap,previousVersions):null};
  return jsonResponse(request,result,{ headers: { 'Cache-Control': 'public, max-age=30' } });
}
