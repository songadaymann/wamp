import type { AuthUser } from '../../../auth/model';
import type {
  SchoolAuthContext,
  SchoolClassroomAdmin,
  SchoolClassroomPublic,
  SchoolStudentRecord,
} from '../../../school/model';
import { HttpError } from '../core/http';
import type { Env, UserRow } from '../core/types';
import {
  isValidEmail,
  mapUserRow,
  normalizeEmail,
  resolvePublicBaseUrl,
} from '../auth/store';

const PASSWORD_HASH_VERSION = 'pbkdf2-sha256';
// Cloudflare Workers Web Crypto rejects PBKDF2 iteration counts above 100_000.
const PASSWORD_HASH_ITERATIONS = 100_000;
const PASSWORD_HASH_MAX_ITERATIONS = 100_000;
const PASSWORD_HASH_BYTES = 32;
const PASSWORD_SALT_BYTES = 16;
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9_-]{2,23}$/;
const CLASSROOM_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{2,47}$/;
const PASSWORD_WORDS = [
  'apple',
  'beacon',
  'comet',
  'drum',
  'ember',
  'forest',
  'glider',
  'harbor',
  'island',
  'jacket',
  'kite',
  'ladder',
  'meadow',
  'number',
  'orbit',
  'pixel',
  'quartz',
  'rocket',
  'signal',
  'tunnel',
  'violet',
  'window',
];

interface SchoolClassroomRow {
  id: string;
  slug: string;
  display_name: string;
  teacher_email: string;
  created_at: string;
  updated_at: string;
  disabled_at: string | null;
}

interface SchoolStudentRow {
  id: string;
  classroom_id: string;
  user_id: string;
  username: string;
  password_hash: string;
  password_reset_required: number;
  password_updated_at: string;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
  disabled_at: string | null;
  user_display_name: string;
}

interface SchoolStudentAuthRow extends SchoolStudentRow {
  user_email: string | null;
  user_wallet_address: string | null;
  user_username: string | null;
  user_avatar_url: string | null;
  user_bio: string | null;
  user_selected_avatar_id: string | null;
  user_created_at: string;
  user_updated_at: string;
}

interface SchoolAuthContextRow {
  student_id: string;
  student_username: string;
  student_disabled_at: string | null;
  classroom_id: string;
  classroom_slug: string;
  classroom_name: string;
  classroom_disabled_at: string | null;
}

export interface LoadedSchoolAuthContext {
  context: SchoolAuthContext | null;
  disabled: boolean;
}

export async function createSchoolClassroom(
  request: Request,
  env: Env,
  input: {
    slug?: unknown;
    displayName: unknown;
    teacherEmail: unknown;
  },
): Promise<SchoolClassroomAdmin> {
  const displayName = normalizeClassroomDisplayName(input.displayName);
  const teacherEmail = normalizeTeacherEmail(input.teacherEmail);
  const slug = normalizeClassroomSlug(input.slug ?? displayName);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  try {
    await env.DB.batch([
      env.DB.prepare(
        `
          INSERT INTO school_classrooms (id, slug, display_name, teacher_email, created_at, updated_at, disabled_at)
          VALUES (?, ?, ?, ?, ?, ?, NULL)
        `,
      ).bind(id, slug, displayName, teacherEmail, now, now),
    ]);
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) {
      throw new HttpError(409, 'That classroom slug is already in use.');
    }
    throw error;
  }

  return serializeClassroom(request, env, {
    id,
    slug,
    display_name: displayName,
    teacher_email: teacherEmail,
    created_at: now,
    updated_at: now,
    disabled_at: null,
  });
}

export async function loadSchoolClassroomBySlug(
  env: Env,
  slug: string,
): Promise<SchoolClassroomRow | null> {
  return env.DB.prepare(
    `
      SELECT id, slug, display_name, teacher_email, created_at, updated_at, disabled_at
      FROM school_classrooms
      WHERE slug = ?
      LIMIT 1
    `,
  )
    .bind(normalizeClassroomSlug(slug))
    .first<SchoolClassroomRow>();
}

export async function loadActiveSchoolClassroomBySlug(
  env: Env,
  slug: string,
): Promise<SchoolClassroomRow> {
  const classroom = await loadSchoolClassroomBySlug(env, slug);
  if (!classroom || classroom.disabled_at) {
    throw new HttpError(404, 'Classroom not found.');
  }
  return classroom;
}

export async function listSchoolStudents(
  env: Env,
  classroomId: string,
): Promise<SchoolStudentRecord[]> {
  const result = await env.DB.prepare(
    `
      SELECT
        s.id,
        s.classroom_id,
        s.user_id,
        s.username,
        s.password_hash,
        s.password_reset_required,
        s.password_updated_at,
        s.last_login_at,
        s.created_at,
        s.updated_at,
        s.disabled_at,
        u.display_name AS user_display_name
      FROM school_students s
      JOIN users u ON u.id = s.user_id
      WHERE s.classroom_id = ?
      ORDER BY lower(s.username)
    `,
  )
    .bind(classroomId)
    .all<SchoolStudentRow>();

  return result.results.map(serializeStudent);
}

export async function createSchoolStudent(
  env: Env,
  classroom: Pick<SchoolClassroomRow, 'id'>,
  rawUsername: unknown,
): Promise<{ student: SchoolStudentRecord; temporaryPassword: string }> {
  const username = normalizeStudentUsername(rawUsername);
  const existing = await loadSchoolStudentByUsername(env, classroom.id, username);
  if (existing) {
    throw new HttpError(409, 'That student username is already in this classroom.');
  }

  const temporaryPassword = generateStudentPassword();
  const passwordHash = await hashStudentPassword(temporaryPassword);
  const now = new Date().toISOString();
  const userId = crypto.randomUUID();
  const studentId = crypto.randomUUID();

  try {
    await env.DB.batch([
      env.DB.prepare(
        `
          INSERT INTO users (id, email, wallet_address, display_name, username, created_at, updated_at)
          VALUES (?, NULL, NULL, ?, NULL, ?, ?)
        `,
      ).bind(userId, username, now, now),
      env.DB.prepare(
        `
          INSERT INTO school_students (
            id,
            classroom_id,
            user_id,
            username,
            password_hash,
            password_reset_required,
            password_updated_at,
            last_login_at,
            created_at,
            updated_at,
            disabled_at
          )
          VALUES (?, ?, ?, ?, ?, 1, ?, NULL, ?, ?, NULL)
        `,
      ).bind(studentId, classroom.id, userId, username, passwordHash, now, now, now),
    ]);
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) {
      throw new HttpError(409, 'That student username is already in this classroom.');
    }
    throw error;
  }

  return {
    student: {
      id: studentId,
      userId,
      username,
      displayName: username,
      passwordResetRequired: true,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
      disabledAt: null,
    },
    temporaryPassword,
  };
}

export async function resetSchoolStudentPassword(
  env: Env,
  classroomId: string,
  studentId: string,
): Promise<{ student: SchoolStudentRecord; temporaryPassword: string }> {
  const student = await loadSchoolStudentById(env, classroomId, studentId);
  if (!student || student.disabled_at) {
    throw new HttpError(404, 'Student not found.');
  }

  const temporaryPassword = generateStudentPassword();
  const passwordHash = await hashStudentPassword(temporaryPassword);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `
        UPDATE school_students
        SET password_hash = ?, password_reset_required = 1, password_updated_at = ?, updated_at = ?
        WHERE id = ? AND classroom_id = ?
      `,
    ).bind(passwordHash, now, now, studentId, classroomId),
  ]);

  return {
    student: serializeStudent({
      ...student,
      password_hash: passwordHash,
      password_reset_required: 1,
      password_updated_at: now,
      updated_at: now,
    }),
    temporaryPassword,
  };
}

export async function disableSchoolStudent(
  env: Env,
  classroomId: string,
  studentId: string,
): Promise<SchoolStudentRecord> {
  const student = await loadSchoolStudentById(env, classroomId, studentId);
  if (!student) {
    throw new HttpError(404, 'Student not found.');
  }

  const disabledAt = student.disabled_at ?? new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `
        UPDATE school_students
        SET disabled_at = ?, updated_at = ?
        WHERE id = ? AND classroom_id = ?
      `,
    ).bind(disabledAt, disabledAt, studentId, classroomId),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(student.user_id),
  ]);

  return serializeStudent({
    ...student,
    disabled_at: disabledAt,
    updated_at: disabledAt,
  });
}

export async function authenticateSchoolStudent(
  env: Env,
  classroom: Pick<SchoolClassroomRow, 'id' | 'slug' | 'display_name'>,
  rawUsername: unknown,
  rawPassword: unknown,
  rawNewPassword: unknown,
): Promise<{
  user: AuthUser | null;
  passwordResetRequired: boolean;
}> {
  const username = normalizeStudentUsername(rawUsername);
  const password = normalizeStudentPassword(rawPassword, 'Password');
  const student = await loadSchoolStudentAuthByUsername(env, classroom.id, username);
  if (!student || student.disabled_at) {
    throw new HttpError(401, 'Username or password is incorrect.');
  }

  const passwordValid = await verifyStudentPassword(password, student.password_hash);
  if (!passwordValid) {
    throw new HttpError(401, 'Username or password is incorrect.');
  }

  if (student.password_reset_required === 1) {
    if (rawNewPassword === undefined) {
      return {
        user: null,
        passwordResetRequired: true,
      };
    }

    const newPassword = normalizeStudentPassword(rawNewPassword, 'New password');
    if (newPassword === password) {
      throw new HttpError(400, 'New password must be different from the temporary password.');
    }

    const passwordHash = await hashStudentPassword(newPassword);
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `
          UPDATE school_students
          SET password_hash = ?,
              password_reset_required = 0,
              password_updated_at = ?,
              last_login_at = ?,
              updated_at = ?
          WHERE id = ?
        `,
      ).bind(passwordHash, now, now, now, student.id),
    ]);
  } else {
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `
          UPDATE school_students
          SET last_login_at = ?, updated_at = ?
          WHERE id = ?
        `,
      ).bind(now, now, student.id),
    ]);
  }

  return {
    user: mapSchoolStudentAuthUser(student),
    passwordResetRequired: false,
  };
}

export async function loadSchoolAuthContextForUser(
  env: Env,
  userId: string,
): Promise<LoadedSchoolAuthContext> {
  const row = await env.DB.prepare(
    `
      SELECT
        s.id AS student_id,
        s.username AS student_username,
        s.disabled_at AS student_disabled_at,
        c.id AS classroom_id,
        c.slug AS classroom_slug,
        c.display_name AS classroom_name,
        c.disabled_at AS classroom_disabled_at
      FROM school_students s
      JOIN school_classrooms c ON c.id = s.classroom_id
      WHERE s.user_id = ?
      LIMIT 1
    `,
  )
    .bind(userId)
    .first<SchoolAuthContextRow>();

  if (!row) {
    return { context: null, disabled: false };
  }

  const disabled = Boolean(row.student_disabled_at || row.classroom_disabled_at);
  if (disabled) {
    return { context: null, disabled: true };
  }

  return {
    disabled: false,
    context: {
      classroomId: row.classroom_id,
      classroomSlug: row.classroom_slug,
      classroomName: row.classroom_name,
      studentId: row.student_id,
      studentUsername: row.student_username,
    },
  };
}

export function serializeClassroom(
  request: Request,
  env: Env,
  classroom: SchoolClassroomRow,
): SchoolClassroomAdmin {
  const baseUrl = resolvePublicBaseUrl(request, env);
  const encodedSlug = encodeURIComponent(classroom.slug);
  return {
    id: classroom.id,
    slug: classroom.slug,
    displayName: classroom.display_name,
    teacherEmail: classroom.teacher_email,
    createdAt: classroom.created_at,
    updatedAt: classroom.updated_at,
    disabledAt: classroom.disabled_at,
    studentLoginUrl: `${baseUrl}/school-login.html?classroom=${encodedSlug}`,
    teacherAdminUrl: `${baseUrl}/school-admin.html?classroom=${encodedSlug}`,
  };
}

export function serializePublicClassroom(classroom: SchoolClassroomRow): SchoolClassroomPublic {
  return {
    id: classroom.id,
    slug: classroom.slug,
    displayName: classroom.display_name,
  };
}

export function assertTeacherCanManageClassroom(
  classroom: Pick<SchoolClassroomRow, 'teacher_email'>,
  user: Pick<AuthUser, 'email'>,
): void {
  const teacherEmail = normalizeEmail(classroom.teacher_email);
  const userEmail = user.email ? normalizeEmail(user.email) : '';
  if (!userEmail || userEmail !== teacherEmail) {
    throw new HttpError(403, 'This classroom is managed by a different teacher email.');
  }
}

function serializeStudent(row: SchoolStudentRow): SchoolStudentRecord {
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username,
    displayName: row.user_display_name,
    passwordResetRequired: row.password_reset_required === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
    disabledAt: row.disabled_at,
  };
}

async function loadSchoolStudentByUsername(
  env: Env,
  classroomId: string,
  username: string,
): Promise<{ id: string } | null> {
  return env.DB.prepare(
    `
      SELECT id
      FROM school_students
      WHERE classroom_id = ?
        AND lower(username) = lower(?)
      LIMIT 1
    `,
  )
    .bind(classroomId, username)
    .first<{ id: string }>();
}

async function loadSchoolStudentById(
  env: Env,
  classroomId: string,
  studentId: string,
): Promise<SchoolStudentRow | null> {
  return env.DB.prepare(
    `
      SELECT
        s.id,
        s.classroom_id,
        s.user_id,
        s.username,
        s.password_hash,
        s.password_reset_required,
        s.password_updated_at,
        s.last_login_at,
        s.created_at,
        s.updated_at,
        s.disabled_at,
        u.display_name AS user_display_name
      FROM school_students s
      JOIN users u ON u.id = s.user_id
      WHERE s.classroom_id = ?
        AND s.id = ?
      LIMIT 1
    `,
  )
    .bind(classroomId, studentId)
    .first<SchoolStudentRow>();
}

async function loadSchoolStudentAuthByUsername(
  env: Env,
  classroomId: string,
  username: string,
): Promise<SchoolStudentAuthRow | null> {
  return env.DB.prepare(
    `
      SELECT
        s.id,
        s.classroom_id,
        s.user_id,
        s.username,
        s.password_hash,
        s.password_reset_required,
        s.password_updated_at,
        s.last_login_at,
        s.created_at,
        s.updated_at,
        s.disabled_at,
        u.display_name AS user_display_name,
        u.email AS user_email,
        u.wallet_address AS user_wallet_address,
        u.username AS user_username,
        u.avatar_url AS user_avatar_url,
        u.bio AS user_bio,
        u.selected_avatar_id AS user_selected_avatar_id,
        u.created_at AS user_created_at,
        u.updated_at AS user_updated_at
      FROM school_students s
      JOIN users u ON u.id = s.user_id
      WHERE s.classroom_id = ?
        AND lower(s.username) = lower(?)
      LIMIT 1
    `,
  )
    .bind(classroomId, username)
    .first<SchoolStudentAuthRow>();
}

function mapSchoolStudentAuthUser(row: SchoolStudentAuthRow): AuthUser {
  const userRow: UserRow = {
    id: row.user_id,
    email: row.user_email,
    wallet_address: row.user_wallet_address,
    display_name: row.user_display_name,
    username: row.user_username,
    avatar_url: row.user_avatar_url,
    bio: row.user_bio,
    selected_avatar_id: row.user_selected_avatar_id,
    created_at: row.user_created_at,
    updated_at: row.user_updated_at,
  };
  return mapUserRow(userRow);
}

function normalizeClassroomDisplayName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'Classroom display name is required.');
  }

  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length < 2 || normalized.length > 80) {
    throw new HttpError(400, 'Classroom display name must be 2-80 characters.');
  }
  return normalized;
}

export function normalizeClassroomSlug(value: unknown): string {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'Classroom slug is required.');
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!CLASSROOM_SLUG_PATTERN.test(normalized)) {
    throw new HttpError(400, 'Classroom slug must be 3-48 lowercase letters, numbers, or hyphens.');
  }
  return normalized;
}

function normalizeTeacherEmail(value: unknown): string {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'Teacher email is required.');
  }

  const email = normalizeEmail(value);
  if (!isValidEmail(email)) {
    throw new HttpError(400, 'Teacher email must be valid.');
  }
  return email;
}

function normalizeStudentUsername(value: unknown): string {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'Student username is required.');
  }

  const username = value.trim().toLowerCase();
  if (!USERNAME_PATTERN.test(username)) {
    throw new HttpError(400, 'Student username must be 3-24 lowercase letters, numbers, underscores, or hyphens.');
  }
  if (username === 'admin' || username === 'teacher' || username === 'school') {
    throw new HttpError(400, 'That student username is reserved.');
  }
  return username;
}

function normalizeStudentPassword(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new HttpError(400, `${label} is required.`);
  }

  const password = value.trim();
  if (password.length < 8 || password.length > 80) {
    throw new HttpError(400, `${label} must be 8-80 characters.`);
  }
  return password;
}

function generateStudentPassword(): string {
  const first = pickPasswordWord();
  let second = pickPasswordWord();
  if (second === first) {
    second = pickPasswordWord();
  }
  const suffix = String(randomInt(100, 999));
  return `${first}-${second}-${suffix}`;
}

function pickPasswordWord(): string {
  return PASSWORD_WORDS[randomInt(0, PASSWORD_WORDS.length - 1)] ?? 'pixel';
}

function randomInt(min: number, max: number): number {
  const range = max - min + 1;
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return min + (bytes[0] % range);
}

async function hashStudentPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(PASSWORD_SALT_BYTES));
  const key = await derivePasswordKey(password, salt, PASSWORD_HASH_ITERATIONS);
  return [
    PASSWORD_HASH_VERSION,
    String(PASSWORD_HASH_ITERATIONS),
    encodeBase64Url(salt),
    encodeBase64Url(key),
  ].join('$');
}

async function verifyStudentPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split('$');
  if (parts.length !== 4 || parts[0] !== PASSWORD_HASH_VERSION) {
    return false;
  }

  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > PASSWORD_HASH_MAX_ITERATIONS) {
    return false;
  }

  const salt = decodeBase64Url(parts[2]);
  const expected = decodeBase64Url(parts[3]);
  const actual = await derivePasswordKey(password, salt, iterations);
  return constantTimeEqual(actual, expected);
}

async function derivePasswordKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: toArrayBuffer(salt),
      iterations,
    },
    material,
    PASSWORD_HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index] ^ right[index];
  }
  return diff === 0;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(value: string | undefined): Uint8Array {
  if (!value) {
    return new Uint8Array();
  }

  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
