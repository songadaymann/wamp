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
    clearRateLimitEvents: vi.fn(async (_env: unknown, bucket: string, key: string) => {
      limits.events = limits.events.filter((e) => !(e.bucket === bucket && e.key === key));
    }),
    clearRateLimitBucket: vi.fn(async (_env: unknown, bucket: string) => {
      limits.events = limits.events.filter((e) => e.bucket !== bucket);
    }),
  };
});
vi.mock('./store', async (importOriginal) => {
  const original = await importOriginal<typeof import('./store')>();
  return {
    ...original,
    loadActiveSchoolClassroomBySlug: vi.fn(async (_env: unknown, slug: string) => ({ id: `class-${slug}`, slug, display_name: slug })),
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

import { clearStudentLoginLockout, handleSchoolRequest } from './routes';

const env = {} as Env;
function login(password: string, username = 'kid', ip = '203.0.113.20', classroom = 'room-12') {
  const request = new Request(`https://api.wamp.land/api/school/classrooms/${classroom}/student-login`, {
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
  it('locks one student on one network after 8 wrong passwords in 15 minutes, even if the 9th is right', async () => {
    for (let guess = 0; guess < 8; guess += 1) {
      await expect(login(`wrong-${guess}`)).rejects.toThrow('incorrect');
    }
    await expect(login('correct-horse')).rejects.toThrow('Too many wrong passwords for this username');
  });

  it('a teacher reset unlocks the student, as the message promises', async () => {
    for (let guess = 0; guess < 8; guess += 1) {
      await expect(login(`wrong-${guess}`)).rejects.toThrow('incorrect');
    }
    await clearStudentLoginLockout(env, 'class-room-12', 'Kid ', '203.0.113.20');
    expect((await login('correct-horse')).status).toBe(200);
  });

  it('a classmate on another network cannot lock the student out at school', async () => {
    for (let guess = 0; guess < 8; guess += 1) {
      await expect(login(`wrong-${guess}`, 'kid', '198.51.100.9')).rejects.toThrow('incorrect');
    }
    expect((await login('correct-horse', 'kid', '203.0.113.20')).status).toBe(200);
  });

  it('a correct login clears earlier typos, and successes never count', async () => {
    for (let guess = 0; guess < 7; guess += 1) {
      await expect(login(`wrong-${guess}`)).rejects.toThrow('incorrect');
    }
    expect((await login('correct-horse')).status).toBe(200);
    for (let guess = 0; guess < 7; guess += 1) {
      await expect(login(`wrong-again-${guess}`)).rejects.toThrow('incorrect');
    }
    expect((await login('correct-horse')).status).toBe(200);
  });

  it('one class hitting its network cap does not lock out another class in the building', async () => {
    for (let guess = 0; guess < 200; guess += 1) {
      await expect(login('wrong', `made-up-${guess}`, '203.0.113.20', 'room-12')).rejects.toThrow('incorrect');
    }
    await expect(login('correct-horse', 'kid', '203.0.113.20', 'room-12')).rejects.toThrow('Too many wrong sign-ins from this class');
    expect((await login('correct-horse', 'kid', '203.0.113.20', 'room-14')).status).toBe(200);
  });

  it('keeps student logins to a school day on shared computers', async () => {
    const response = await login('correct-horse');
    expect(sessions.maxAges).toEqual([10 * 60 * 60]);
    expect(response.headers.get('Set-Cookie')).toContain('Max-Age=36000');
  });
});
