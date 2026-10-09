import { CONTAINER_OBJECT_IDS, GAME_OBJECTS } from '../../../config/objects';

// Use the same direct/contained enemy categories as placedObjectContributesToCategory.
// Custom sprites currently have no enemy kind.
export const PUBLISHED_GOAL_ISSUES_BINDINGS = [
  JSON.stringify(GAME_OBJECTS.filter(object => object.category === 'enemy').map(object => object.id)),
  JSON.stringify(CONTAINER_OBJECT_IDS),
  JSON.stringify(GAME_OBJECTS.filter(object => object.category === 'enemy').map(object => object.id)),
];

export const PUBLISHED_GOAL_ISSUES_CTE = `
  WITH goal_issues AS (
    SELECT rooms.id AS room_id, rooms.x, rooms.y,
      json_extract(rooms.published_json, '$.title') AS title,
      CAST(json_extract(rooms.published_json, '$.version') AS INTEGER) AS version,
      CASE
        WHEN json_extract(rooms.published_json, '$.goal.type') = 'reach_exit'
          AND json_extract(rooms.published_json, '$.goal.exit') IS NULL THEN 'missing_exit'
        WHEN json_extract(rooms.published_json, '$.goal.type') = 'checkpoint_sprint'
          AND json_extract(rooms.published_json, '$.goal.finish') IS NULL THEN 'missing_finish'
        WHEN json_extract(rooms.published_json, '$.goal.type') = 'defeat_all'
          AND NOT EXISTS (
            SELECT 1 FROM json_each(rooms.published_json, '$.placedObjects') object
            WHERE json_extract(object.value, '$.id') IN (SELECT value FROM json_each(?))
              OR (json_extract(object.value, '$.id') IN (SELECT value FROM json_each(?))
                AND json_extract(object.value, '$.containedObjectId') IN (SELECT value FROM json_each(?)))
          ) THEN 'no_enemies'
        ELSE NULL
      END AS issue
    FROM rooms
    WHERE rooms.published_json IS NOT NULL
      AND json_extract(rooms.published_json, '$.goal.type') IN ('reach_exit', 'checkpoint_sprint', 'defeat_all')
      AND NOT EXISTS (
        SELECT 1 FROM playable_content_index_members members
        INNER JOIN playable_content_index target ON target.target_key = members.target_key
        WHERE members.room_id = rooms.id AND target.target_type = 'expanded_room'
      )
  )
`;
