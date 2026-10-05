import type { BuildPrompt, BuildPromptEntry, BuildPromptInput, BuildPromptsResponse } from '../../../buildPrompts/model';
import { BUILD_PROMPT_SLUG, BUILD_PROMPT_PAGE_SIZE } from '../../../buildPrompts/model';
import { QUALITY_PRIOR_MEAN, QUALITY_PRIOR_WEIGHT } from '../progression/shared';
import type { Env } from '../core/types';
import { HttpError } from '../core/http';
import { CURRENT_PROMPT_TARGET, TARGET_JOINS, PUBLIC_PROMPT_VOTER } from './eligibility';
import { sqlUserIdIsNotLegacyGeneratedOnly, sqlUserIdDoesNotHaveLegacyGeneratedDisplayNamePrefix } from '../generatedUsers/leaderboardIsolation';
import { promptVoteSelect } from './votes';

interface PromptRow {
  slug: string; title: string; constraint_text: string; starts_at: string; ends_at: string;
  settled_at: string | null; entry_count: number;
}
interface EntryRow {
  prompt_slug: string; target_key: string; content_type: 'room' | 'expanded_room'; content_id: string;
  version: number; room_id: string; room_version: number; room_x: number; room_y: number; title: string;
  builder_user_id: string; builder_display_name: string; cell_count: number; legacy_course_id: string | null;
  submitted_at: string; available: number; vote_count: number; adjusted_average: number | null; winner_rank: number | null;
}
const ENTRY_VISIBLE = `${sqlUserIdIsNotLegacyGeneratedOnly('entry.builder_user_id')}
  AND ${sqlUserIdDoesNotHaveLegacyGeneratedDisplayNamePrefix('entry.builder_user_id')}
  AND NOT EXISTS (SELECT 1 FROM school_students WHERE user_id = entry.builder_user_id)
  AND NOT EXISTS (SELECT 1 FROM world_room_claims world WHERE world.room_id = entry.room_id AND world.world_id <> 'wamp-prime')
  AND NOT EXISTS (SELECT 1 FROM playable_content_index_members member JOIN world_room_claims world ON world.room_id = member.room_id
    WHERE member.target_key = entry.target_key AND world.world_id <> 'wamp-prime')`;
const VOTES = `vote_totals AS (SELECT v.prompt_slug,v.target_key,v.version,COUNT(*) AS vote_count,
  SUM(v.quality_stars * v.trust_weight) AS weighted_sum,SUM(v.trust_weight) AS weighted_count
  FROM build_prompt_votes v JOIN build_prompt_entries entry ON entry.prompt_slug=v.prompt_slug AND entry.target_key=v.target_key
  WHERE v.user_id <> entry.builder_user_id AND ${PUBLIC_PROMPT_VOTER}
  GROUP BY v.prompt_slug,v.target_key,v.version)`;
const ENTRY_SELECT = `SELECT entry.*, CASE WHEN i.version_key=entry.version AND i.builder_user_id=entry.builder_user_id
    AND (${CURRENT_PROMPT_TARGET}) THEN 1 ELSE 0 END AS available,
  COALESCE(vote.vote_count,0) AS vote_count,
  CASE WHEN vote.vote_count>0 THEN (${QUALITY_PRIOR_MEAN * QUALITY_PRIOR_WEIGHT}+vote.weighted_sum)/(${QUALITY_PRIOR_WEIGHT}+vote.weighted_count) ELSE NULL END AS adjusted_average,
  winner.rank AS winner_rank FROM build_prompt_entries entry
  LEFT JOIN playable_content_index i ON i.target_key=entry.target_key
  LEFT JOIN users builder ON builder.id=entry.builder_user_id
  LEFT JOIN rooms r ON i.target_type='room' AND r.id=i.content_id
  LEFT JOIN expanded_rooms e ON i.target_type='expanded_room' AND e.id=i.content_id
  LEFT JOIN courses c ON i.target_type='expanded_room' AND c.id=i.legacy_course_id
  LEFT JOIN vote_totals vote ON vote.prompt_slug=entry.prompt_slug AND vote.target_key=entry.target_key AND vote.version=entry.version
  LEFT JOIN build_prompt_winners winner ON winner.prompt_slug=entry.prompt_slug AND winner.target_key=entry.target_key AND winner.version=entry.version`;
const PROMPTS = `SELECT prompt.*, (SELECT COUNT(*) FROM build_prompt_entries entry WHERE entry.prompt_slug=prompt.slug AND ${ENTRY_VISIBLE}) AS entry_count FROM build_prompts prompt`;
function mapPrompt(row: PromptRow): BuildPrompt {
  return {slug:row.slug,title:row.title,constraint:row.constraint_text,startsAt:row.starts_at,endsAt:row.ends_at,settledAt:row.settled_at,entryCount:row.entry_count};
}
function mapEntry(row: EntryRow): BuildPromptEntry {
  return {targetKey:row.target_key,contentType:row.content_type,contentId:row.content_id,version:row.version,
    roomId:row.room_id,roomVersion:row.room_version,coordinates:{x:row.room_x,y:row.room_y},title:row.title,
    builderUserId:row.builder_user_id,builderDisplayName:row.builder_display_name,cellCount:row.cell_count,
    legacyCourseId:row.legacy_course_id,available:row.available===1,voteCount:row.vote_count,
    adjustedAverage:row.adjusted_average===null?null:Math.round(row.adjusted_average*100)/100,
    winnerRank:row.winner_rank,submittedAt:row.submitted_at};
}
export function weekStart(now: string): string {
  const date=new Date(now);if(!Number.isFinite(date.getTime()))throw new HttpError(400,'Choose a valid week.');
  date.setUTCHours(0,0,0,0);date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7);return date.toISOString();
}
export function validatePromptInput(input: BuildPromptInput): {input: BuildPromptInput; endsAt: string} {
  if(!input || typeof input.slug!=='string' || !BUILD_PROMPT_SLUG.test(input.slug) || typeof input.title!=='string' || !input.title.trim() || input.title.trim().length>80
    || typeof input.constraint!=='string' || !input.constraint.trim() || input.constraint.trim().length>400
    || typeof input.startsAt!=='string' || input.startsAt!==weekStart(input.startsAt))throw new HttpError(400,'Use a slug, title, constraint and Monday at 00:00 UTC.');
  return {input:{...input,title:input.title.trim(),constraint:input.constraint.trim()},endsAt:new Date(Date.parse(input.startsAt)+7*86400000).toISOString()};
}
export async function saveBuildPrompt(env: Env, body: BuildPromptInput, now=new Date().toISOString()): Promise<void> {
  const {input,endsAt}=validatePromptInput(body);
  if(endsAt<=now)throw new HttpError(409,'That week has already closed.');
  const existing=await env.DB.prepare('SELECT slug FROM build_prompts WHERE slug=?').bind(input.slug).first();
  // The condition is repeated in the write so an entry arriving after this read locks the edit.
  await env.DB.prepare(`INSERT INTO build_prompts(slug,title,constraint_text,starts_at,ends_at,created_at,updated_at)
    SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM build_prompts WHERE slug<>? AND starts_at<? AND ends_at>?)
      AND NOT EXISTS(SELECT 1 FROM build_prompt_entries WHERE prompt_slug=?)
    ON CONFLICT(slug) DO UPDATE SET title=excluded.title,constraint_text=excluded.constraint_text,starts_at=excluded.starts_at,
      ends_at=excluded.ends_at,updated_at=excluded.updated_at
    WHERE build_prompts.settled_at IS NULL AND NOT EXISTS(SELECT 1 FROM build_prompt_entries WHERE prompt_slug=excluded.slug)`)
    .bind(input.slug,input.title,input.constraint,input.startsAt,endsAt,now,now,input.slug,endsAt,input.startsAt,input.slug).all();
  const saved=await env.DB.prepare('SELECT * FROM build_prompts WHERE slug=?').bind(input.slug).first<PromptRow>();
  if(!saved || saved.title!==input.title || saved.constraint_text!==input.constraint || saved.starts_at!==input.startsAt)
    throw new HttpError(409,existing?'A prompt with entries is locked.':'This week already has a prompt.');
}
export async function deleteBuildPrompt(env: Env, slug: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM build_prompts WHERE slug=? AND settled_at IS NULL
    AND NOT EXISTS(SELECT 1 FROM build_prompt_entries WHERE prompt_slug=?)`).bind(slug,slug).all();
  if(await env.DB.prepare('SELECT 1 FROM build_prompts WHERE slug=?').bind(slug).first())throw new HttpError(409,'A prompt with entries is locked.');
}
export async function loadAdminBuildPrompts(env: Env): Promise<BuildPrompt[]> {
  const rows=await env.DB.prepare(`${PROMPTS} ORDER BY prompt.starts_at DESC LIMIT 52`).all<PromptRow>();return rows.results.map(mapPrompt);
}
export async function loadCurrentBuildPrompt(env: Env, now=new Date().toISOString()): Promise<BuildPrompt | null> {
  const row=await env.DB.prepare(`${PROMPTS} WHERE prompt.starts_at<=? AND prompt.ends_at>? ORDER BY prompt.starts_at DESC LIMIT 1`).bind(now,now).first<PromptRow>();return row?mapPrompt(row):null;
}
export async function submitBuildPromptEntry(env: Env, slug: string, userId: string, targetKey: string, version: number, now=new Date().toISOString()): Promise<BuildPromptEntry> {
  const prompt=await loadCurrentBuildPrompt(env,now);
  if(prompt?.slug!==slug)throw new HttpError(409,'This prompt is no longer open.');
  const target=await env.DB.prepare(`SELECT i.target_key,i.version_key FROM playable_content_index i ${TARGET_JOINS}
    WHERE i.target_key=? AND i.version_key=? AND i.builder_user_id=? AND (${CURRENT_PROMPT_TARGET})
      AND (i.target_type='room' AND (r.claimer_user_id=? OR builder.wallet_address IS NOT NULL AND lower(r.minted_owner_wallet_address)=lower(builder.wallet_address))
        OR i.target_type='expanded_room' AND COALESCE(e.owner_user_id,c.owner_user_id)=?)`)
    .bind(targetKey,version,userId,userId,userId).first();
  if(!target)throw new HttpError(403,'Choose your own current public goal level.');
  const owned=await env.DB.prepare('SELECT target_key FROM build_prompt_entries WHERE prompt_slug=? AND builder_user_id=?').bind(slug,userId).first<{target_key:string}>();
  if(owned && owned.target_key!==targetKey)throw new HttpError(409,'One entry per builder. Withdraw your current entry before choosing another level.');
  const write=env.DB.prepare(`INSERT INTO build_prompt_entries(prompt_slug,target_key,content_type,content_id,version,
    room_id,room_version,room_x,room_y,title,builder_user_id,builder_display_name,cell_count,legacy_course_id,submitted_at)
    SELECT ?,i.target_key,i.target_type,i.content_id,i.version_key,i.representative_room_id,
      COALESCE((SELECT room_version FROM playable_content_index_members WHERE target_key=i.target_key AND room_id=i.representative_room_id),i.version_key),
      i.room_x,i.room_y,COALESCE(NULLIF(trim(i.title),''),'Untitled Level'),i.builder_user_id,COALESCE(NULLIF(i.builder_display_name,''),'Builder'),i.cell_count,i.legacy_course_id,?
    FROM playable_content_index i ${TARGET_JOINS} JOIN build_prompts prompt ON prompt.slug=?
    WHERE i.target_key=? AND i.version_key=? AND i.builder_user_id=? AND (${CURRENT_PROMPT_TARGET})
      AND (i.target_type='room' AND (r.claimer_user_id=? OR builder.wallet_address IS NOT NULL AND lower(r.minted_owner_wallet_address)=lower(builder.wallet_address))
        OR i.target_type='expanded_room' AND COALESCE(e.owner_user_id,c.owner_user_id)=?)
      AND NOT EXISTS(SELECT 1 FROM build_prompt_entries other WHERE other.prompt_slug=prompt.slug AND other.builder_user_id=i.builder_user_id AND other.target_key<>i.target_key)
      AND prompt.starts_at<=? AND prompt.ends_at>? AND prompt.settled_at IS NULL
      AND (CASE i.target_type WHEN 'room' THEN json_extract(r.published_json,'$.publishedAt') ELSE COALESCE(e.published_at,c.published_at) END)>=prompt.starts_at
      AND (CASE i.target_type WHEN 'room' THEN json_extract(r.published_json,'$.publishedAt') ELSE COALESCE(e.published_at,c.published_at) END)<prompt.ends_at
    ON CONFLICT(prompt_slug,target_key) DO UPDATE SET version=excluded.version,room_version=excluded.room_version,
      room_x=excluded.room_x,room_y=excluded.room_y,title=excluded.title,cell_count=excluded.cell_count,
      legacy_course_id=excluded.legacy_course_id,builder_display_name=excluded.builder_display_name
    WHERE build_prompt_entries.builder_user_id=excluded.builder_user_id`)
    .bind(slug,now,slug,targetKey,version,userId,userId,userId,now,now);
  await env.DB.batch([write,env.DB.prepare(`DELETE FROM build_prompt_votes WHERE prompt_slug=? AND target_key=?
    AND version<>(SELECT version FROM build_prompt_entries WHERE prompt_slug=? AND target_key=?)`).bind(slug,targetKey,slug,targetKey),
    ...(['room_ratings','expanded_room_ratings','course_ratings'] as const).map(table=>env.DB.prepare(`INSERT OR REPLACE INTO build_prompt_votes
      (prompt_slug,target_key,version,user_id,quality_stars,trust_weight,completed_attempt_id,rated_at)
      ${promptVoteSelect(table,'rating')} AND entry.prompt_slug=? AND entry.target_key=? AND prompt.settled_at IS NULL`).bind(slug,targetKey))]);
  const row=await env.DB.prepare(`WITH ${VOTES} ${ENTRY_SELECT} WHERE entry.prompt_slug=? AND entry.target_key=? AND entry.builder_user_id=? AND entry.version=?`)
    .bind(slug,targetKey,userId,version).first<EntryRow>();
  if(!row)throw new HttpError(409,'The level or prompt changed. Reload before entering.');return mapEntry(row);
}
export async function withdrawBuildPromptEntry(env: Env, slug: string, userId: string, now=new Date().toISOString()): Promise<void> {
  if((await loadCurrentBuildPrompt(env,now))?.slug!==slug)throw new HttpError(409,'This prompt is no longer open.');
  await env.DB.prepare(`DELETE FROM build_prompt_entries WHERE prompt_slug=? AND builder_user_id=?
    AND EXISTS(SELECT 1 FROM build_prompts WHERE slug=? AND ends_at>? AND settled_at IS NULL)`).bind(slug,userId,slug,now).all();
}
export async function settleExpiredBuildPrompts(env: Env, now=new Date().toISOString()): Promise<number> {
  const due=await env.DB.prepare('SELECT slug FROM build_prompts WHERE ends_at<=? AND settled_at IS NULL ORDER BY ends_at LIMIT 4').bind(now).all<{slug:string}>();
  for(const {slug} of due.results) {
    const unsettled=`EXISTS(SELECT 1 FROM build_prompts prompt WHERE prompt.slug=? AND prompt.ends_at<=? AND prompt.settled_at IS NULL)`;
    await env.DB.batch([
      env.DB.prepare(`WITH ${VOTES}, candidates AS (${ENTRY_SELECT} WHERE entry.prompt_slug=? AND ${ENTRY_VISIBLE}),
        ranked AS (SELECT target_key,version,vote_count,adjusted_average,ROW_NUMBER() OVER(ORDER BY adjusted_average DESC,vote_count DESC,submitted_at ASC,target_key ASC) AS rank
          FROM candidates WHERE available=1 AND vote_count>0)
        INSERT OR IGNORE INTO build_prompt_winners(prompt_slug,rank,target_key,version,vote_count,adjusted_average,awarded_at)
        SELECT ?,rank,target_key,version,vote_count,adjusted_average,? FROM ranked WHERE rank<=3 AND ${unsettled}`)
        .bind(slug,slug,now,slug,now),
      env.DB.prepare(`INSERT OR IGNORE INTO badge_awards(user_id,badge_id,source_type,source_id,metadata_json,awarded_at)
        SELECT entry.builder_user_id,'builder_prompt_winner','build_prompt',?,json_object('rank',winner.rank,'title',entry.title),?
        FROM build_prompt_winners winner JOIN build_prompt_entries entry ON entry.prompt_slug=winner.prompt_slug AND entry.target_key=winner.target_key
        WHERE winner.prompt_slug=? AND ${unsettled}`).bind(slug,now,slug,slug,now),
      env.DB.prepare(`INSERT INTO featured_rooms(room_id,room_version,featured_at,target_key,target_version)
        SELECT entry.room_id,entry.room_version,?,entry.target_key,entry.version FROM build_prompt_winners winner
        JOIN build_prompt_entries entry ON entry.prompt_slug=winner.prompt_slug AND entry.target_key=winner.target_key
        WHERE winner.prompt_slug=? AND ${unsettled}
        ON CONFLICT(room_id) DO UPDATE SET room_version=excluded.room_version,featured_at=excluded.featured_at,target_key=excluded.target_key,target_version=excluded.target_version`)
        .bind(now,slug,slug,now),
      env.DB.prepare(`UPDATE playable_content_index SET featured_at=? WHERE EXISTS(SELECT 1 FROM build_prompt_winners winner
        WHERE winner.prompt_slug=? AND winner.target_key=playable_content_index.target_key AND winner.version=playable_content_index.version_key) AND ${unsettled}`).bind(now,slug,slug,now),
      env.DB.prepare(`UPDATE user_progress SET badge_count=(SELECT COUNT(*) FROM badge_awards WHERE user_id=user_progress.user_id),updated_at=?
        WHERE user_id IN(SELECT entry.builder_user_id FROM build_prompt_winners winner JOIN build_prompt_entries entry
          ON entry.prompt_slug=winner.prompt_slug AND entry.target_key=winner.target_key WHERE winner.prompt_slug=?) AND ${unsettled}`).bind(now,slug,slug,now),
      env.DB.prepare('UPDATE build_prompts SET settled_at=? WHERE slug=? AND ends_at<=? AND settled_at IS NULL').bind(now,slug,now),
    ]);
  }
  return due.results.length;
}
export async function loadBuildPrompts(env: Env, userId: string | null, slug?: string, offset=0, now=new Date().toISOString()): Promise<BuildPromptsResponse> {
  await settleExpiredBuildPrompts(env,now);
  const current=await loadCurrentBuildPrompt(env,now);
  const recent=await env.DB.prepare(`${PROMPTS} WHERE prompt.ends_at<=? ORDER BY prompt.starts_at DESC LIMIT 8`).bind(now).all<PromptRow>();
  const chosen=slug?await env.DB.prepare(`${PROMPTS} WHERE prompt.slug=? AND prompt.starts_at<=?`).bind(slug,now).first<PromptRow>():null;
  const prompt=slug?(chosen?mapPrompt(chosen):null):current??(recent.results[0]?mapPrompt(recent.results[0]):null);
  if(slug && !prompt)throw new HttpError(404,'Prompt not found.');
  const response:BuildPromptsResponse={serverTime:now,current,recent:recent.results.map(mapPrompt),prompt,entries:[],nextOffset:null,viewerEntry:null};
  if(!prompt)return response;
  const rows=await env.DB.prepare(`WITH ${VOTES} ${ENTRY_SELECT} WHERE entry.prompt_slug=? AND ${ENTRY_VISIBLE}
    ORDER BY entry.submitted_at ASC,entry.target_key ASC LIMIT ? OFFSET ?`).bind(prompt.slug,BUILD_PROMPT_PAGE_SIZE+1,offset).all<EntryRow>();
  response.entries=rows.results.slice(0,BUILD_PROMPT_PAGE_SIZE).map(mapEntry);
  response.nextOffset=rows.results.length>BUILD_PROMPT_PAGE_SIZE?offset+BUILD_PROMPT_PAGE_SIZE:null;
  if(userId) {
    const row=await env.DB.prepare(`WITH ${VOTES} ${ENTRY_SELECT} WHERE entry.prompt_slug=? AND entry.builder_user_id=? AND ${ENTRY_VISIBLE}`)
      .bind(prompt.slug,userId).first<EntryRow>();response.viewerEntry=row?mapEntry(row):null;
  }
  return response;
}
