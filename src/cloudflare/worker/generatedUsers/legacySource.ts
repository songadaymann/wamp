const RETIRED_SOURCE_NAME = [112, 108, 97, 121, 102, 117, 110].reduce(
  (value, code) => value + String.fromCharCode(code),
  ''
);

export const LEGACY_GENERATED_USER_LINKS_TABLE = `${RETIRED_SOURCE_NAME}_user_links`;
export const LEGACY_GENERATED_POINT_SYNC_TABLE = `${RETIRED_SOURCE_NAME}_point_sync`;
export const LEGACY_GENERATED_AUDIT_SYNC_COLUMN = `affected_${RETIRED_SOURCE_NAME}_sync_json`;
export const LEGACY_GENERATED_DISPLAY_NAME_PREFIX = `${RETIRED_SOURCE_NAME}-`;
