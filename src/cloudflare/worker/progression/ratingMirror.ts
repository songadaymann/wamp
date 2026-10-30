import type { Env } from '../core/types';

export async function mirrorCourseRatingToExpandedRoomRating(
  env: Env,
  params: {
    expandedRoomId: string;
    legacyCourseId: string;
    versionKey: number;
    userId: string;
  },
): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `
        INSERT OR REPLACE INTO expanded_room_ratings (
          expanded_room_id,
          lineage_key,
          version_key,
          user_id,
          quality_stars,
          difficulty_choice,
          auto_difficulty_choice,
          trust_weight,
          completed_attempt_id,
          first_rated_at,
          updated_at,
          rewarded_at,
          legacy_course_id
        )
        SELECT
          ?,
          lineage_key,
          version_key,
          user_id,
          quality_stars,
          difficulty_choice,
          auto_difficulty_choice,
          trust_weight,
          completed_attempt_id,
          first_rated_at,
          updated_at,
          rewarded_at,
          ?
        FROM course_ratings
        WHERE course_id = ?
          AND version_key = ?
          AND user_id = ?
      `
    ).bind(
      params.expandedRoomId,
      params.legacyCourseId,
      params.legacyCourseId,
      params.versionKey,
      params.userId,
    ),
  ]);
}
