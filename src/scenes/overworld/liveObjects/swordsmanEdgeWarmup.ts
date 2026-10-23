import type { RoomSnapshot } from '../../../persistence/roomModel';
import {
  getSwordsmanTraversalGraphCacheKey,
  markSwordsmanTraversalRoomInPlay,
  peekSwordsmanTraversalGraphForRoom,
  rememberSwordsmanTraversalGraph,
  startSwordsmanTraversalGraphBuild,
  type SwordsmanTraversalEdge,
  type SwordsmanTraversalGraph,
  type SwordsmanTraversalGraphBuild,
} from '../../../enemies/swordsmanTraversal';
import { prepareSwordsmanTraversalEdgeSimulation } from '../../../enemies/swordsmanRobustPlanner';

/** Time one background job may spend, inside the frame-work coordinator's 1 ms CPU estimate. */
export const SWORDSMAN_EDGE_WARMUP_CHUNK_MS = 0.8;
/**
 * Graph pieces or uncached edges per background job. It bounds a job where the clock is too coarse
 * to (Safari and Firefox round performance.now() to about 1 ms; resistFingerprinting to 100 ms).
 */
export const SWORDSMAN_EDGE_WARMUP_MAX_UNITS_PER_JOB = 8;
const PRIORITIZED_ROOM_LIMIT = 16;

type WarmupPriority = 'gameplay-catch-up' | 'gameplay-warmup';

interface WarmupJob {
  readonly state: string;
  reprioritize(priority: WarmupPriority): boolean;
}

export interface WarmupHunter {
  runtime: { aiObjectiveMode: string | null };
  sprite: { scene?: unknown; body: unknown };
}

export interface WarmupRoom {
  room: RoomSnapshot;
  liveObjects: readonly WarmupHunter[];
  runtimeSuspended?: boolean;
}

interface WarmupTask {
  loadedRoom: WarmupRoom;
  hunters: WarmupHunter[];
  bodySizes: Array<[width: number, height: number]>;
  graphBuild: SwordsmanTraversalGraphBuild | null;
  graph: SwordsmanTraversalGraph | null;
  edges: SwordsmanTraversalEdge[];
  nextEdgeIndex: number;
  nextBodyIndex: number;
  /** Hunters there are awake, or the player is about to arrive: run ahead of cosmetic previews. */
  catchUp: boolean;
  wantedAt: number;
}

interface RoomNote {
  frameTime: number;
  graphCacheKey: string;
}

export interface SwordsmanEdgeWarmupOptions {
  /**
   * Queues one atomic background CPU job in a gameplay queue; absent in tests and editor previews,
   * and null once streaming is destroyed. `onCancelled` runs if a stream reset drops the job.
   */
  enqueueBackgroundCpuWork?: (
    label: string,
    execute: () => void,
    onCancelled: () => void,
    priority: WarmupPriority,
  ) => WarmupJob | null;
  now?: () => number;
  /** The units of work, replaceable so tests can charge each one a cost on a fake clock. */
  startGraphBuild?: (room: RoomSnapshot) => SwordsmanTraversalGraphBuild;
  prepareEdge?: typeof prepareSwordsmanTraversalEdgeSimulation;
}

/**
 * Simulates every jump of a room for each coin-collecting Sword Hunter's body size before the
 * hunters plan, so the plans read cached physics instead of freezing a frame (F302). Plans never
 * wait for it and choose exactly the same routes; only when the physics runs changes.
 * - A room's warm-up is queued when its live objects are created, and runs as frame work below all
 *   streaming queues, within the device profile's CPU cap.
 * - While a room's Sword Hunters are awake, or once its preparation as a portal destination or the
 *   next room is requested, its unfinished warm-up moves ahead of cosmetic previews (still behind
 *   preparation and teardown).
 * - A run start or respawn finishes the arrival room on the spot within 250 ms, a portal arrival
 *   into another room within 50 ms; whatever is left continues as catch-up.
 */
export class SwordsmanEdgeWarmup {
  private readonly tasksByRoomId = new Map<string, WarmupTask>();
  private readonly notesByRoom = new WeakMap<RoomSnapshot, RoomNote>();
  private readonly prioritizedRoomIds = new Set<string>();
  private backgroundJob: WarmupJob | null = null;
  private readonly now: () => number;
  private readonly startGraphBuild: (room: RoomSnapshot) => SwordsmanTraversalGraphBuild;
  private readonly prepareEdge: typeof prepareSwordsmanTraversalEdgeSimulation;

  constructor(private readonly options: SwordsmanEdgeWarmupOptions = {}) {
    this.now = options.now ?? (() => performance.now());
    this.startGraphBuild = options.startGraphBuild ?? startSwordsmanTraversalGraphBuild;
    this.prepareEdge = options.prepareEdge ?? prepareSwordsmanTraversalEdgeSimulation;
  }

  queueRoom(loadedRoom: WarmupRoom): void {
    this.dropDestroyedTasks();
    const hunters = loadedRoom.liveObjects.filter((liveObject) => (
      liveObject.runtime.aiObjectiveMode === 'collect' && getBodySize(liveObject) !== null
    ));
    if (hunters.length === 0) {
      this.tasksByRoomId.delete(loadedRoom.room.id);
      return;
    }

    const bodySizes = new Map<string, [number, number]>();
    for (const hunter of hunters) {
      const size = getBodySize(hunter)!;
      bodySizes.set(`${Math.round(size[0])}:${Math.round(size[1])}`, size);
    }
    const prioritized = this.prioritizedRoomIds.delete(loadedRoom.room.id);
    this.tasksByRoomId.set(loadedRoom.room.id, {
      loadedRoom,
      hunters,
      bodySizes: Array.from(bodySizes.values()),
      graphBuild: null,
      graph: null,
      edges: [],
      nextEdgeIndex: 0,
      nextBodyIndex: 0,
      catchUp: prioritized,
      wantedAt: Number.NEGATIVE_INFINITY,
    });
    this.scheduleBackgroundChunk();
  }

  /**
   * Called as a room's Sword Hunters update, every frame. Simulates nothing itself: it keeps the
   * room's caches from eviction and ranks its unfinished warm-up as catch-up work.
   */
  noteActiveRoom(loadedRoom: WarmupRoom, frameTime: number): void {
    let note = this.notesByRoom.get(loadedRoom.room);
    if (note?.frameTime === frameTime) {
      return;
    }
    if (!note) {
      note = { frameTime, graphCacheKey: getSwordsmanTraversalGraphCacheKey(loadedRoom.room) };
      this.notesByRoom.set(loadedRoom.room, note);
    }
    note.frameTime = frameTime;
    markSwordsmanTraversalRoomInPlay(note.graphCacheKey);

    const task = this.tasksByRoomId.get(loadedRoom.room.id);
    if (task?.loadedRoom === loadedRoom) {
      task.wantedAt = frameTime;
      this.catchUp(task);
    }
  }

  /**
   * The player may soon arrive in this room (a portal destination or the next room is being
   * prepared): rank its warm-up as catch-up, now or as soon as its objects are created.
   */
  prioritizeRoom(roomId: string): void {
    const task = this.tasksByRoomId.get(roomId);
    if (task) {
      this.catchUp(task);
      return;
    }
    if (this.prioritizedRoomIds.size >= PRIORITIZED_ROOM_LIMIT) {
      this.prioritizedRoomIds.clear();
    }
    this.prioritizedRoomIds.add(roomId);
  }

  /**
   * The player is arriving in this room now (run start, respawn, portal): finish its warm-up
   * within `budgetMs` so its hunters' first plans find every edge simulated. Whatever does not
   * fit continues as catch-up.
   */
  finishRoom(roomId: string, budgetMs: number): void {
    const task = this.tasksByRoomId.get(roomId);
    if (task) {
      this.runUnits(task, budgetMs, Number.POSITIVE_INFINITY);
      this.catchUp(task);
    }
  }

  hasPendingWork(roomId: string): boolean {
    return this.tasksByRoomId.has(roomId);
  }

  private catchUp(task: WarmupTask): void {
    if (this.tasksByRoomId.get(task.loadedRoom.room.id) !== task) {
      return;
    }
    task.catchUp = true;
    if (this.backgroundJob?.state === 'queued') {
      this.backgroundJob.reprioritize('gameplay-catch-up');
    } else {
      // Nothing queued: the last job ran out of work it could do (its rooms were suspended), or
      // enqueue returned null.
      this.scheduleBackgroundChunk();
    }
  }

  private scheduleBackgroundChunk(): void {
    const state = this.backgroundJob?.state;
    const task = state === 'queued' || state === 'running' ? null : this.nextTask();
    if (!task) {
      return;
    }

    this.backgroundJob = this.options.enqueueBackgroundCpuWork?.(
      'swordsman-edge-warmup',
      () => {
        this.backgroundJob = null;
        const next = this.nextTask();
        try {
          if (next) {
            this.runUnits(next, SWORDSMAN_EDGE_WARMUP_CHUNK_MS, SWORDSMAN_EDGE_WARMUP_MAX_UNITS_PER_JOB);
          }
        } finally {
          this.scheduleBackgroundChunk();
        }
      },
      () => {
        // A stream reset: its rooms are being reloaded, and loading them queues their warm-up again.
        this.backgroundJob = null;
        this.tasksByRoomId.clear();
      },
      task.catchUp ? 'gameplay-catch-up' : 'gameplay-warmup',
    ) ?? null;
  }

  /** Catch-up rooms first, the most recently played of them first, else the oldest; never a suspended room. */
  private nextTask(): WarmupTask | null {
    this.dropDestroyedTasks();
    let next: WarmupTask | null = null;
    for (const task of this.tasksByRoomId.values()) {
      if (task.loadedRoom.runtimeSuspended === true) {
        continue;
      }
      if (
        !next
        || (task.catchUp && !next.catchUp)
        || (task.catchUp === next.catchUp && task.wantedAt > next.wantedAt)
      ) {
        next = task;
      }
    }
    return next;
  }

  /**
   * Runs graph pieces, then edges, until the task is done, `maxUnits` uncached units have run, or
   * the next unit would pass `budgetMs` if it took as long as this job's slowest so far. That
   * figure starts afresh each job, so one hitch, or a unit that happened to span a tick of a
   * coarse clock, slows only its own job. A task that throws is dropped: its hunters then simulate
   * what they need as they plan, as on main.
   */
  private runUnits(task: WarmupTask, budgetMs: number, maxUnits: number): void {
    const startedAt = this.now();
    let unitStartedAt = startedAt;
    let slowestUnitMs = 0;
    let coldUnits = 0;
    try {
      while (coldUnits < maxUnits) {
        const unit = this.runUnit(task);
        if (unit === 'done') {
          this.finish(task);
          return;
        }
        const unitEndedAt = this.now();
        if (unit === 'worked') {
          coldUnits += 1;
          slowestUnitMs = Math.max(slowestUnitMs, unitEndedAt - unitStartedAt);
        }
        if (unitEndedAt - startedAt + slowestUnitMs > budgetMs) {
          return;
        }
        unitStartedAt = unitEndedAt;
      }
    } catch (error) {
      this.finish(task);
      console.error('Sword Hunter jump warm-up failed; its hunters will simulate jumps as they plan.', error);
    }
  }

  /** One graph piece or one edge: whether it did real work, was already cached, or finished the task. */
  private runUnit(task: WarmupTask): 'worked' | 'cached' | 'done' {
    const room = task.loadedRoom.room;
    if (!task.graph) {
      // A hunter that planned first built the graph itself; stop building our copy.
      const cached = peekSwordsmanTraversalGraphForRoom(room);
      let worked = false;
      if (cached) {
        task.graph = cached;
      } else {
        if (!task.graphBuild) {
          task.graphBuild = this.startGraphBuild(room);
        }
        const built = task.graphBuild.buildNextPiece();
        if (!built) {
          return 'worked';
        }
        task.graph = rememberSwordsmanTraversalGraph(built);
        worked = true;
      }
      task.graphBuild = null;
      task.edges = Array.from(task.graph.edgesById.values());
      if (task.edges.length === 0) {
        return 'done';
      }
      return worked ? 'worked' : 'cached';
    }

    const bodySize = task.bodySizes[task.nextBodyIndex];
    if (!bodySize) {
      return 'done';
    }
    const simulated = this.prepareEdge(room, task.graph, task.edges[task.nextEdgeIndex], bodySize[0], bodySize[1]);
    task.nextEdgeIndex += 1;
    if (task.nextEdgeIndex >= task.edges.length) {
      task.nextEdgeIndex = 0;
      task.nextBodyIndex += 1;
    }
    if (task.nextBodyIndex >= task.bodySizes.length) {
      return 'done';
    }
    return simulated ? 'worked' : 'cached';
  }

  private finish(task: WarmupTask): void {
    if (this.tasksByRoomId.get(task.loadedRoom.room.id) === task) {
      this.tasksByRoomId.delete(task.loadedRoom.room.id);
    }
  }

  private dropDestroyedTasks(): void {
    for (const [roomId, task] of this.tasksByRoomId) {
      // Destroyed with their room; dormant and suspended ones keep their scene.
      if (!task.hunters.some((hunter) => hunter.sprite.scene)) {
        this.tasksByRoomId.delete(roomId);
      }
    }
  }
}

function getBodySize(liveObject: WarmupHunter): [number, number] | null {
  const body = liveObject.sprite.body as { width?: unknown; height?: unknown } | null;
  return body && typeof body.width === 'number' && typeof body.height === 'number'
    ? [body.width, body.height]
    : null;
}
