import type { RoomSnapshot } from '../../../persistence/roomModel';
import { insightTargetKey, type RoomInsightTarget } from '../../../insights/model';
import { computeRoomVersionFacts, ROOM_VERSION_FACTS_VERSION } from '../../../persistence/roomVersionLineage';
import { computeRoomWeightedChange } from '../progression/changeMetrics';
import { parseStoredSnapshot } from '../rooms/store';
import type { D1PreparedStatement, Env } from '../core/types';
const validInsightFacts = (alias:string):string => `CASE WHEN ${alias}.facts_version=${ROOM_VERSION_FACTS_VERSION}
  AND json_valid(${alias}.facts_json) THEN COALESCE(json_type(${alias}.facts_json,'$.fingerprint')='text'
    AND length(json_extract(${alias}.facts_json,'$.fingerprint'))=16
    AND json_extract(${alias}.facts_json,'$.fingerprint') NOT GLOB '*[^0-9a-f]*',0) ELSE 0 END`;

export const compareInsightFacts=(left:string,right:string,operator:'='|'<>'='='):string =>
  `CASE WHEN (${validInsightFacts(left)})=1 AND (${validInsightFacts(right)})=1 THEN
    json_extract(${left}.facts_json,'$.fingerprint')${operator}json_extract(${right}.facts_json,'$.fingerprint') ELSE 0 END`;

/** Warm reads use compact facts. Cold reads never return a page of large snapshots. */
export async function ensureInsightRoomFacts(env:Env,targets:readonly RoomInsightTarget[],includeHistory=false):Promise<Set<string>> {
  const unavailable=new Set<string>();
  const requested=[...new Map(targets.filter(t=>insightTargetKey(t).startsWith('room:')&&t.version)
    .map(t=>[`${insightTargetKey(t)}:${t.version}`,{id:insightTargetKey(t).slice(5),version:t.version!}])).values()];
  for(let offset=0;offset<requested.length;offset+=40){
    const batch=requested.slice(offset,offset+40),skipped:{id:string;version:number}[]=[];
    while(true){
      const rows=await env.DB.prepare(`WITH requested AS (
        SELECT json_extract(value,'$.id') AS id,json_extract(value,'$.version') AS version FROM json_each(?)
      ) SELECT v.room_id,v.version,(SELECT MAX(prior.version) FROM room_versions prior
          WHERE prior.room_id=v.room_id AND prior.version<v.version) AS previous_version
        FROM room_versions v LEFT JOIN room_version_facts f ON f.room_id=v.room_id AND f.version=v.version
        WHERE v.room_id IN(SELECT id FROM requested) AND (${includeHistory?'1':'0'}=1
          OR EXISTS(SELECT 1 FROM requested r WHERE r.id=v.room_id AND r.version=v.version)
          OR EXISTS(SELECT 1 FROM room_insight_attempts a WHERE a.target_key='room:'||v.room_id AND a.version_key=v.version))
          AND (${validInsightFacts('f')})=0
          AND NOT EXISTS(SELECT 1 FROM json_each(?) bad WHERE json_extract(bad.value,'$.id')=v.room_id
            AND json_extract(bad.value,'$.version')=v.version)
        ORDER BY v.room_id,v.version LIMIT 80`).bind(JSON.stringify(batch),JSON.stringify(skipped))
        .all<{room_id:string;version:number;previous_version:number|null}>();
      if(!rows.results.length)break;
      const updates:D1PreparedStatement[]=[];let next=0;
      await Promise.all(Array.from({length:Math.min(4,rows.results.length)},async()=>{
        while(next<rows.results.length){
          const row=rows.results[next++];
          const read=(version:number)=>env.DB.prepare('SELECT snapshot_json FROM room_versions WHERE room_id=? AND version=?')
            .bind(row.room_id,version).first<{snapshot_json:string}>();
          const [current,previous]=await Promise.all([read(row.version),row.previous_version===null?null:read(row.previous_version)]);
          if(!current){skipped.push({id:row.room_id,version:row.version});continue;}
          let snapshot:RoomSnapshot,prior:RoomSnapshot|null;
          try {snapshot=parseStoredSnapshot(current.snapshot_json,row.room_id);prior=previous?parseStoredSnapshot(previous.snapshot_json,row.room_id):null;}
          catch {skipped.push({id:row.room_id,version:row.version});continue;}
          const facts=computeRoomVersionFacts(snapshot),change=computeRoomWeightedChange(prior,snapshot);
            updates.push(env.DB.prepare(`INSERT INTO room_version_facts(room_id,version,facts_version,facts_json,change_from_previous,computed_at)
              VALUES(?,?,?,?,?,?) ON CONFLICT(room_id,version) DO UPDATE SET facts_version=excluded.facts_version,
              facts_json=excluded.facts_json,change_from_previous=excluded.change_from_previous,computed_at=excluded.computed_at`)
              .bind(row.room_id,row.version,ROOM_VERSION_FACTS_VERSION,JSON.stringify(facts),change,new Date().toISOString()));
        }
      }));
      for(let start=0;start<updates.length;start+=40)await env.DB.batch(updates.slice(start,start+40));
    }
    for(const row of skipped)unavailable.add(`room:${row.id}:${row.version}`);
  }
  return unavailable;
}
export async function insightEquivalentVersions(env:Env,target:RoomInsightTarget):Promise<number[]> {
  if(!insightTargetKey(target).startsWith('room:'))return [target.version!];
  const rows=await env.DB.prepare(`SELECT ? AS version UNION SELECT sibling.version FROM room_version_facts selected
    JOIN room_version_facts sibling ON sibling.room_id=selected.room_id
    WHERE selected.room_id=? AND selected.version=? AND (${compareInsightFacts('selected','sibling')})=1 ORDER BY version`)
    .bind(target.version,insightTargetKey(target).slice(5),target.version).all<{version:number}>();
  return rows.results.map(row=>row.version);
}
export async function previousInsightLayout(env:Env,target:RoomInsightTarget):Promise<number|null> {
  if(!insightTargetKey(target).startsWith('room:'))return null;
  const row=await env.DB.prepare(`SELECT prior.version FROM room_version_facts selected JOIN room_version_facts prior ON prior.room_id=selected.room_id
    WHERE selected.room_id=? AND selected.version=? AND prior.version<selected.version
      AND (${compareInsightFacts('selected','prior','<>')})=1
    ORDER BY prior.version DESC LIMIT 1`).bind(insightTargetKey(target).slice(5),target.version).first<{version:number}>();
  return row?.version??null;
}
