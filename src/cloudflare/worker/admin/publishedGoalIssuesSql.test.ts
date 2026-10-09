import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { countRoomPlacedObjectsByCategory } from '../../../persistence/roomModel';
import { PUBLISHED_GOAL_ISSUES_BINDINGS, PUBLISHED_GOAL_ISSUES_CTE } from './publishedGoalIssuesSql';

describe('published room setup SQL', () => {
  it('matches gameplay enemy categories, ignores drafts and area cells, and pages only current broken goals', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec('CREATE TABLE rooms(id TEXT PRIMARY KEY,x INTEGER,y INTEGER,published_json TEXT); CREATE TABLE playable_content_index(target_key TEXT,target_type TEXT); CREATE TABLE playable_content_index_members(target_key TEXT,room_id TEXT);');
      const insert = db.prepare('INSERT INTO rooms VALUES (?, ?, 0, ?)');
      const rooms = [
        { goal: { type: 'reach_exit', exit: null }, placedObjects: [] },
        { goal: { type: 'checkpoint_sprint', finish: null }, placedObjects: [] },
        { goal: { type: 'checkpoint_sprint', finish: { x: 0, y: 0 }, checkpoints: [] }, placedObjects: [] },
        { goal: { type: 'defeat_all' }, placedObjects: [] },
        { goal: { type: 'defeat_all' }, placedObjects: [{ id: 'slime_blue' }] },
        { goal: { type: 'defeat_all' }, placedObjects: [{ id: 'cage', containedObjectId: 'slime_blue' }] },
        { goal: { type: 'defeat_all' }, placedObjects: [{ id: 'coin_gold', containedObjectId: 'slime_blue' }] },
        { goal: { type: 'reach_exit', exit: null }, placedObjects: [] },
      ];
      rooms.forEach((room, index) => insert.run(`${index},0`, index, JSON.stringify({ ...room, version: 3, title: '<script>' })));
      insert.run('8,0', 8, null);
      db.exec("INSERT INTO playable_content_index VALUES ('area:7', 'expanded_room'); INSERT INTO playable_content_index_members VALUES ('area:7','7,0');");
      const all = db.prepare(`${PUBLISHED_GOAL_ISSUES_CTE} SELECT room_id, issue FROM goal_issues WHERE issue IS NOT NULL ORDER BY room_id`).all(...PUBLISHED_GOAL_ISSUES_BINDINGS) as Array<{ room_id: string; issue: string }>;
      expect(all).toEqual([
        { room_id: '0,0', issue: 'missing_exit' },
        { room_id: '1,0', issue: 'missing_finish' },
        { room_id: '3,0', issue: 'no_enemies' },
        { room_id: '6,0', issue: 'no_enemies' },
      ]);
      for (const index of [3,4,5,6]) {
        const hasIssue = all.some(row => row.room_id === `${index},0`);
        const placed = rooms[index].placedObjects.map((object, itemIndex) => ({ ...object, instanceId: String(itemIndex), x: 0, y: 0 }));
        expect(hasIssue).toBe(countRoomPlacedObjectsByCategory(placed, 'enemy') === 0);
      }
      const page = db.prepare(`${PUBLISHED_GOAL_ISSUES_CTE} SELECT room_id FROM goal_issues WHERE issue IS NOT NULL AND room_id > ? ORDER BY room_id LIMIT ?`).all(...PUBLISHED_GOAL_ISSUES_BINDINGS, '1,0', 1);
      expect(page).toEqual([{ room_id: '3,0' }]);
    } finally { db.close(); }
  });
});
