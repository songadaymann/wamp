import { AUTOMATIC_BUILD_PROMPTS } from '../../../buildPrompts/automaticPromptBank';
import { weekStart } from '../buildPrompts/store';
import type { Env } from '../core/types';
import { ensureAutomaticRush } from './rush';

async function ensureAutomaticPrompt(env: Env, startsAt: string, now: string): Promise<boolean> {
  if(await env.DB.prepare('SELECT 1 FROM build_prompts WHERE starts_at=?').bind(startsAt).first()) return false;
  const used = await env.DB.prepare(`SELECT automatic_prompt_key,MAX(starts_at) AS last_used FROM build_prompts
    WHERE automatic_prompt_key IS NOT NULL GROUP BY automatic_prompt_key`).all<{automatic_prompt_key:string;last_used:string}>();
  const last = new Map(used.results.map(row => [row.automatic_prompt_key,row.last_used]));
  const prompt = [...AUTOMATIC_BUILD_PROMPTS].sort((a,b) => (last.get(a.key) ?? '').localeCompare(last.get(b.key) ?? '')
    || AUTOMATIC_BUILD_PROMPTS.indexOf(a)-AUTOMATIC_BUILD_PROMPTS.indexOf(b))[0];
  const endsAt = new Date(Date.parse(startsAt)+7*86400000).toISOString();
  const slug = `weekly-${startsAt.slice(0,10)}`;
  const saved = await env.DB.prepare(`INSERT OR IGNORE INTO build_prompts
    (slug,title,constraint_text,starts_at,ends_at,created_at,updated_at,picked_by,automatic_prompt_key)
    SELECT ?,?,?,?,?,?,?,'automatic',?
    WHERE NOT EXISTS(SELECT 1 FROM weekly_event_suppressions WHERE event_kind='prompt' AND starts_at=?)
    RETURNING slug`).bind(slug,prompt.title,prompt.constraint,startsAt,endsAt,now,now,prompt.key,startsAt).first();
  return saved !== null;
}

/** Hourly prefill leaves next week's choices visible in Launch Admin for days before they open. */
export async function scheduleWeeklyEvents(env: Env, now = new Date().toISOString()) {
  const current = weekStart(now);
  const weeks = [current,new Date(Date.parse(current)+7*86400000).toISOString()];
  let rushes=0,prompts=0;
  for(const startsAt of weeks) {
    if(await ensureAutomaticRush(env,startsAt,now)) rushes+=1;
    if(await ensureAutomaticPrompt(env,startsAt,now)) prompts+=1;
  }
  return {rushes,prompts};
}
