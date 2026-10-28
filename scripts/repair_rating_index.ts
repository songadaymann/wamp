import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import type { D1Database, D1PreparedStatement, Env } from '../src/cloudflare/worker/core/types';
import { loadDiscoveryRatingVersionKeys, ratingVersionIdentity } from '../src/cloudflare/worker/progression/discoveryRatingWindows';

interface Target { target_key: string; target_type: 'room' | 'expanded_room'; content_id: string; version_key: number }

// Repair projections only. Keep legacy ratings for the convergence rollback/deletion gate.
const mirror = `INSERT INTO expanded_room_ratings(expanded_room_id,lineage_key,version_key,user_id,
  quality_stars,difficulty_choice,auto_difficulty_choice,trust_weight,completed_attempt_id,
  first_rated_at,updated_at,rewarded_at,legacy_course_id)
  SELECT e.id,c.lineage_key,c.version_key,c.user_id,c.quality_stars,c.difficulty_choice,c.auto_difficulty_choice,
    c.trust_weight,c.completed_attempt_id,c.first_rated_at,c.updated_at,c.rewarded_at,c.course_id
  FROM course_ratings c JOIN expanded_rooms e ON e.legacy_course_id=c.course_id WHERE 1
  ON CONFLICT(expanded_room_id,version_key,user_id) DO UPDATE SET
    lineage_key=excluded.lineage_key,quality_stars=excluded.quality_stars,difficulty_choice=excluded.difficulty_choice,
    auto_difficulty_choice=excluded.auto_difficulty_choice,trust_weight=excluded.trust_weight,
    completed_attempt_id=excluded.completed_attempt_id,first_rated_at=excluded.first_rated_at,
    updated_at=excluded.updated_at,rewarded_at=excluded.rewarded_at,legacy_course_id=excluded.legacy_course_id
  WHERE excluded.updated_at >= expanded_room_ratings.updated_at`;

export async function repairRatingIndex(env: Env, apply = false) {
  const targets = (await env.DB.prepare('SELECT target_key,target_type,content_id,version_key FROM playable_content_index').all<Target>()).results;
  const keys = new Map<string, number>();
  for (const kind of ['room', 'expanded_room'] as const) {
    const selected = targets.filter(t => t.target_type === kind);
    const buckets = await loadDiscoveryRatingVersionKeys(env, kind, selected.map(t => ({ id: t.content_id, version: t.version_key })), apply);
    for (const target of selected) keys.set(target.target_key, buckets.get(ratingVersionIdentity(target.content_id, target.version_key)) ?? target.version_key);
  }
  if (apply) {
    await env.DB.batch([env.DB.prepare(mirror)]);
    for (let offset = 0; offset < targets.length; offset += 40) {
      await env.DB.batch(targets.slice(offset, offset + 40).map(target => {
        const table = target.target_type === 'room' ? 'room_ratings' : 'expanded_room_ratings';
        const id = target.target_type === 'room' ? 'room_id' : 'expanded_room_id';
        return env.DB.prepare(`UPDATE playable_content_index SET
          (quality_adjusted_average,quality_vote_count,consensus_difficulty,difficulty_vote_count) = (
          WITH ratings AS (SELECT
            SUM(CASE WHEN quality_stars IS NOT NULL THEN 1 ELSE 0 END) AS quality_votes,
            SUM(CASE WHEN quality_stars IS NOT NULL THEN quality_stars*trust_weight ELSE 0 END) AS quality_sum,
            SUM(CASE WHEN quality_stars IS NOT NULL THEN trust_weight ELSE 0 END) AS quality_weights,
            SUM(CASE WHEN difficulty_choice IS NOT NULL THEN 1 ELSE 0 END) AS difficulty_votes,
            SUM(CASE WHEN difficulty_choice='easy' THEN trust_weight ELSE 0 END) AS easy_weight,
            SUM(CASE WHEN difficulty_choice='medium' THEN trust_weight ELSE 0 END) AS medium_weight,
            SUM(CASE WHEN difficulty_choice='hard' THEN trust_weight ELSE 0 END) AS hard_weight,
            SUM(CASE WHEN difficulty_choice='extreme' THEN trust_weight ELSE 0 END) AS extreme_weight
            FROM ${table} WHERE ${id}=? AND version_key=?)
          SELECT CASE WHEN quality_weights>0 THEN ROUND(((3.5*5)+quality_sum)/(5+quality_weights),3) ELSE NULL END,
            COALESCE(quality_votes,0), CASE WHEN COALESCE(difficulty_votes,0)=0 THEN NULL
            WHEN extreme_weight>=hard_weight AND extreme_weight>=medium_weight AND extreme_weight>=easy_weight THEN 'extreme'
            WHEN hard_weight>=medium_weight AND hard_weight>=easy_weight THEN 'hard'
            WHEN medium_weight>=easy_weight THEN 'medium' ELSE 'easy' END, COALESCE(difficulty_votes,0) FROM ratings)
          WHERE target_key=? AND version_key=?`).bind(target.content_id, keys.get(target.target_key), target.target_key, target.version_key);
      }));
    }
  }
  return { applied: apply, indexedTargets: targets.length,
    retainedRatingWindows: targets.filter(t => keys.get(t.target_key) !== t.version_key).length };
}

function sqlValue(value: unknown): string {
  if (value === null) return 'NULL';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string') return "'" + value.replace(/'/g, "''") + "'";
  throw new Error('Unexpected SQL parameter');
}

async function main() {
  const args = process.argv.slice(2), remote = args.includes('--remote'), apply = args.includes('--apply');
  const envIndex = args.indexOf('--env'), environment = envIndex < 0 ? null : args[envIndex + 1];
  if (remote && environment !== 'safety' && !args.includes('--confirm-production')) throw new Error('Production D1 access requires --confirm-production.');
  const common = ['node_modules/wrangler/bin/wrangler.js','d1','execute','DB',remote ? '--remote' : '--local','--json'];
  if (environment) common.push('--env',environment);
  function execute(sql: string) {
    const result = spawnSync(process.execPath,[...common,'--command',sql],{encoding:'utf8',maxBuffer:64*1024*1024});
    if (result.status !== 0) throw new Error(result.stderr || 'D1 operation failed');
    const rows = JSON.parse(result.stdout) as { success: boolean; results: unknown[] }[];
    if (rows.some(r => !r.success)) throw new Error('D1 operation failed');
    return rows;
  }
  class Statement {
    constructor(readonly sql: string, readonly values: unknown[] = []) {}
    bind(...values: unknown[]) { return new Statement(this.sql,values); }
    rendered() { let index=0; return this.sql.replace(/\?/g,() => sqlValue(this.values[index++])); }
    async all<T>() { return {results: execute(this.rendered())[0].results as T[]}; }
    async first<T>() { return (await this.all<T>()).results[0] ?? null; }
  }
  const db = { prepare: (sql: string) => new Statement(sql),
    batch: async (statements: D1PreparedStatement[]) => execute(statements.map(s => (s as unknown as Statement).rendered()).join(';')) } as D1Database;
  console.log(JSON.stringify(await repairRatingIndex({DB:db} as Env,apply)));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error); process.exitCode=1; });
