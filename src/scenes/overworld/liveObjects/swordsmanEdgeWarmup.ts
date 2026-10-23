import type { RoomSnapshot } from '../../../persistence/roomModel';
import {
  getSwordsmanTraversalGraphCacheKey,
  startSwordsmanTraversalGraphBuild,
  type SwordsmanTraversalEdge,
  type SwordsmanTraversalGraph,
  type SwordsmanTraversalGraphBuild,
} from '../../../enemies/swordsmanTraversal';
import {
  markSwordsmanTraversalRoomInPlay,
  prepareSwordsmanTraversalEdgeSimulation,
} from '../../../enemies/swordsmanRobustPlanner';

/**
 * Time one job may spend, checked before each graph piece or edge, inside the frame-work
 * coordinator's 1 ms CPU job estimate; it overruns by at most that one piece or edge.
 */
export const SWORDSMAN_EDGE_WARMUP_CHUNK_MS = 0.8;

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
  graphBuild: SwordsmanTraversalGraphBuild | null;
  graph: SwordsmanTraversalGraph | null;
  edges: SwordsmanTraversalEdge[];
  nextEdgeIndex: number;
  nextBodyIndex: number;
  wantedAt: number;
}

export interface SwordsmanEdgeWarmupOptions {
  /** The scene's cached graph for the room; a graph built here is handed over to be kept. */
  getGraph: (room: RoomSnapshot, prebuilt?: SwordsmanTraversalGraph) => SwordsmanTraversalGraph;
  /**
   * Queues one atomic background CPU job below all streaming work; absent in tests and editor
   * previews. `onCancelled` runs if a stream reset drops it before it runs.
   */
  enqueueBackgroundCpuWork?: (
    label: string,
    execute: () => void,
    onCancelled: () => void,
  ) => { readonly state: string } | null;
  now?: () => number;
}

/**
 * Simulates every jump of a room for each coin-collecting Sword Hunter's body size while the room
 * is prepared, so its first route plans read cached physics instead of freezing a frame (F302).
 * All of it runs as lowest-priority frame work, after preparation, teardown and previews, within
 * the coordinator's per-frame CPU cap (1 ms on reduced-profile phones, 2 ms otherwise). Plans
 * never wait for it: an edge the warm-up has not reached yet is simulated when a plan needs it.
 */
export class SwordsmanEdgeWarmup {
  private readonly tasksByRoomId = new Map<string, WarmupTask>();
  private readonly notedRooms = new WeakMap<RoomSnapshot, { frameTime: number; graphCacheKey: string }>();
  private backgroundJob: { readonly state: string } | null = null;
  private readonly now: () => number;

  constructor(private readonly options: SwordsmanEdgeWarmupOptions) {
    this.now = options.now ?? (() => performance.now());
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
    });
    this.scheduleBackgroundChunk();
  }

  /**
   * Called as a room's Sword Hunters update. Simulates nothing itself: it keeps the room's
   * simulated edges from eviction and moves its warm-up to the front of the background queue.
   */
  noteActiveRoom(loadedRoom: WarmupRoom, frameTime: number): void {
    const noted = this.notedRooms.get(loadedRoom.room);
    if (noted?.frameTime === frameTime) {
      return;
    }
    const graphCacheKey = noted?.graphCacheKey ?? getSwordsmanTraversalGraphCacheKey(loadedRoom.room);
    this.notedRooms.set(loadedRoom.room, { frameTime, graphCacheKey });
    markSwordsmanTraversalRoomInPlay(graphCacheKey);

    const task = this.tasksByRoomId.get(loadedRoom.room.id);
    if (task?.loadedRoom === loadedRoom) {
      task.wantedAt = frameTime;
      // A stream reset may have dropped the queued job; pick the work back up.
      this.scheduleBackgroundChunk();
    }
  }

  hasPendingWork(roomId: string): boolean {
    return this.tasksByRoomId.has(roomId);
  }

  private scheduleBackgroundChunk(): void {
    const state = this.backgroundJob?.state;
    if (state === 'queued' || state === 'running' || !this.nextTask()) {
      return;
    }

    this.backgroundJob = this.options.enqueueBackgroundCpuWork?.(
      'swordsman-edge-warmup',
      () => {
        this.backgroundJob = null;
        const task = this.nextTask();
        if (task) {
          this.advance(task);
        }
        this.scheduleBackgroundChunk();
      },
      () => {
        // A stream reset: its rooms are being reloaded, and finishing them re-queues their warm-up.
        this.backgroundJob = null;
        this.tasksByRoomId.clear();
      },
    ) ?? null;
  }

  /** The most recently played room first, else the oldest; never a suspended room. */
  private nextTask(): WarmupTask | null {
    this.dropDestroyedTasks();
    let next: WarmupTask | null = null;
    for (const task of this.tasksByRoomId.values()) {
      if (task.loadedRoom.runtimeSuspended === true) {
        continue;
      }
      if (!next || task.wantedAt > next.wantedAt) {
        next = task;
      }
    }
    return next;
  }

  private advance(task: WarmupTask): void {
    const deadline = this.now() + SWORDSMAN_EDGE_WARMUP_CHUNK_MS;
    const outOfTime = (): boolean => this.now() >= deadline;
    const room = task.loadedRoom.room;
    if (!task.graph) {
      if (!task.graphBuild) {
        task.graphBuild = startSwordsmanTraversalGraphBuild(room);
      }
      const built = task.graphBuild.step(outOfTime);
      if (!built) {
        return;
      }
      task.graph = this.options.getGraph(room, built);
      task.graphBuild = null;
      task.edges = Array.from(task.graph.edgesById.values());
    }

    while (!outOfTime()) {
      if (task.nextEdgeIndex >= task.edges.length) {
        task.nextEdgeIndex = 0;
        task.nextBodyIndex += 1;
      }
      const bodySize = task.bodySizes[task.nextBodyIndex];
      if (!bodySize) {
        this.tasksByRoomId.delete(room.id);
        return;
      }
      prepareSwordsmanTraversalEdgeSimulation(
        room,
        task.graph,
        task.edges[task.nextEdgeIndex],
        bodySize[0],
        bodySize[1],
      );
      task.nextEdgeIndex += 1;
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
