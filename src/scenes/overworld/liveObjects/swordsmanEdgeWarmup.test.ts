import { describe, expect, it } from 'vitest';
import { getTilesetByKey, ROOM_HEIGHT, ROOM_WIDTH, TILE_SIZE } from '../../../config';
import { createDefaultRoomSnapshot, type RoomSnapshot } from '../../../persistence/roomModel';
import {
  buildSwordsmanTraversalGraph,
  startSwordsmanTraversalGraphBuild,
  type SwordsmanTraversalGraph,
} from '../../../enemies/swordsmanTraversal';
import {
  planSwordsmanRobustTraversal,
  prepareSwordsmanTraversalEdgeSimulation,
} from '../../../enemies/swordsmanRobustPlanner';
import {
  enqueueGameplayWarmupWork,
  FrameWorkCoordinator,
  getFrameWorkBudget,
  type FrameWorkPerformanceProfile,
  type FrameWorkPriority,
} from '../frameWorkCoordinator';
import { SWORDSMAN_EDGE_WARMUP_CHUNK_MS, SwordsmanEdgeWarmup } from './swordsmanEdgeWarmup';

const GROUND = getTilesetByKey('forest')!.firstGid + 14;
const CLOCK_TICK_MS = 0.05;
let roomSerial = 0;

function buildRoom(walls: Array<[number, number, number]> = []): RoomSnapshot {
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
  for (const [tileX, fromTileY, toTileY] of walls) {
    for (let tileY = fromTileY; tileY <= toTileY; tileY += 1) room.tileData.terrain[tileY][tileX] = GROUND;
  }
  return room;
}

function hunter(objectiveMode: string | null = 'collect', width = 16, height = 32) {
  return {
    runtime: { aiObjectiveMode: objectiveMode },
    sprite: { scene: {} as object | undefined, body: { width, height } },
  };
}

function loadedRoom(...liveObjects: Array<ReturnType<typeof hunter>>) {
  return { room: buildRoom(), liveObjects, runtimeSuspended: false };
}

/**
 * The real frame-work coordinator with the production warm-up job spec, on a clock where every
 * read costs 0.05 ms, so a job's chunk buys a fixed number of graph pieces or edges.
 */
function harness() {
  let clock = 1_000;
  const now = (): number => (clock += CLOCK_TICK_MS);
  const coordinator = new FrameWorkCoordinator({ now });
  const graphs = new Map<RoomSnapshot, SwordsmanTraversalGraph>();
  const graphRequests: RoomSnapshot[] = [];
  const warmup = new SwordsmanEdgeWarmup({
    getGraph: (room, prebuilt) => {
      graphRequests.push(room);
      const graph = graphs.get(room) ?? prebuilt ?? buildSwordsmanTraversalGraph(room);
      graphs.set(room, graph);
      return graph;
    },
    enqueueBackgroundCpuWork: (label, execute, onCancelled) =>
      enqueueGameplayWarmupWork(coordinator, label, execute, onCancelled),
    now,
  });
  const runFrame = (profile: FrameWorkPerformanceProfile = 'normal') =>
    coordinator.runFrame({ profile, criticalHeadroomMs: 12 });
  const enqueueStreamingJob = (priority: FrameWorkPriority, label: string, costMs: number) =>
    coordinator.enqueue({
      label,
      priority,
      costKind: 'cpu',
      estimatedCostMs: 0.75,
      execute: () => { clock += costMs; },
    });
  const warmupJobsIn = (result: ReturnType<typeof runFrame>) =>
    result.executed.filter((execution) => execution.priority === 'gameplay-warmup');
  return { coordinator, warmup, graphs, graphRequests, runFrame, enqueueStreamingJob, warmupJobsIn };
}

function coldEdgesLeft(room: RoomSnapshot, width = 16, height = 32): number {
  const graph = buildSwordsmanTraversalGraph(room);
  return Array.from(graph.edgesById.values())
    .filter((edge) => prepareSwordsmanTraversalEdgeSimulation(room, graph, edge, width, height)).length;
}

describe('Sword Hunter jump warm-up on the frame-work coordinator (F302)', () => {
  it('does not delay teardown or room preparation by a single frame', () => {
    const queueStreamingWork = (setup: ReturnType<typeof harness>) => {
      for (let index = 0; index < 5; index += 1) setup.enqueueStreamingJob('teardown', `teardown-${index}`, 0.7);
      for (let index = 0; index < 3; index += 1) setup.enqueueStreamingJob('preview-cosmetic', `far-room-${index}`, 0.7);
    };
    const framesToDrain = (setup: ReturnType<typeof harness>, profile: FrameWorkPerformanceProfile) => {
      let frames = 0;
      while (
        setup.coordinator.hasQueuedWorkAtPriority('teardown')
        || setup.coordinator.hasQueuedWorkAtPriority('preview-cosmetic')
      ) {
        const result = setup.runFrame(profile);
        frames += 1;
        const streamingStillQueued = setup.coordinator.hasQueuedWorkAtPriority('teardown')
          || setup.coordinator.hasQueuedWorkAtPriority('preview-cosmetic');
        if (streamingStillQueued) expect(setup.warmupJobsIn(result)).toHaveLength(0);
      }
      return frames;
    };

    for (const profile of ['normal', 'reduced'] as const) {
      const withoutWarmup = harness();
      queueStreamingWork(withoutWarmup);
      const withWarmup = harness();
      withWarmup.warmup.queueRoom(loadedRoom(hunter()));
      queueStreamingWork(withWarmup);
      expect(framesToDrain(withWarmup, profile)).toBe(framesToDrain(withoutWarmup, profile));
    }
  });

  it.each(['normal', 'reduced'] as const)('stays inside the %s profile CPU cap every frame until the room is warm', (profile) => {
    const setup = harness();
    const room = loadedRoom(hunter());
    setup.warmup.queueRoom(room);
    const cpuCapMs = getFrameWorkBudget(profile).cpuSubCapMs;
    let frames = 0;
    while (setup.warmup.hasPendingWork(room.room.id) && frames < 2_000) {
      const result = setup.runFrame(profile);
      frames += 1;
      expect(setup.warmupJobsIn(result).length).toBeLessThanOrEqual(profile === 'reduced' ? 1 : 2);
      // A chunk stops before the piece or edge that would start past its 0.8 ms.
      for (const job of setup.warmupJobsIn(result)) {
        expect(job.actualDurationMs).toBeLessThanOrEqual(SWORDSMAN_EDGE_WARMUP_CHUNK_MS + 4 * CLOCK_TICK_MS);
      }
      expect(result.actualCpuWorkMs).toBeLessThanOrEqual(cpuCapMs + 8 * CLOCK_TICK_MS);
    }
    expect(setup.warmup.hasPendingWork(room.room.id)).toBe(false);
    expect(coldEdgesLeft(room.room)).toBe(0);
  });

  it('builds the jump graph over several jobs, then hands it to the scene cache', () => {
    const setup = harness();
    const room = loadedRoom(hunter());
    const oneShot = buildSwordsmanTraversalGraph(room.room);
    const pieces = 1 + oneShot.surfaceSegments.length + oneShot.wallSegments.length + 1;
    setup.warmup.queueRoom(room);
    let jobs = 0;
    while (setup.graphRequests.length === 0 && jobs < 100) {
      jobs += setup.warmupJobsIn(setup.runFrame('reduced')).length;
    }
    // One clock read before each piece: about 16 pieces fit a 0.8 ms job.
    const piecesPerJob = SWORDSMAN_EDGE_WARMUP_CHUNK_MS / CLOCK_TICK_MS;
    expect(jobs).toBeGreaterThanOrEqual(Math.ceil(pieces / piecesPerJob));
    expect(jobs).toBeLessThanOrEqual(Math.ceil(pieces / (piecesPerJob - 2)));
    expect(setup.graphRequests).toEqual([room.room]);
    expect(setup.graphs.get(room.room)).toEqual(oneShot);
  });

  it('notes a room in play without simulating anything, and warms it before older rooms', () => {
    const setup = harness();
    const older = loadedRoom(hunter());
    const played = loadedRoom(hunter());
    setup.warmup.queueRoom(older);
    setup.warmup.queueRoom(played);
    setup.warmup.noteActiveRoom(played, 1);
    setup.warmup.noteActiveRoom(played, 1);
    expect(setup.graphRequests).toHaveLength(0);
    expect(setup.coordinator.getDiagnostics().queueDepthByPriority['gameplay-warmup']).toBe(1);

    while (setup.warmup.hasPendingWork(played.room.id)) setup.runFrame();
    expect(setup.warmup.hasPendingWork(older.room.id)).toBe(true);
    expect(setup.graphRequests).toEqual([played.room]);
  });

  it('never warms a suspended room, and resumes once it is played again', () => {
    const setup = harness();
    const left = loadedRoom(hunter());
    left.runtimeSuspended = true;
    setup.warmup.queueRoom(left);
    expect(setup.coordinator.getDiagnostics().queueDepth).toBe(0);

    const playing = loadedRoom(hunter());
    setup.warmup.queueRoom(playing);
    while (setup.coordinator.getDiagnostics().queueDepth > 0) setup.runFrame();
    expect(setup.graphRequests).toEqual([playing.room]);
    expect(setup.warmup.hasPendingWork(left.room.id)).toBe(true);

    left.runtimeSuspended = false;
    setup.warmup.noteActiveRoom(left, 7);
    while (setup.coordinator.getDiagnostics().queueDepth > 0) setup.runFrame();
    expect(setup.warmup.hasPendingWork(left.room.id)).toBe(false);
  });

  it('releases its rooms when a stream reset cancels the queued job', () => {
    const setup = harness();
    const first = loadedRoom(hunter());
    setup.warmup.queueRoom(first);
    setup.runFrame();
    expect(setup.coordinator.cancelAll('stream-reset')).toBe(1);
    expect(setup.warmup.hasPendingWork(first.room.id)).toBe(false);

    const reloaded = loadedRoom(hunter());
    setup.warmup.queueRoom(reloaded);
    expect(setup.coordinator.getDiagnostics().queueDepth).toBe(1);
  });

  it('drops a room whose hunters were destroyed', () => {
    const setup = harness();
    const racer = hunter();
    const room = loadedRoom(racer);
    setup.warmup.queueRoom(room);
    racer.sprite.scene = undefined;
    setup.runFrame();
    expect(setup.warmup.hasPendingWork(room.room.id)).toBe(false);
    expect(setup.coordinator.getDiagnostics().queueDepth).toBe(0);
  });

  it('warms each collecting body size and ignores rooms with no coin-collecting hunter', () => {
    const setup = harness();
    setup.warmup.queueRoom(loadedRoom(hunter('duel'), hunter(null)));
    expect(setup.coordinator.getDiagnostics().queueDepth).toBe(0);

    const room = loadedRoom(hunter('collect'), hunter('collect', 22, 38), hunter('collect'));
    setup.warmup.queueRoom(room);
    while (setup.coordinator.getDiagnostics().queueDepth > 0) setup.runFrame();
    expect(coldEdgesLeft(room.room, 16, 32)).toBe(0);
    expect(coldEdgesLeft(room.room, 22, 38)).toBe(0);
    expect(coldEdgesLeft(room.room, 20, 32)).toBeGreaterThan(0);

    const ground = (ROOM_HEIGHT - 2) * TILE_SIZE;
    const standing = (centerX: number, bottom: number) => ({
      centerX, centerY: bottom - 16, left: centerX - 8, right: centerX + 8, bottom, onFloor: true, wallContactSide: 0 as const,
    });
    const firstPlan = planSwordsmanRobustTraversal({
      room: room.room, graph: setup.graphs.get(room.room)!, enemy: standing(2 * TILE_SIZE, ground),
      target: standing(36 * TILE_SIZE, 5 * TILE_SIZE), blockedEdgeIds: new Set(), bodyWidth: 16, bodyHeight: 32,
    });
    expect(firstPlan?.edges.length).toBeGreaterThan(0);
    expect(firstPlan?.coldSimulatedEdges).toBe(0);
  });
});

describe('stepped traversal graph build (F302)', () => {
  it('builds exactly the one-shot graph, in the same edge order, one piece per step', () => {
    const room = buildRoom([[20, 2, 8], [33, 9, 16]]);
    const build = startSwordsmanTraversalGraphBuild(room);
    let graph: SwordsmanTraversalGraph | null = null;
    let steps = 0;
    while (!graph) {
      let piecesThisStep = 0;
      graph = build.step(() => piecesThisStep++ >= 1);
      steps += 1;
    }
    const oneShot = buildSwordsmanTraversalGraph(room);
    expect(graph.wallSegments.length).toBeGreaterThan(0);
    expect(steps).toBe(1 + graph.surfaceSegments.length + graph.wallSegments.length + 1);
    expect(graph).toEqual(oneShot);
    expect(Array.from(graph.edgesById.keys())).toEqual(Array.from(oneShot.edgesById.keys()));
  });
});
