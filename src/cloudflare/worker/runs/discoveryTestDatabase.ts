import { fixture, run, NOW } from '../activity/testDatabase';

export function discoveryFixture() {
  const f = fixture();
  for (let n = 0; n < 14; n++) {
    const snapshot = { ...f.record.published!, id: `${n},0`, coordinates: { x: n, y: 0 },
      title: `Public room ${n}`, version: n === 6 ? 2 : 1, publishedAt: NOW };
    const json = JSON.stringify(snapshot), owner = n === 4 ? 'p1' : 'builder';
    if (n === 0) f.sqlite.prepare("UPDATE rooms SET published_goal_type='reach_exit'").run();
    else {
      f.sqlite.prepare(`INSERT INTO rooms(id,x,y,draft_json,published_json,published_title,published_goal_type,claimer_user_id,claimer_display_name)
        VALUES (?,?,0,?,?,?,'reach_exit',?,?)`).run(snapshot.id, n, json, json, snapshot.title, owner, owner);
      for (let v = 1; v <= snapshot.version; v++) f.sqlite.prepare(`INSERT INTO room_versions(room_id,version,snapshot_json,title,created_at)
        VALUES (?,?,?,?,?)`).run(snapshot.id, v, JSON.stringify({ ...snapshot, version: v }), snapshot.title, NOW);
    }
    f.sqlite.prepare(`INSERT INTO playable_content_index(target_key,target_type,content_id,version_key,representative_room_id,
      room_x,room_y,builder_user_id,builder_display_name,title,goal_type,published_at,first_published_at,cell_count,
      anchor_x,anchor_y,source_type,updated_at,consensus_difficulty,difficulty_vote_count)
      VALUES (?,'room',?,?,?,?,?,?,?,?,?,?,?,?,?,0,'standalone_room',?,'easy',3)`)
      .run(`room:${snapshot.id}`, snapshot.id, snapshot.version, snapshot.id, n, 0, owner, owner, snapshot.title,
        n === 13 ? null : 'reach_exit', NOW, NOW, 1, n, NOW);
    if (n % 2 === 0) {
      f.sqlite.prepare('INSERT INTO featured_rooms(room_id,room_version,featured_at) VALUES (?,?,?)').run(snapshot.id, snapshot.version, NOW);
      f.sqlite.prepare('UPDATE playable_content_index SET featured_at=? WHERE target_key=?').run(NOW, `room:${snapshot.id}`);
    }
  }
  f.sqlite.prepare("UPDATE rooms SET published_goal_type=NULL WHERE id='13,0'").run();
  function history(id: string, user: string, n: number, result = 'completed', version = 1) {
    run(f, id, user, 1000, 'passed', version);
    f.sqlite.prepare('UPDATE room_runs SET room_id=?,room_x=?,result=? WHERE attempt_id=?').run(`${n},0`, n, result, id);
  }
  history('p1-clear-1', 'p1', 1); history('p1-clear-2', 'p1', 2); history('p1-own', 'p1', 4);
  history('p1-failed', 'p1', 5, 'failed'); history('p1-old-version', 'p1', 6);
  history('p2-clear-3', 'p2', 3);
  function rate(user: string, n: number, stars: number | null = 4, difficulty: string | null = 'easy') {
    f.sqlite.prepare(`INSERT INTO room_ratings(room_id,lineage_key,version_key,user_id,quality_stars,difficulty_choice,first_rated_at,updated_at)
      VALUES (?,'fixture',1,?,?,?,?,?)`).run(`${n},0`, user, stars, difficulty, NOW, NOW);
  }
  rate('p1', 2);
  for (const [id, start, source] of [['native', 7, 'native_expanded_room'], ['course:legacy', 9, 'legacy_course']] as const) {
    const json = JSON.stringify({ version: 3, title: id, goal: { type: 'reach_exit' }, publishedAt: NOW, roomRefs: [] });
    f.sqlite.prepare(`INSERT INTO expanded_rooms(id,owner_user_id,owner_display_name,source_type,anchor_room_id,anchor_x,anchor_y,
      draft_json,published_json,published_title,published_version,created_at,updated_at,published_at)
      VALUES (?,'builder','builder',?,?,?,0,?,?,?,3,?,?,?)`).run(id, source, `${start},0`, start, json, json, id, NOW, NOW, NOW);
    f.sqlite.prepare('INSERT INTO expanded_room_versions(expanded_room_id,version,snapshot_json,created_at) VALUES (?,3,?,?)').run(id, json, NOW);
    for (let order = 0; order < 2; order++) f.sqlite.prepare(`INSERT INTO expanded_room_cells(expanded_room_id,expanded_room_version,cell_order,room_id,room_x,room_y,room_version)
      VALUES (?,3,?,?,?,0,1)`).run(id, order, `${start + order},0`, start + order);
    f.sqlite.prepare(`DELETE FROM playable_content_index_members WHERE room_id IN (?,?)`).run(`${start},0`, `${start+1},0`);
    f.sqlite.prepare(`DELETE FROM playable_content_index WHERE content_id IN (?,?)`).run(`${start},0`, `${start+1},0`);
    f.sqlite.prepare(`INSERT INTO playable_content_index(target_key,target_type,content_id,version_key,representative_room_id,room_x,room_y,
      builder_user_id,builder_display_name,title,goal_type,published_at,first_published_at,cell_count,anchor_x,anchor_y,source_type,updated_at)
      VALUES (?,'expanded_room',?,3,?,?,0,'builder','builder',?,'reach_exit',?,?,2,?,0,?,?)`)
      .run(`expanded_room:${id}`, id, `${start},0`, start, id, NOW, NOW, start, source, NOW);
    f.sqlite.prepare('INSERT INTO playable_content_index_members(target_key,room_id,room_version) VALUES (?,?,1)')
      .run(`expanded_room:${id}`, `${start},0`);
    f.sqlite.prepare(`INSERT INTO expanded_room_runs(attempt_id,expanded_room_id,expanded_room_version,goal_type,goal_json,user_id,
      user_display_name,started_at,finished_at,result,elapsed_ms) VALUES (?,?,3,'reach_exit','{}','p1','p1',?,?,'completed',1000)`)
      .run(`clear-${id}`, id, NOW, NOW);
  }
  return { ...f, history, rate };
}
