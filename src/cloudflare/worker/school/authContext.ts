import type { SchoolAuthContext } from '../../../school/model';

/** A signed-in user's classroom, read with their session. */
export interface SchoolAuthContextRow {
  student_id: string | null;
  student_username: string | null;
  student_disabled_at: string | null;
  classroom_id: string | null;
  classroom_slug: string | null;
  classroom_name: string | null;
  classroom_disabled_at: string | null;
}

export interface LoadedSchoolAuthContext {
  context: SchoolAuthContext | null;
  disabled: boolean;
}

export function mapSchoolAuthContextRow(row: SchoolAuthContextRow | null): LoadedSchoolAuthContext {
  if (!row?.student_id || !row.classroom_id) {
    return { context: null, disabled: false };
  }

  if (row.student_disabled_at || row.classroom_disabled_at) {
    return { context: null, disabled: true };
  }

  return {
    disabled: false,
    context: {
      classroomId: row.classroom_id,
      classroomSlug: row.classroom_slug ?? '',
      classroomName: row.classroom_name ?? '',
      studentId: row.student_id,
      studentUsername: row.student_username ?? '',
    },
  };
}
