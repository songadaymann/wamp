import assert from 'node:assert/strict';
import {
  HttpError,
  corsHeaders,
  parseRoomSnapshot,
} from '../src/cloudflare/worker/core/http';
import {
  handleRoomRushRunStart,
  handleRoomRushRunSubmit,
} from '../src/cloudflare/worker/runs/roomRushLeaderboards';
import {
  createDefaultRoomSnapshot,
  roomIdFromCoordinates,
  type RoomCoordinates,
  type RoomSnapshot,
} from '../src/persistence/roomModel';

type BoundValue = string | number | null;

class MockStatement {
  values: BoundValue[] = [];

  constructor(
    private readonly db: MockD1Database,
    readonly query: string,
  ) {}

  bind(...values: BoundValue[]): MockStatement {
    this.values = values;
    return this;
  }

  async first<T>(): Promise<T | null> {
    return this.db.first<T>(this.query, this.values);
  }

  async all<T>(): Promise<{ results: T[] }> {
    return { results: this.db.all<T>(this.query, this.values) };
  }
}

class MockD1Database {
  readonly starts = new Map<string, Record<string, BoundValue>>();
  readonly runs: Record<string, BoundValue>[] = [];
  readonly rooms = new Map<string, RoomSnapshot>();

  prepare(query: string): MockStatement {
    return new MockStatement(this, query);
  }

  async batch(statements: MockStatement[]): Promise<unknown[]> {
    for (const statement of statements) {
      this.execute(statement.query, statement.values);
    }
    return [];
  }

  first<T>(query: string, values: BoundValue[]): T | null {
    if (query.includes('FROM api_tokens t')) {
      return {
        id: 'token-1',
        user_id: 'user-1',
        label: 'Safety Probe',
        scopes_json: JSON.stringify(['runs:write']),
        created_at: new Date(0).toISOString(),
        last_used_at: null,
        revoked_at: null,
        email: 'probe@example.com',
        wallet_address: null,
        display_name: 'Safety Probe',
        username: null,
        avatar_url: null,
        bio: null,
        selected_avatar_id: null,
        user_created_at: new Date(0).toISOString(),
      } as T;
    }

    if (query.includes('SELECT username, avatar_url, bio, selected_avatar_id')) {
      return {
        username: null,
        avatar_url: null,
        bio: null,
        selected_avatar_id: null,
      } as T;
    }

    if (query.includes('users_playfun_filter')) {
      return { found: 0 } as T;
    }

    if (query.includes('SELECT published_json') && query.includes('FROM rooms')) {
      const roomId = String(values[0]);
      const room = this.rooms.get(roomId);
      return room ? ({ published_json: JSON.stringify(room) } as T) : null;
    }

    if (query.includes('FROM room_rush_run_starts')) {
      return (this.starts.get(String(values[0])) as T | undefined) ?? null;
    }

    if (query.includes('FROM room_rush_runs') && query.includes('client_run_id')) {
      const [userId, clientRunId] = values;
      const run = this.runs.find(
        (candidate) => candidate.user_id === userId && candidate.client_run_id === clientRunId,
      );
      return run ? ({ attempt_id: run.attempt_id } as T) : null;
    }

    return null;
  }

  all<T>(query: string, values: BoundValue[]): T[] {
    if (query.includes('FROM rooms') && query.includes('published_json IS NOT NULL')) {
      const [minX, maxX, minY, maxY] = values.map(Number);
      return Array.from(this.rooms.values())
        .filter(
          (room) =>
            room.coordinates.x >= minX &&
            room.coordinates.x <= maxX &&
            room.coordinates.y >= minY &&
            room.coordinates.y <= maxY,
        )
        .map(
          (room) =>
            ({
              published_json: JSON.stringify(room),
              claimer_user_id: null,
              claimer_display_name: null,
              last_published_by_user_id: null,
              last_published_by_display_name: null,
            }) as T,
        );
    }

    return [];
  }

  private execute(query: string, values: BoundValue[]): void {
    if (query.includes('INSERT INTO room_rush_run_starts')) {
      this.starts.set(String(values[0]), {
        start_id: values[0],
        client_run_id: values[1],
        user_id: values[2],
        difficulty: values[3],
        start_rule: values[4],
        start_room_id: values[5],
        start_x: values[6],
        start_y: values[7],
        started_at: values[8],
        expires_at: values[9],
        consumed_attempt_id: null,
        consumed_at: null,
        created_at: values[10],
      });
      return;
    }

    if (query.includes('UPDATE room_rush_run_starts')) {
      const start = this.starts.get(String(values[2]));
      if (start && start.user_id === values[3] && start.consumed_attempt_id === null) {
        start.consumed_attempt_id = values[0];
        start.consumed_at = values[1];
      }
      return;
    }

    if (query.includes('INSERT INTO room_rush_runs')) {
      this.runs.push({
        attempt_id: values[0],
        client_run_id: values[1],
        user_id: values[2],
      });
    }
  }
}

function publishedRoom(coordinates: RoomCoordinates): RoomSnapshot {
  const id = roomIdFromCoordinates(coordinates);
  return {
    ...createDefaultRoomSnapshot(id, coordinates),
    status: 'published',
    publishedAt: new Date(0).toISOString(),
  };
}

function jsonRequest(path: string, body: unknown): Request {
  return new Request(`https://everybodys-platformer.novox-robot.workers.dev${path}`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer safety-probe-token',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function expectHttpError(
  status: number,
  action: () => Promise<unknown>,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    assert(error instanceof HttpError, `Expected HttpError ${status}.`);
    assert.equal(error.status, status);
    return;
  }

  assert.fail(`Expected HttpError ${status}.`);
}

async function probeCors(): Promise<void> {
  const hostile = corsHeaders(
    new Request('https://everybodys-platformer.novox-robot.workers.dev/api/auth/session', {
      headers: { Origin: 'https://evil.example' },
    }),
  ) as Record<string, string>;
  assert.equal(hostile['Access-Control-Allow-Origin'], '*');
  assert.equal(hostile['Access-Control-Allow-Credentials'], undefined);

  const trusted = corsHeaders(
    new Request('https://everybodys-platformer.novox-robot.workers.dev/api/auth/session', {
      headers: { Origin: 'https://wampland.pages.dev' },
    }),
  ) as Record<string, string>;
  assert.equal(trusted['Access-Control-Allow-Origin'], 'https://wampland.pages.dev');
  assert.equal(trusted['Access-Control-Allow-Credentials'], 'true');
}

async function probeRoomSnapshots(): Promise<void> {
  const valid = publishedRoom({ x: 0, y: 0 });
  await parseRoomSnapshot(jsonRequest('/api/rooms/0,0', valid), valid.id);

  const badLayer = structuredClone(valid);
  badLayer.tileData.background = badLayer.tileData.background.slice(0, -1);
  await expectHttpError(400, () => parseRoomSnapshot(jsonRequest('/api/rooms/0,0', badLayer), valid.id));

  const badObject = structuredClone(valid);
  badObject.placedObjects.push({ id: 'not-a-real-object', x: 10, y: 10 });
  await expectHttpError(400, () => parseRoomSnapshot(jsonRequest('/api/rooms/0,0', badObject), valid.id));

  await expectHttpError(413, () =>
    parseRoomSnapshot(
      new Request('https://everybodys-platformer.novox-robot.workers.dev/api/rooms/0,0', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(2 * 1024 * 1024 + 1),
        },
        body: '{}',
      }),
      valid.id,
    ),
  );
}

async function probeRoomRush(): Promise<void> {
  const db = new MockD1Database();
  db.rooms.set('0,0', publishedRoom({ x: 0, y: 0 }));
  db.rooms.set('1,0', publishedRoom({ x: 1, y: 0 }));
  db.rooms.set('2,0', publishedRoom({ x: 2, y: 0 }));
  const env = {
    DB: db,
    ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
    EXPANDED_ROOMS_ENABLED: '0',
  };

  const startResponse = await handleRoomRushRunStart(
    jsonRequest('/api/room-rush/runs/start', {
      difficulty: 'easy',
      startRule: 'selected',
      startCoordinates: { x: 0, y: 0 },
    }),
    env as never,
  );
  assert.equal(startResponse.status, 201);
  const start = (await startResponse.json()) as { startId: string; clientRunId: string };

  const baseSubmission = {
    startId: start.startId,
    clientRunId: start.clientRunId,
    difficulty: 'easy',
    startRule: 'selected',
    result: 'completed',
    elapsedMs: 1000,
    deaths: 0,
    visitedRoomIds: ['0,0', '1,0'],
    startCoordinates: { x: 0, y: 0 },
    finishCoordinates: { x: 1, y: 0 },
    route: [
      {
        routeIndex: 0,
        roomId: '0,0',
        coordinates: { x: 0, y: 0 },
        uniqueVisitIndex: 1,
      },
      {
        routeIndex: 1,
        roomId: '1,0',
        coordinates: { x: 1, y: 0 },
        uniqueVisitIndex: 2,
      },
    ],
  };

  await expectHttpError(400, () =>
    handleRoomRushRunSubmit(
      jsonRequest('/api/room-rush/runs', {
        ...baseSubmission,
        finishCoordinates: { x: 2, y: 0 },
        route: [
          baseSubmission.route[0],
          {
            ...baseSubmission.route[1],
            roomId: '2,0',
            coordinates: { x: 2, y: 0 },
          },
        ],
      }),
      env as never,
    ),
  );

  const finishResponse = await handleRoomRushRunSubmit(
    jsonRequest('/api/room-rush/runs', baseSubmission),
    env as never,
  );
  assert.equal(finishResponse.status, 201);
  assert.equal(db.runs.length, 1);
}

await probeCors();
await probeRoomSnapshots();
await probeRoomRush();
console.log('Worker safety probes passed.');
