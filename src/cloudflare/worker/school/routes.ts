import type {
  SchoolClassroomCreateRequestBody,
  SchoolClassroomCreateResponse,
  SchoolStudentCreateRequestBody,
  SchoolStudentCreateResponse,
  SchoolStudentDisableResponse,
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
import type { Env, RequestAuth } from '../core/types';
import {
  assertTeacherCanManageClassroom,
  authenticateSchoolStudent,
  createSchoolClassroom,
  createSchoolStudent,
  disableSchoolStudent,
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

  const loginMatch = /^\/api\/school\/classrooms\/([^/]+)\/student-login$/.exec(url.pathname);
  if (loginMatch && request.method === 'POST') {
    return handleStudentLogin(request, env, decodeURIComponent(loginMatch[1]));
  }

  throw new HttpError(404, 'School route not found.');
}

async function handleStudentLogin(
  request: Request,
  env: Env,
  rawSlug: string,
): Promise<Response> {
  const classroom = await loadActiveSchoolClassroomBySlug(env, rawSlug);
  const body = await parseJsonBody<SchoolStudentLoginRequestBody>(request);
  const result = await authenticateSchoolStudent(
    env,
    classroom,
    body.username,
    body.password,
    body.newPassword,
  );
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

  const sessionToken = await createSession(env, result.user.id);
  const responseBody: SchoolStudentLoginResponse = {
    authenticated: true,
    passwordResetRequired: false,
    user: result.user,
    classroom: publicClassroom,
  };
  return jsonResponse(request, responseBody, {
    headers: {
      'Set-Cookie': createSessionCookie(request, sessionToken),
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

