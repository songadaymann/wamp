import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTilesetByKey, ROOM_HEIGHT, ROOM_WIDTH, TILE_SIZE } from '../../../config';
import { createDefaultRoomSnapshot, type RoomSnapshot } from '../../../persistence/roomModel';
import {
  buildSwordsmanTraversalGraph,
  getSwordsmanTraversalGraphForRoom,
  rememberSwordsmanTraversalGraph,
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
import {
  SWORDSMAN_EDGE_WARMUP_ARRIVAL_BUDGET_MS,
  SWORDSMAN_EDGE_WARMUP_CHUNK_MS,
  SWORDSMAN_EDGE_WARMUP_MAX_UNITS_PER_JOB,
  SwordsmanEdgeWarmup,
} from './swordsmanEdgeWarmup';

const GROUND = getTilesetByKey('forest')!.firstGid + 14;
let roomSerial = 0;

function buildRoom(options: { ledges?: boolean; walls?: Array<[number, number, number]> } = {}): RoomSnapshot {
  roomSerial += 1;
  const room = createDefaultRoomSnapshot(`edge-warmup-${roomSerial}`, { x: roomSerial, y: 0 });
  for (let tileX = 0; tileX < ROOM_WIDTH; tileX += 1) {
    room.tileData.terrain[ROOM_HEIGHT - 1][tileX] = GROUND;
    room.tileData.terrain[ROOM_HEIGHT - 2][tileX] = GROUND;
  }
  if (options.ledges !== false) {
    for (const tileY of [17, 14, 11, 8, 5]) {
      for (let tileX = tileY % 2 ? 1 : 3; tileX < 38; tileX += 5) {
        for (let x = tileX; x <= tileX + 2; x += 1) room.tileData.terrain[tileY][x] = GROUND;
      }
    }
  }
  for (const [tileX, fromTileY, toTileY] of options.walls ?? []) {
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

function loadedRoom(room = buildRoom(), ...liveObjects: Array<ReturnType<typeof hunter>>) {
  return { room, liveObjects: liveObjects.length > 0 ? liveObjects : [hunter()], runtimeSuspended: false };
}

interface HarnessOptions {
  /** Cost each graph piece and each edge charges to the fake clock. */
  pieceMs?: number;
  edgeMs?: (edgeIndex: number) => number;
  /** Clock reads round down to this resolution (Firefox resistFingerprinting: 100 ms). */
  clockResolutionMs?: number;
}

/**
 * The real frame-work coordinator and the production job spec, on a fake clock that only moves
 * when work is done: every graph piece, edge and streaming job charges its cost.
 */
function harness({ pieceMs = 0.12, edgeMs = () => 0.06, clockResolutionMs = 0 }: HarnessOptions = {}) {
  let clock = 1_000;
  const read = (): number => (clockResolutionMs > 0 ? Math.floor(clock / clockResolutionMs) * clockResolutionMs : clock);
  const coordinator = new FrameWorkCoordinator({ now: read });
  let unitsThisJob = 0;
  const unitsPerJob: number[] = [];
  const counts = { pieces: 0, edges: 0 };
  let edgeIndex = 0;
  const warmup = new SwordsmanEdgeWarmup({
    enqueueBackgroundCpuWork: (label, execute, onCancelled, priority) => enqueueGameplayWarmupWork(
      coordinator,
      label,
      () => {
        unitsThisJob = 0;
        execute();
        unitsPerJob.push(unitsThisJob);
      },
      onCancelled,
      priority,
    ),
    now: read,
    startGraphBuild: (room) => {
      const build = startSwordsmanTraversalGraphBuild(room);
      return {
        buildNextPiece: () => {
          clock += pieceMs;
          unitsThisJob += 1;
          counts.pieces += 1;
          return build.buildNextPiece();
        },
      };
    },
    prepareEdge: (...args) => {
      clock += edgeMs(edgeIndex);
      edgeIndex += 1;
      unitsThisJob += 1;
      counts.edges += 1;
      return prepareSwordsmanTraversalEdgeSimulation(...args);
    },
  });
  const runFrame = (profile: FrameWorkPerformanceProfile = 'normal', options: { gameplayCpuCapMs?: number; gameplayOnly?: boolean } = {}) =>
    coordinator.runFrame({
      profile,
      criticalHeadroomMs: 12,
      gameplayCpuCapMs: options.gameplayCpuCapMs ?? getFrameWorkBudget(profile).cpuSubCapMs,
      gameplayOnly: options.gameplayOnly,
    });
  const enqueueStreamingJob = (priority: FrameWorkPriority, label: string, costMs: number, costKind: 'cpu' | 'gpu-upload' = 'cpu') =>
    coordinator.enqueue({
      label,
      priority,
      costKind,
      estimatedCostMs: 0.75,
      execute: () => { clock += costMs; },
    });
  const gameplayJobsIn = (result: ReturnType<typeof runFrame>) =>
    result.executed.filter((execution) => execution.priority === 'gameplay-warmup' || execution.priority === 'gameplay-catch-up');
  const elapsed = (work: () => void): number => {
    const startedAt = clock;
    work();
    return clock - startedAt;
  };
  return { coordinator, warmup, counts, unitsPerJob, runFrame, enqueueStreamingJob, gameplayJobsIn, elapsed };
}

/** Plans like a hunter standing on the ground chasing a coin on the top row; returns its cold edges. */
function firstPlanColdEdges(room: RoomSnapshot): number {
  const ground = (ROOM_HEIGHT - 2) * TILE_SIZE;
  const standing = (centerX: number, bottom: number) => ({
    centerX, centerY: bottom - 16, left: centerX - 8, right: centerX + 8, bottom, onFloor: true, wallContactSide: 0 as const,
  });
  const plan = planSwordsmanRobustTraversal({
    room, graph: getSwordsmanTraversalGraphForRoom(room), enemy: standing(2 * TILE_SIZE, ground),
    target: standing(36 * TILE_SIZE, 5 * TILE_SIZE), blockedEdgeIds: new Set(), bodyWidth: 16, bodyHeight: 32,
  });
  expect(plan?.edges.length).toBeGreaterThan(0);
  return plan!.coldSimulatedEdges;
}

function coldEdgesLeft(room: RoomSnapshot, width: number, height: number): number {
  const graph = buildSwordsmanTraversalGraph(room);
  return Array.from(graph.edgesById.values())
    .filter((edge) => prepareSwordsmanTraversalEdgeSimulation(room, graph, edge, width, height)).length;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Sword Hunter jump warm-up: warm before the first plan (F302)', () => {
  it('run start: the spawn room finishes on the spot, before any frame work has run', () => {
    const setup = harness();
    const room = loadedRoom();
    setup.warmup.queueRoom(room);
    setup.warmup.finishRoom(room.room.id);
    expect(setup.warmup.hasPendingWork(room.room.id)).toBe(false);
    expect(firstPlanColdEdges(room.room)).toBe(0);
  });

  it('portal arrival: a prepared destination left cold by busy streaming finishes on arrival', () => {
    const setup = harness();
    const destination = { ...loadedRoom(), runtimeSuspended: false };
    setup.warmup.queueRoom(destination);
    for (let frame = 0; frame < 5; frame += 1) {
      setup.enqueueStreamingJob('predicted-visuals-objects', `prepare-${frame}`, 1.5);
      setup.runFrame('reduced');
    }
    expect(setup.counts.edges).toBe(0);
    setup.warmup.finishRoom(destination.room.id);
    expect(firstPlanColdEdges(destination.room)).toBe(0);
  });

  it('browse: rooms loaded while browsing warm in Browse frames, which run no streaming work', () => {
    const setup = harness();
    const room = loadedRoom();
    setup.warmup.queueRoom(room);
    setup.enqueueStreamingJob('predicted-visuals-objects', 'play-only-preparation', 0.5);
    let frames = 0;
    while (setup.warmup.hasPendingWork(room.room.id) && frames < 2_000) {
      setup.runFrame('reduced', { gameplayOnly: true });
      frames += 1;
    }
    expect(setup.coordinator.hasQueuedWorkAtPriority('predicted-visuals-objects')).toBe(true);
    expect(firstPlanColdEdges(room.room)).toBe(0);
  });

  it('walking in: a prepared neighbour warms while the player is next door', () => {
    const setup = harness();
    const current = loadedRoom();
    const neighbour = loadedRoom();
    setup.warmup.queueRoom(current);
    setup.warmup.finishRoom(current.room.id);
    setup.warmup.queueRoom(neighbour);
    let frames = 0;
    while (setup.warmup.hasPendingWork(neighbour.room.id) && frames < 2_000) {
      setup.warmup.noteActiveRoom(current, frames);
      setup.runFrame('reduced');
      frames += 1;
    }
    // About 600 units at 7 per 0.8 ms job, one job per phone frame: well under 2 s at 60 fps.
    expect(frames).toBeLessThan(120);
    expect(firstPlanColdEdges(neighbour.room)).toBe(0);
  });

  it('bounds the arrival finish on a slow device and lets the room catch up afterwards', () => {
    const setup = harness({ pieceMs: 2, edgeMs: () => 1 });
    const room = loadedRoom();
    setup.warmup.queueRoom(room);
    const arrivalMs = setup.elapsed(() => setup.warmup.finishRoom(room.room.id));
    expect(arrivalMs).toBeLessThanOrEqual(SWORDSMAN_EDGE_WARMUP_ARRIVAL_BUDGET_MS);
    expect(arrivalMs).toBeGreaterThan(SWORDSMAN_EDGE_WARMUP_ARRIVAL_BUDGET_MS - 3);
    expect(setup.warmup.hasPendingWork(room.room.id)).toBe(true);
  });
});

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
        if (streamingStillQueued) expect(setup.gameplayJobsIn(result)).toHaveLength(0);
      }
      return frames;
    };

    for (const profile of ['normal', 'reduced'] as const) {
      const withoutWarmup = harness();
      queueStreamingWork(withoutWarmup);
      const withWarmup = harness();
      withWarmup.warmup.queueRoom(loadedRoom());
      queueStreamingWork(withWarmup);
      expect(framesToDrain(withWarmup, profile)).toBe(framesToDrain(withoutWarmup, profile));
    }
  });

  it('ranks the played room ahead of previews, still behind teardown', () => {
    const order = (noted: boolean): FrameWorkPriority[] => {
      const setup = harness();
      const played = loadedRoom();
      setup.warmup.queueRoom(played);
      setup.enqueueStreamingJob('preview-cosmetic', 'preview', 0.5, 'gpu-upload');
      if (noted) setup.warmup.noteActiveRoom(played, 1);
      setup.enqueueStreamingJob('teardown', 'teardown', 0.5);
      const priorities: FrameWorkPriority[] = [];
      while (setup.coordinator.hasQueuedWorkAtPriority('preview-cosmetic')) {
        priorities.push(...setup.runFrame('normal').executed.map((execution) => execution.priority));
      }
      return priorities;
    };
    const played = order(true);
    expect(played[0]).toBe('teardown');
    expect(played.indexOf('gameplay-catch-up')).toBeLessThan(played.indexOf('preview-cosmetic'));
    expect(order(false).slice(0, 2)).toEqual(['teardown', 'preview-cosmetic']);
  });

  it.each([
    ['phone', 'reduced', 'reduced'],
    ['phone at a seam-critical transition', 'normal', 'reduced'],
    ['desktop', 'normal', 'normal'],
  ] as const)('keeps every %s frame inside the device CPU cap and every job to its budget', (_name, frameProfile, deviceProfile) => {
    // Edges usually cost 0.06 ms, with a 0.9 ms one every 40th.
    const setup = harness({ edgeMs: (index) => (index % 40 === 39 ? 0.9 : 0.06) });
    const room = loadedRoom();
    setup.warmup.queueRoom(room);
    const cpuCapMs = getFrameWorkBudget(deviceProfile).cpuSubCapMs;
    const jobDurations: number[] = [];
    let frames = 0;
    while (setup.warmup.hasPendingWork(room.room.id) && frames < 2_000) {
      const result = setup.runFrame(frameProfile, { gameplayCpuCapMs: cpuCapMs });
      frames += 1;
      const jobs = setup.gameplayJobsIn(result);
      expect(jobs.length).toBeLessThanOrEqual(cpuCapMs);
      jobDurations.push(...jobs.map((job) => job.actualDurationMs));
    }
    expect(setup.warmup.hasPendingWork(room.room.id)).toBe(false);
    // A job stops before a unit that would pass 0.8 ms at the slowest cost seen so far, so only a
    // unit slower than any before it can overrun; after the first slow edge none can.
    expect(Math.max(...jobDurations)).toBeLessThanOrEqual(SWORDSMAN_EDGE_WARMUP_CHUNK_MS + 0.9);
    const firstSlowJob = jobDurations.findIndex((duration) => duration > SWORDSMAN_EDGE_WARMUP_CHUNK_MS);
    expect(firstSlowJob).toBeGreaterThanOrEqual(0);
    expect(Math.max(...jobDurations.slice(firstSlowJob + 1))).toBeLessThanOrEqual(0.9 + 1e-9);
    expect(Math.max(...setup.unitsPerJob)).toBeLessThanOrEqual(SWORDSMAN_EDGE_WARMUP_MAX_UNITS_PER_JOB);
    expect(coldEdgesLeft(room.room, 16, 32)).toBe(0);
  });

  it('caps units per job when the clock is too coarse to measure them', () => {
    const setup = harness({ pieceMs: 0.3, edgeMs: () => 0.3, clockResolutionMs: 100 });
    const room = loadedRoom();
    setup.warmup.queueRoom(room);
    for (let frame = 0; frame < 200 && setup.warmup.hasPendingWork(room.room.id); frame += 1) {
      setup.runFrame('reduced');
    }
    expect(Math.max(...setup.unitsPerJob)).toBe(SWORDSMAN_EDGE_WARMUP_MAX_UNITS_PER_JOB);
    // Once one unit was seen to cross a 100 ms tick, every later job runs a single unit.
    const firstTick = setup.unitsPerJob.findIndex((units) => units < SWORDSMAN_EDGE_WARMUP_MAX_UNITS_PER_JOB);
    expect(firstTick).toBeGreaterThan(0);
    expect(setup.unitsPerJob.slice(firstTick + 1).every((units) => units === 1)).toBe(true);
  });

  it('splits the graph build, starting with surfaces, walls and ladders as separate pieces', () => {
    const room = buildRoom({ walls: [[20, 2, 8], [33, 9, 16]] });
    const build = startSwordsmanTraversalGraphBuild(room);
    let graph: SwordsmanTraversalGraph | null = null;
    let pieces = 0;
    while (!graph) {
      graph = build.buildNextPiece();
      pieces += 1;
    }
    const oneShot = buildSwordsmanTraversalGraph(room);
    expect(graph.wallSegments.length).toBeGreaterThan(0);
    expect(pieces).toBe(3 + graph.surfaceSegments.length + graph.wallSegments.length + 1);
    expect(graph).toEqual(oneShot);
    expect(Array.from(graph.edgesById.keys())).toEqual(Array.from(oneShot.edgesById.keys()));
  });

  it('skips the graph build when the room graph is cached, and stops it once a hunter builds one', () => {
    const cachedSetup = harness();
    const cached = loadedRoom();
    rememberSwordsmanTraversalGraph(buildSwordsmanTraversalGraph(cached.room));
    cachedSetup.warmup.queueRoom(cached);
    cachedSetup.warmup.finishRoom(cached.room.id);
    expect(cachedSetup.counts.pieces).toBe(0);
    expect(cachedSetup.counts.edges).toBeGreaterThan(500);

    const setup = harness();
    const room = loadedRoom();
    setup.warmup.queueRoom(room);
    setup.runFrame('reduced');
    const piecesBeforeHunter = setup.counts.pieces;
    expect(piecesBeforeHunter).toBeGreaterThan(0);
    const huntersGraph = getSwordsmanTraversalGraphForRoom(room.room);
    const prepareEdge = vi.spyOn(setup.warmup as unknown as { prepareEdge: (...args: unknown[]) => boolean }, 'prepareEdge');
    setup.runFrame('reduced');
    expect(setup.counts.pieces).toBe(piecesBeforeHunter);
    expect(prepareEdge.mock.calls[0]?.[1]).toBe(huntersGraph);
  });

  it('finishes a room with no jumps at all, and drops a room whose warm-up throws', () => {
    const setup = harness();
    const flat = loadedRoom(buildRoom({ ledges: false }), hunter(), hunter('collect', 22, 38));
    setup.warmup.queueRoom(flat);
    setup.warmup.finishRoom(flat.room.id);
    expect(setup.warmup.hasPendingWork(flat.room.id)).toBe(false);

    const failing = new SwordsmanEdgeWarmup({
      prepareEdge: () => {
        throw new Error('simulation failed');
      },
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const room = loadedRoom();
    failing.queueRoom(room);
    failing.finishRoom(room.room.id);
    expect(failing.hasPendingWork(room.room.id)).toBe(false);
    expect(error).toHaveBeenCalledOnce();
  });

  it('notes a played room in place every frame and simulates nothing itself', () => {
    const setup = harness();
    const played = loadedRoom();
    setup.warmup.queueRoom(played);
    const notes = (setup.warmup as unknown as { notesByRoom: WeakMap<RoomSnapshot, object> }).notesByRoom;
    setup.warmup.noteActiveRoom(played, 1);
    const note = notes.get(played.room);
    for (let frame = 2; frame < 50; frame += 1) {
      setup.warmup.noteActiveRoom(played, frame);
      setup.warmup.noteActiveRoom(played, frame);
    }
    expect(notes.get(played.room)).toBe(note);
    expect(setup.counts).toEqual({ pieces: 0, edges: 0 });
    expect(setup.coordinator.getDiagnostics().queueDepthByPriority['gameplay-catch-up']).toBe(1);
  });

  it('never warms a suspended room, and resumes once it is played again', () => {
    const setup = harness();
    const left = loadedRoom();
    left.runtimeSuspended = true;
    setup.warmup.queueRoom(left);
    expect(setup.coordinator.getDiagnostics().queueDepth).toBe(0);

    const playing = loadedRoom();
    setup.warmup.queueRoom(playing);
    while (setup.coordinator.getDiagnostics().queueDepth > 0) setup.runFrame();
    expect(setup.warmup.hasPendingWork(playing.room.id)).toBe(false);
    expect(setup.warmup.hasPendingWork(left.room.id)).toBe(true);
    const edgesSoFar = setup.counts.edges;

    left.runtimeSuspended = false;
    setup.warmup.noteActiveRoom(left, 7);
    while (setup.coordinator.getDiagnostics().queueDepth > 0) setup.runFrame();
    expect(setup.warmup.hasPendingWork(left.room.id)).toBe(false);
    expect(setup.counts.edges).toBeGreaterThan(edgesSoFar);
  });

  it('releases its rooms when a stream reset cancels the queued job', () => {
    const setup = harness();
    const first = loadedRoom();
    setup.warmup.queueRoom(first);
    setup.runFrame();
    expect(setup.coordinator.cancelAll('stream-reset')).toBe(1);
    expect(setup.warmup.hasPendingWork(first.room.id)).toBe(false);

    setup.warmup.queueRoom(loadedRoom());
    expect(setup.coordinator.getDiagnostics().queueDepth).toBe(1);
  });

  it('drops a room whose hunters were destroyed', () => {
    const setup = harness();
    const racer = hunter();
    const room = loadedRoom(buildRoom(), racer);
    setup.warmup.queueRoom(room);
    racer.sprite.scene = undefined;
    setup.runFrame();
    expect(setup.warmup.hasPendingWork(room.room.id)).toBe(false);
    expect(setup.coordinator.getDiagnostics().queueDepth).toBe(0);
  });

  it('warms each collecting body size and ignores rooms with no coin-collecting hunter', () => {
    const setup = harness();
    setup.warmup.queueRoom(loadedRoom(buildRoom(), hunter('duel'), hunter(null)));
    expect(setup.coordinator.getDiagnostics().queueDepth).toBe(0);

    const room = loadedRoom(buildRoom(), hunter('collect'), hunter('collect', 22, 38), hunter('collect'));
    setup.warmup.queueRoom(room);
    while (setup.coordinator.getDiagnostics().queueDepth > 0) setup.runFrame();
    expect(coldEdgesLeft(room.room, 16, 32)).toBe(0);
    expect(coldEdgesLeft(room.room, 22, 38)).toBe(0);
    expect(coldEdgesLeft(room.room, 20, 32)).toBeGreaterThan(0);
  });
});
