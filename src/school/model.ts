import type { AuthUser } from '../auth/model';

export interface SchoolAuthContext {
  classroomId: string;
  classroomSlug: string;
  classroomName: string;
  studentId: string;
  studentUsername: string;
}

export interface SchoolClassroomPublic {
  id: string;
  slug: string;
  displayName: string;
}

export interface SchoolClassroomAdmin extends SchoolClassroomPublic {
  teacherEmail: string;
  createdAt: string;
  updatedAt: string;
  disabledAt: string | null;
  studentLoginUrl: string;
  teacherAdminUrl: string;
}

export interface SchoolStudentRecord {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  passwordResetRequired: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  disabledAt: string | null;
}

export interface SchoolClassroomCreateRequestBody {
  slug?: string;
  displayName: string;
  teacherEmail: string;
}

export interface SchoolClassroomCreateResponse {
  classroom: SchoolClassroomAdmin;
}

export interface SchoolTeacherStudentListResponse {
  classroom: SchoolClassroomAdmin;
  students: SchoolStudentRecord[];
}

export interface SchoolStudentCreateRequestBody {
  username: string;
}

export interface SchoolStudentCreateResponse {
  student: SchoolStudentRecord;
  temporaryPassword: string;
}

export interface SchoolStudentResetPasswordResponse {
  student: SchoolStudentRecord;
  temporaryPassword: string;
}

export interface SchoolStudentDisableResponse {
  student: SchoolStudentRecord;
}

export interface SchoolStudentLoginRequestBody {
  username: string;
  password: string;
  newPassword?: string;
}

export interface SchoolStudentLoginResponse {
  authenticated: boolean;
  passwordResetRequired: boolean;
  user: AuthUser | null;
  classroom: SchoolClassroomPublic;
}

