import type {
  SchoolClassroomCreateRequestBody,
  SchoolClassroomCreateResponse,
  SchoolStudentCreateRequestBody,
  SchoolStudentCreateResponse,
  SchoolStudentDisableResponse,
  SchoolStudentEnableResponse,
  SchoolStudentLoginRequestBody,
  SchoolStudentLoginResponse,
  SchoolStudentResetPasswordResponse,
  SchoolTeacherStudentListResponse,
} from '../../../school/model';
import { createSession } from '../auth/store';
import {
  createSessionCookie,
  requireAdminRequest,
  requireAuthenticatedRequestAuth,
} from '../auth/request';
import { HttpError, jsonResponse, parseJsonBody } from '../core/http';
import {
  clearRateLimitBucket,
  clearRateLimitEvents,
  getClientIp,
  hashRateLimitKey,
  networkKeyForIp,
  releaseRateLimitSlots,
  takeRateLimitSlots,
  type RateLimitRule,
} from '../core/rateLimit';
import type { Env, RequestAuth } from '../core/types';
import {
  assertTeacherCanManageClassroom,
  authenticateSchoolStudent,
  createSchoolClassroom,
  createSchoolStudent,
  disableSchoolStudent,
  enableSchoolStudent,
  listSchoolStudents,
  loadActiveSchoolClassroomBySlug,
  resetSchoolStudentPassword,
  serializeClassroom,
  serializePublicClassroom,
} from './store';

export async function handleAdminSchoolRequest(
  request: Request,
  url: URL,
  env: Env,
): Promise<Response> {
  if (url.pathname === '/api/admin/school/classrooms' && request.method === 'POST') {
    requireAdminRequest(env, request, 'create school classrooms');
    const body = await parseJsonBody<SchoolClassroomCreateRequestBody>(request);
    const classroom = await createSchoolClassroom(request, env, {
      slug: body.slug,
      displayName: body.displayName,
      teacherEmail: body.teacherEmail,
    });
    const responseBody: SchoolClassroomCreateResponse = { classroom };
    return jsonResponse(request, responseBody, { status: 201 });
  }

  throw new HttpError(404, 'School admin route not found.');
}

export async function handleSchoolRequest(
  request: Request,
  url: URL,
  env: Env,
): Promise<Response> {
  const classroomMatch = /^\/api\/school\/classrooms\/([^/]+)$/.exec(url.pathname);
  if (classroomMatch && request.method === 'GET') {
    const classroom = await loadActiveSchoolClassroomBySlug(env, decodeURIComponent(classroomMatch[1]));
    return jsonResponse(request, { classroom: serializePublicClassroom(classroom) });
  }

  const teacherStudentsMatch = /^\/api\/school\/classrooms\/([^/]+)\/teacher\/students$/.exec(url.pathname);
  if (teacherStudentsMatch && request.method === 'GET') {
    const { classroom } = await requireTeacherClassroom(request, env, decodeURIComponent(teacherStudentsMatch[1]));
    const responseBody: SchoolTeacherStudentListResponse = {
      classroom: serializeClassroom(request, env, classroom),
      students: await listSchoolStudents(env, classroom.id),
    };
    return jsonResponse(request, responseBody);
  }
  if (teacherStudentsMatch && request.method === 'POST') {
    const { classroom } = await requireTeacherClassroom(request, env, decodeURIComponent(teacherStudentsMatch[1]));
    const body = await parseJsonBody<SchoolStudentCreateRequestBody>(request);
    const responseBody: SchoolStudentCreateResponse = await createSchoolStudent(
      env,
      classroom,
      body.username,
    );
    return jsonResponse(request, responseBody, { status: 201 });
  }

  const resetMatch = /^\/api\/school\/classrooms\/([^/]+)\/teacher\/students\/([^/]+)\/reset-password$/.exec(url.pathname);
  if (resetMatch && request.method === 'POST') {
    const { classroom } = await requireTeacherClassroom(request, env, decodeURIComponent(resetMatch[1]));
    const responseBody: SchoolStudentResetPasswordResponse = await resetSchoolStudentPassword(
      env,
      classroom.id,
      decodeURIComponent(resetMatch[2]),
    );
    await clearStudentLoginLockout(env, classroom.id, responseBody.student.username, getClientIp(request));
    return jsonResponse(request, responseBody);
  }

  const disableMatch = /^\/api\/school\/classrooms\/([^/]+)\/teacher\/students\/([^/]+)\/disable$/.exec(url.pathname);
  if (disableMatch && request.method === 'POST') {
    const { classroom } = await requireTeacherClassroom(request, env, decodeURIComponent(disableMatch[1]));
    const responseBody: SchoolStudentDisableResponse = {
      student: await disableSchoolStudent(env, classroom.id, decodeURIComponent(disableMatch[2])),
    };
    return jsonResponse(request, responseBody);
  }

  const enableMatch = /^\/api\/school\/classrooms\/([^/]+)\/teacher\/students\/([^/]+)\/enable$/.exec(url.pathname);
  if (enableMatch && request.method === 'POST') {
    const { classroom } = await requireTeacherClassroom(request, env, decodeURIComponent(enableMatch[1]));
    const responseBody: SchoolStudentEnableResponse = {
      student: await enableSchoolStudent(env, classroom.id, decodeURIComponent(enableMatch[2])),
    };
    return jsonResponse(request, responseBody);
  }

  const loginMatch = /^\/api\/school\/classrooms\/([^/]+)\/student-login$/.exec(url.pathname);
  if (loginMatch && request.method === 'POST') {
    return handleStudentLogin(request, env, decodeURIComponent(loginMatch[1]));
  }

  throw new HttpError(404, 'School route not found.');
}

// Student logins on a shared school computer end after a school day, not 30 days.
const STUDENT_SESSION_MAX_AGE_SECONDS = 10 * 60 * 60;
const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
// Wrong passwords. Per student on one network: a few tries (kids mistype), and a teacher reset or
// a correct login clears it, so a classmate cannot keep someone locked out. Per student across
// networks: a looser cap that still stops guessing. Per classroom on one network: room for a
// whole class's typos, and one prankster can only affect their own class, not the school.
const STUDENT_LOGIN_FAILURES_PER_STUDENT_ON_NETWORK = 8;
const STUDENT_LOGIN_FAILURES_PER_STUDENT: RateLimitRule = { bucket: 'student-login:student', limit: 30, windowMs: FIFTEEN_MINUTES_MS };
const STUDENT_LOGIN_FAILURES_PER_CLASSROOM_NETWORK: RateLimitRule = { bucket: 'student-login:classroom-network', limit: 200, windowMs: FIFTEEN_MINUTES_MS };

async function studentLoginLimitKeys(env: Env, classroomId: string, username: string, ip: string | null) {
  const student = await hashRateLimitKey(env, `school:${classroomId}:${username.trim().toLowerCase()}`);
  const network = ip ? networkKeyForIp(ip) : 'network:unknown';
  return {
    student,
    // One bucket per student, keyed by network, so a reset can clear every network at once.
    studentOnNetwork: {
      rule: { bucket: `student-login:student-network:${student}`, limit: STUDENT_LOGIN_FAILURES_PER_STUDENT_ON_NETWORK, windowMs: FIFTEEN_MINUTES_MS },
      keyHash: await hashRateLimitKey(env, network),
    },
    classroomNetwork: await hashRateLimitKey(env, `school:${classroomId}:${network}`),
  };
}

/** A teacher reset (or a correct login) is the way out of a wrong-password lockout. */
export async function clearStudentLoginLockout(
  env: Env,
  classroomId: string,
  username: string,
  teacherIp: string | null = null,
): Promise<void> {
  const keys = await studentLoginLimitKeys(env, classroomId, username, teacherIp);
  await clearRateLimitEvents(env, STUDENT_LOGIN_FAILURES_PER_STUDENT.bucket, keys.student);
  await clearRateLimitBucket(env, keys.studentOnNetwork.rule.bucket);
  if (teacherIp) {
    // The teacher is usually on the class network, so a reset also lifts a class-wide lock.
    await clearRateLimitEvents(env, STUDENT_LOGIN_FAILURES_PER_CLASSROOM_NETWORK.bucket, keys.classroomNetwork);
  }
}

async function handleStudentLogin(
  request: Request,
  env: Env,
  rawSlug: string,
): Promise<Response> {
  const classroom = await loadActiveSchoolClassroomBySlug(env, rawSlug);
  const body = await parseJsonBody<SchoolStudentLoginRequestBody>(request);
  const username = typeof body.username === 'string' ? body.username : '';
  const keys = await studentLoginLimitKeys(env, classroom.id, username, getClientIp(request));
  const attempt = await takeRateLimitSlots(env, [
    { rule: STUDENT_LOGIN_FAILURES_PER_CLASSROOM_NETWORK, keyHash: keys.classroomNetwork },
    { rule: STUDENT_LOGIN_FAILURES_PER_STUDENT, keyHash: keys.student },
    keys.studentOnNetwork,
  ]);
  if (attempt.limitedBy) {
    throw new HttpError(429, attempt.limitedBy === STUDENT_LOGIN_FAILURES_PER_CLASSROOM_NETWORK
      ? 'Too many wrong sign-ins from this class right now. Wait 15 minutes, or ask your teacher to reset a password.'
      : 'Too many wrong passwords for this username. Wait 15 minutes, or ask your teacher to reset your password.');
  }
  // Each attempt holds a slot so parallel guesses cannot slip past the limit; only a wrong
  // username or password keeps it.
  let result: Awaited<ReturnType<typeof authenticateSchoolStudent>>;
  try {
    result = await authenticateSchoolStudent(
      env,
      classroom,
      body.username,
      body.password,
      body.newPassword,
    );
  } catch (error) {
    if (!(error instanceof HttpError && error.status === 401)) {
      await releaseRateLimitSlots(env, attempt.ids);
    }
    throw error;
  }
  await releaseRateLimitSlots(env, attempt.ids);
  await clearStudentLoginLockout(env, classroom.id, username);
  const publicClassroom = serializePublicClassroom(classroom);

  if (result.passwordResetRequired || !result.user) {
    const responseBody: SchoolStudentLoginResponse = {
      authenticated: false,
      passwordResetRequired: true,
      user: null,
      classroom: publicClassroom,
    };
    return jsonResponse(request, responseBody);
  }

  const sessionToken = await createSession(env, result.user.id, STUDENT_SESSION_MAX_AGE_SECONDS);
  const responseBody: SchoolStudentLoginResponse = {
    authenticated: true,
    passwordResetRequired: false,
    user: result.user,
    classroom: publicClassroom,
  };
  return jsonResponse(request, responseBody, {
    headers: {
      'Set-Cookie': createSessionCookie(request, sessionToken, STUDENT_SESSION_MAX_AGE_SECONDS),
    },
  });
}

async function requireTeacherClassroom(
  request: Request,
  env: Env,
  rawSlug: string,
): Promise<{ auth: RequestAuth; classroom: Awaited<ReturnType<typeof loadActiveSchoolClassroomBySlug>> }> {
  const classroom = await loadActiveSchoolClassroomBySlug(env, rawSlug);
  const auth = await requireAuthenticatedRequestAuth(env, request, 'manage this classroom');
  if (auth.source !== 'session') {
    throw new HttpError(403, 'Teacher classroom management requires an email sign-in session.');
  }
  assertTeacherCanManageClassroom(classroom, auth.user);
  return { auth, classroom };
}

