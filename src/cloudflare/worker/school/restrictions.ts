import { HttpError } from '../core/http';
import type { Env, RequestAuth } from '../core/types';
import { loadSchoolAuthContextForUser } from './store';

export function assertNotSchoolRestricted(auth: Pick<RequestAuth, 'school'>, actionLabel: string): void {
  if (!auth.school) {
    return;
  }

  throw new HttpError(403, `School-managed student accounts cannot ${actionLabel}.`);
}

/** For routes that only have a session user (no RequestAuth with school context attached). */
export async function assertUserNotSchoolManaged(env: Env, userId: string, actionLabel: string): Promise<void> {
  const school = await loadSchoolAuthContextForUser(env, userId);
  if (school.context || school.disabled) {
    throw new HttpError(403, `School-managed student accounts cannot ${actionLabel}.`);
  }
}

