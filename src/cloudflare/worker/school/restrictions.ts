import { HttpError } from '../core/http';
import type { RequestAuth } from '../core/types';

export function assertNotSchoolRestricted(auth: Pick<RequestAuth, 'school'>, actionLabel: string): void {
  if (!auth.school) {
    return;
  }

  throw new HttpError(403, `School-managed student accounts cannot ${actionLabel}.`);
}

