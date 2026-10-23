import type { RoomSnapshot } from '../../../persistence/roomModel';
import {
  getSwordsmanTraversalGraphCacheKey,
  peekSwordsmanTraversalGraphForRoom,
  rememberSwordsmanTraversalGraph,
  startSwordsmanTraversalGraphBuild,
  type SwordsmanTraversalEdge,
  type SwordsmanTraversalGraph,
  type SwordsmanTraversalGraphBuild,
} from '../../../enemies/swordsmanTraversal';
import {
  markSwordsmanTraversalRoomInPlay,
  prepareSwordsmanTraversalEdgeSimulation,
} from '../../../enemies/swordsmanRobustPlanner';

/** Time one background job may spend, inside the frame-work coordinator's 1 ms CPU estimate. */
export const SWORDSMAN_EDGE_WARMUP_CHUNK_MS = 0.8;
/** Graph pieces or edges per background job, which also bounds a job on a coarse clock. */
export const SWORDSMAN_EDGE_WARMUP_MAX_UNITS_PER_JOB = 8;
/**
 * Time a run start or portal arrival may spend finishing the arrival room's warm-up before its
 * hunters first plan. A dense 40-ledge room needs about 35-45 ms on a fast desktop.
 */
export const SWORDSMAN_EDGE_WARMUP_ARRIVAL_BUDGET_MS = 250;

type WarmupPriority = 'gameplay-catch-up' | 'gameplay-warmup';

interface WarmupJob {
  readonly state: string;
  reprioritize(priority: WarmupPriority): boolean;
}

interface WarmupHunter {
  runtime: { aiObjectiveMode: string | null };
  sprite: { scene?: unknown; body: unknown };
}

interface WarmupRoom {
  room: RoomSnapshot;
  liveObjects: readonly WarmupHunter[];
  runtimeSuspended?: boolean;
}

interface WarmupTask {
  loadedRoom: WarmupRoom;
  hunters: WarmupHunter[];
  bodySizes: Array<[width: number, height: number]>;
  graphBuild: { buildNextPiece(): SwordsmanTraversalGraph | null } | null;
  graph: SwordsmanTraversalGraph | null;
  edges: SwordsmanTraversalEdge[];
  nextEdgeIndex: number;
  nextBodyIndex: number;
  wantedAt: number;
  /** The slowest graph piece or edge so far; a job stops before one more would pass its budget. */
  largestUnitMs: number;
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
 *   streaming queues, in Play and Browse frames, within the device profile's CPU cap.
 * - While Sword Hunters in a room are awake, its unfinished warm-up moves ahead of cosmetic
 *   previews (still behind preparation and teardown).
 * - A run start or portal arrival finishes the arrival room's warm-up on the spot.
 */
export class SwordsmanEdgeWarmup {
  private readonly tasksByRoomId = new Map<string, WarmupTask>();
  private readonly notesByRoom = new WeakMap<RoomSnapshot, RoomNote>();
  private backgroundJob: WarmupJob | null = null;
  private latestNotedFrameTime = Number.NaN;
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
    this.tasksByRoomId.set(loadedRoom.room.id, {
      loadedRoom,
      hunters,
      bodySizes: Array.from(bodySizes.values()),
      graphBuild: null,
      graph: null,
      edges: [],
      nextEdgeIndex: 0,
      nextBodyIndex: 0,
      wantedAt: Number.NEGATIVE_INFINITY,
      largestUnitMs: 0,
    });
    this.scheduleBackgroundChunk();
  }

  /**
   * Called as a room's Sword Hunters update, every frame. Simulates nothing itself: it keeps the
   * room's simulated edges from eviction and ranks its unfinished warm-up as catch-up work.
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
    this.latestNotedFrameTime = frameTime;
    markSwordsmanTraversalRoomInPlay(note.graphCacheKey);

    const task = this.tasksByRoomId.get(loadedRoom.room.id);
    if (task?.loadedRoom !== loadedRoom) {
      return;
    }
    task.wantedAt = frameTime;
    if (this.backgroundJob?.state === 'queued') {
      this.backgroundJob.reprioritize('gameplay-catch-up');
    } else {
      // Nothing queued: the last job finished with this room suspended, or enqueue returned null.
      this.scheduleBackgroundChunk();
    }
  }

  /**
   * A run start or portal arrival into this room: finish its warm-up now, within the arrival
   * budget, so its hunters' first plans find every edge simulated.
   */
  finishRoom(roomId: string): void {
    const task = this.tasksByRoomId.get(roomId);
    if (task) {
      this.runUnits(task, SWORDSMAN_EDGE_WARMUP_ARRIVAL_BUDGET_MS, Number.POSITIVE_INFINITY);
    }
  }

  hasPendingWork(roomId: string): boolean {
    return this.tasksByRoomId.has(roomId);
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
      task.wantedAt === this.latestNotedFrameTime ? 'gameplay-catch-up' : 'gameplay-warmup',
    ) ?? null;
  }

  /** The room most recently played first, else the oldest; never a suspended room. */
  private nextTask(): WarmupTask | null {
    this.dropDestroyedTasks();
    let next: WarmupTask | null = null;
    for (const task of this.tasksByRoomId.values()) {
      if (task.loadedRoom.runtimeSuspended !== true && (!next || task.wantedAt > next.wantedAt)) {
        next = task;
      }
    }
    return next;
  }

  /**
   * Runs graph pieces, then edges, until the task is done, `maxUnits` have run, or the next unit
   * would pass `budgetMs` if it took as long as the slowest one so far. A task that throws is
   * dropped: its hunters then simulate what they need as they plan, as on main.
   */
  private runUnits(task: WarmupTask, budgetMs: number, maxUnits: number): void {
    const startedAt = this.now();
    let unitStartedAt = startedAt;
    try {
      for (let units = 0; units < maxUnits; units += 1) {
        const finished = this.runUnit(task);
        const unitEndedAt = this.now();
        task.largestUnitMs = Math.max(task.largestUnitMs, unitEndedAt - unitStartedAt);
        if (finished) {
          this.finish(task);
          return;
        }
        if (unitEndedAt - startedAt + task.largestUnitMs > budgetMs) {
          return;
        }
        unitStartedAt = unitEndedAt;
      }
    } catch (error) {
      this.finish(task);
      console.error('Sword Hunter jump warm-up failed; its hunters will simulate jumps as they plan.', error);
    }
  }

  /** One graph piece or one edge; true once the task has nothing left. */
  private runUnit(task: WarmupTask): boolean {
    const room = task.loadedRoom.room;
    if (!task.graph) {
      // A hunter that planned first built the graph itself; stop building our copy.
      const cached = peekSwordsmanTraversalGraphForRoom(room);
      if (cached) {
        task.graph = cached;
      } else {
        if (!task.graphBuild) {
          task.graphBuild = this.startGraphBuild(room);
        }
        const built = task.graphBuild.buildNextPiece();
        if (!built) {
          return false;
        }
        task.graph = rememberSwordsmanTraversalGraph(built);
      }
      task.graphBuild = null;
      task.edges = Array.from(task.graph.edgesById.values());
      return task.edges.length === 0;
    }

    const bodySize = task.bodySizes[task.nextBodyIndex];
    if (!bodySize) {
      return true;
    }
    this.prepareEdge(room, task.graph, task.edges[task.nextEdgeIndex], bodySize[0], bodySize[1]);
    task.nextEdgeIndex += 1;
    if (task.nextEdgeIndex >= task.edges.length) {
      task.nextEdgeIndex = 0;
      task.nextBodyIndex += 1;
    }
    return task.nextBodyIndex >= task.bodySizes.length;
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
