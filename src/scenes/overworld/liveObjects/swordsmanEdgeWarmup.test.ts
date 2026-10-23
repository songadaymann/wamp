import { describe, expect, it } from 'vitest';
import { getTilesetByKey, ROOM_HEIGHT, ROOM_WIDTH, TILE_SIZE } from '../../../config';
import { createDefaultRoomSnapshot, type RoomSnapshot } from '../../../persistence/roomModel';
import { buildSwordsmanTraversalGraph, type SwordsmanTraversalGraph } from '../../../enemies/swordsmanTraversal';
import {
  planSwordsmanRobustTraversal,
  prepareSwordsmanTraversalEdgeSimulation,
} from '../../../enemies/swordsmanRobustPlanner';
import {
  SWORDSMAN_EDGE_WARMUP_ACTIVE_CHUNK_MS,
  SWORDSMAN_EDGE_WARMUP_BACKGROUND_CHUNK_MS,
  SwordsmanEdgeWarmup,
} from './swordsmanEdgeWarmup';

const GROUND = getTilesetByKey('forest')!.firstGid + 14;
let roomSerial = 0;

function denseRoom(): RoomSnapshot {
  roomSerial += 1;
  const room = createDefaultRoomSnapshot(`edge-warmup-${roomSerial}`, { x: roomSerial, y: 0 });
  for (let tileX = 0; tileX < ROOM_WIDTH; tileX += 1) {
    room.tileData.terrain[ROOM_HEIGHT - 1][tileX] = GROUND;
    room.tileData.terrain[ROOM_HEIGHT - 2][tileX] = GROUND;
  }
  for (const tileY of [17, 14, 11, 8, 5]) {
    for (let tileX = tileY % 2 ? 1 : 3; tileX < 38; tileX += 5) {
      for (let x = tileX; x <= tileX + 2; x += 1) room.tileData.terrain[tileY][x] = GROUND;
    }
  }
  return room;
}

function hunter(objectiveMode: string | null = 'collect', width = 16, height = 32) {
  return {
    runtime: { aiObjectiveMode: objectiveMode },
    sprite: {
      active: true,
      scene: {} as object | undefined,
      body: { width, height, enable: true },
    },
  };
}

/** Each clock read costs 0.1 ms, so a chunk's budget buys a fixed number of edges. */
function harness() {
  let now = 0;
  const jobs: Array<{ state: string; execute: () => void }> = [];
  const graphs = new Map<RoomSnapshot, SwordsmanTraversalGraph>();
  let graphRequests = 0;
  const graphFor = (room: RoomSnapshot): SwordsmanTraversalGraph =>
    graphs.get(room) ?? graphs.set(room, buildSwordsmanTraversalGraph(room)).get(room)!;
  const warmup = new SwordsmanEdgeWarmup({
    getGraph: (room) => {
      graphRequests += 1;
      return graphFor(room);
    },
    enqueueBackgroundCpuWork: (_label, execute) => {
      const job = { state: 'queued', execute };
      jobs.push(job);
      return job;
    },
    now: () => (now += 0.1),
  });
  const runQueuedJob = (): boolean => {
    const job = jobs.find((candidate) => candidate.state === 'queued');
    if (!job) return false;
    job.state = 'running';
    job.execute();
    job.state = 'completed';
    return true;
  };
  return { warmup, jobs, runQueuedJob, graphFor, graphRequests: () => graphRequests };
}

function firstPlanColdEdges(room: RoomSnapshot, graph: SwordsmanTraversalGraph, width = 16, height = 32): number {
  const ground = (ROOM_HEIGHT - 2) * TILE_SIZE;
  const standing = (centerX: number, bottom: number) => ({
    centerX, centerY: bottom - height / 2, left: centerX - width / 2, right: centerX + width / 2, bottom, onFloor: true, wallContactSide: 0 as const,
  });
  return planSwordsmanRobustTraversal({
    room, graph, enemy: standing(2 * TILE_SIZE, ground), target: standing(36 * TILE_SIZE, 5 * TILE_SIZE),
    blockedEdgeIds: new Set(), bodyWidth: width, bodyHeight: height,
  })!.coldSimulatedEdges;
}

/** How many of the room's edges still needed simulating for this body (simulating them now). */
function coldEdgesLeft(room: RoomSnapshot, graph: SwordsmanTraversalGraph, width: number, height: number): number {
  return Array.from(graph.edgesById.values())
    .filter((edge) => prepareSwordsmanTraversalEdgeSimulation(room, graph, edge, width, height)).length;
}

describe('Sword Hunter jump warm-up (F302)', () => {
  it('simulates a prepared room in small background jobs until the first plan finds it all cached', () => {
    const { warmup, jobs, runQueuedJob, graphFor } = harness();
    const room = denseRoom();
    warmup.queueRoom({ room, liveObjects: [hunter('duel'), hunter('collect')] });
    expect(jobs).toHaveLength(1);

    let chunks = 0;
    while (runQueuedJob()) chunks += 1;
    // ~570 edges at 0.1 ms of clock per edge in 0.8 ms chunks, after a chunk for the graph.
    const edgeCount = graphFor(room).edgesById.size;
    expect(chunks).toBeGreaterThan(edgeCount / (SWORDSMAN_EDGE_WARMUP_BACKGROUND_CHUNK_MS / 0.1));
    expect(warmup.hasPendingWork(room.id)).toBe(false);
    expect(firstPlanColdEdges(room, graphFor(room))).toBe(0);
  });

  it('warms each collecting body size and ignores rooms with no coin-collecting hunter', () => {
    const { warmup, jobs, runQueuedJob, graphFor } = harness();
    warmup.queueRoom({ room: denseRoom(), liveObjects: [hunter('duel'), hunter(null)] });
    expect(jobs).toHaveLength(0);

    const room = denseRoom();
    warmup.queueRoom({ room, liveObjects: [hunter('collect'), hunter('collect', 22, 38), hunter('collect')] });
    while (runQueuedJob()) { /* drain */ }
    expect(coldEdgesLeft(room, graphFor(room), 16, 32)).toBe(0);
    expect(coldEdgesLeft(room, graphFor(room), 22, 38)).toBe(0);
    expect(coldEdgesLeft(room, graphFor(room), 20, 32)).toBeGreaterThan(0);
  });

  it('finishes with larger chunks once a hunter in the room is awake, never waiting to plan', () => {
    const { warmup, graphFor, graphRequests } = harness();
    const room = denseRoom();
    const racer = hunter();
    const loadedRoom = { room, liveObjects: [racer] };
    warmup.queueRoom(loadedRoom);

    racer.sprite.active = false;
    warmup.runForActiveRoom(loadedRoom, 1);
    racer.sprite.active = true;
    racer.sprite.body.enable = false;
    warmup.runForActiveRoom(loadedRoom, 2);
    // Dormant and distance-sleeping hunters do not plan, so neither frame started on the room.
    expect(graphRequests()).toBe(0);

    racer.sprite.body.enable = true;
    let frames = 0;
    for (let frame = 3; warmup.hasPendingWork(room.id) && frame < 500; frame += 1) {
      warmup.runForActiveRoom(loadedRoom, frame);
      warmup.runForActiveRoom(loadedRoom, frame);
      frames += 1;
    }
    const edgeCount = graphFor(room).edgesById.size;
    const edgesPerChunk = SWORDSMAN_EDGE_WARMUP_ACTIVE_CHUNK_MS / 0.1;
    expect(frames).toBeGreaterThanOrEqual(Math.floor(edgeCount / edgesPerChunk));
    expect(frames).toBeLessThanOrEqual(Math.ceil(edgeCount / (edgesPerChunk - 2)) + 1);
    expect(firstPlanColdEdges(room, graphFor(room))).toBe(0);
  });

  it('drops a room whose hunters were destroyed', () => {
    const { warmup, runQueuedJob } = harness();
    const room = denseRoom();
    const racer = hunter();
    warmup.queueRoom({ room, liveObjects: [racer] });
    racer.sprite.scene = undefined as unknown as object;
    runQueuedJob();
    expect(warmup.hasPendingWork(room.id)).toBe(false);
  });
});
