import { sqlUserIdIsNotLegacyGeneratedOnly, sqlUserIdDoesNotHaveLegacyGeneratedDisplayNamePrefix } from '../generatedUsers/leaderboardIsolation';

export const PUBLIC_PROMPT_TARGET = `i.goal_type IS NOT NULL
  AND ${sqlUserIdIsNotLegacyGeneratedOnly('i.builder_user_id')}
  AND ${sqlUserIdDoesNotHaveLegacyGeneratedDisplayNamePrefix('i.builder_user_id')}
  AND NOT EXISTS (SELECT 1 FROM school_students WHERE user_id = i.builder_user_id)
  AND NOT EXISTS (SELECT 1 FROM playable_content_index_members m JOIN world_room_claims w ON w.room_id = m.room_id
    WHERE m.target_key = i.target_key AND w.world_id <> 'wamp-prime')
  AND NOT EXISTS (SELECT 1 FROM world_room_claims w WHERE w.room_id = i.representative_room_id AND w.world_id <> 'wamp-prime')`;
export const CURRENT_PROMPT_TARGET = `(${PUBLIC_PROMPT_TARGET}) AND (
  i.target_type = 'room' AND r.published_json IS NOT NULL
    AND CAST(json_extract(r.published_json,'$.version') AS INTEGER) = i.version_key
  OR i.target_type = 'expanded_room' AND (
    e.published_json IS NOT NULL AND e.archived_at IS NULL AND e.published_version = i.version_key
    OR e.id IS NULL AND c.published_json IS NOT NULL AND c.published_version = i.version_key))`;
export const TARGET_JOINS = `JOIN users builder ON builder.id = i.builder_user_id
  LEFT JOIN rooms r ON i.target_type = 'room' AND r.id = i.content_id
  LEFT JOIN expanded_rooms e ON i.target_type = 'expanded_room' AND e.id = i.content_id
  LEFT JOIN courses c ON i.target_type = 'expanded_room' AND c.id = i.legacy_course_id`;
export const PUBLIC_PROMPT_VOTER = `${sqlUserIdIsNotLegacyGeneratedOnly('v.user_id')}
  AND ${sqlUserIdDoesNotHaveLegacyGeneratedDisplayNamePrefix('v.user_id')}
  AND NOT EXISTS (SELECT 1 FROM school_students WHERE user_id = v.user_id)`;
