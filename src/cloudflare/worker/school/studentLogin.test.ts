import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../core/types';
import { HttpError } from '../core/http';

const limits = vi.hoisted(() => ({ events: [] as Array<{ id: number; bucket: string; key: string }>, nextId: 1 }));
vi.mock('../core/rateLimit', async (importOriginal) => {
  const original = await importOriginal<typeof import('../core/rateLimit')>();
  return {
    ...original,
    hashRateLimitKey: vi.fn(async (_env: unknown, value: string) => value),
    takeRateLimitSlots: vi.fn(async (_env: unknown, checks: Array<{ rule: { bucket: string; limit: number }; keyHash: string }>) => {
      for (const { rule, keyHash } of checks) {
        if (limits.events.filter((e) => e.bucket === rule.bucket && e.key === keyHash).length >= rule.limit) {
          return { ids: [], limitedBy: rule };
        }
      }
      const ids = checks.map(({ rule, keyHash }) => {
        const id = limits.nextId++;
        limits.events.push({ id, bucket: rule.bucket, key: keyHash });
        return id;
      });
      return { ids, limitedBy: null };
    }),
    releaseRateLimitSlots: vi.fn(async (_env: unknown, ids: number[]) => {
      limits.events = limits.events.filter((e) => !ids.includes(e.id));
    }),
  };
});
vi.mock('./store', async (importOriginal) => {
  const original = await importOriginal<typeof import('./store')>();
  return {
    ...original,
    loadActiveSchoolClassroomBySlug: vi.fn(async () => ({ id: 'class-1', slug: 'room-12', display_name: 'Room 12' })),
    serializePublicClassroom: vi.fn(() => ({ slug: 'room-12', displayName: 'Room 12' })),
    authenticateSchoolStudent: vi.fn(async (_env: unknown, _classroom: unknown, _username: unknown, password: unknown) => {
      if (password !== 'correct-horse') throw new HttpError(401, 'Username or password is incorrect.');
      return { user: { id: 'student-user', displayName: 'kid' }, passwordResetRequired: false };
    }),
  };
});
const sessions = vi.hoisted(() => ({ maxAges: [] as number[] }));
vi.mock('../auth/store', async (importOriginal) => {
  const original = await importOriginal<typeof import('../auth/store')>();
  return {
    ...original,
    createSession: vi.fn(async (_env: unknown, _userId: string, maxAge: number) => {
      sessions.maxAges.push(maxAge);
      return 'session-token';
    }),
  };
});

import { handleSchoolRequest } from './routes';

const env = {} as Env;
function login(password: string, username = 'kid', ip = '203.0.113.20') {
  const request = new Request('https://api.wamp.land/api/school/classrooms/room-12/student-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify({ username, password }),
  });
  return handleSchoolRequest(request, new URL(request.url), env);
}

beforeEach(() => {
  limits.events = [];
  sessions.maxAges = [];
});

describe('student login', () => {
  it('locks one student after 8 wrong passwords in 15 minutes, even if the 9th is right', async () => {
    for (let guess = 0; guess < 8; guess += 1) {
      await expect(login(`wrong-${guess}`)).rejects.toThrow('incorrect');
    }
    await expect(login('correct-horse')).rejects.toThrow('Too many wrong passwords');
  });

  it('does not count successful logins, and a classmate is unaffected by one student being locked', async () => {
    for (let round = 0; round < 12; round += 1) {
      expect((await login('correct-horse')).status).toBe(200);
    }
    for (let guess = 0; guess < 8; guess += 1) {
      await expect(login(`wrong-${guess}`)).rejects.toThrow('incorrect');
    }
    expect((await login('correct-horse', 'classmate')).status).toBe(200);
  });

  it('keeps student logins to a school day on shared computers', async () => {
    const response = await login('correct-horse');
    expect(sessions.maxAges).toEqual([10 * 60 * 60]);
    expect(response.headers.get('Set-Cookie')).toContain('Max-Age=36000');
  });
});
