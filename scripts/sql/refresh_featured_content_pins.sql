UPDATE playable_content_index AS target SET featured_at = (
  SELECT MAX(featured.featured_at) FROM featured_rooms featured
  WHERE featured.target_key = target.target_key AND featured.target_version = target.version_key
    AND (
      (target.target_type = 'room' AND featured.room_id = target.content_id AND featured.room_version = target.version_key)
      OR (target.target_type = 'expanded_room' AND EXISTS (
        SELECT 1 FROM playable_content_index_members member
        WHERE member.target_key = target.target_key AND member.room_id = featured.room_id
          AND member.room_version = featured.room_version
      ))
    )
);
