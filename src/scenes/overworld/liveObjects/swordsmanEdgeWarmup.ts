import type { RoomSnapshot } from '../../../persistence/roomModel';
import type { SwordsmanTraversalEdge, SwordsmanTraversalGraph } from '../../../enemies/swordsmanTraversal';
import { prepareSwordsmanTraversalEdgeSimulation } from '../../../enemies/swordsmanRobustPlanner';

/** Time each background chunk may spend, inside the frame-work coordinator's 1 ms CPU job. */
export const SWORDSMAN_EDGE_WARMUP_BACKGROUND_CHUNK_MS = 0.8;
/** Time per frame once a hunter in the room is awake and racing, so the rest finishes quickly. */
export const SWORDSMAN_EDGE_WARMUP_ACTIVE_CHUNK_MS = 4;

interface WarmupHunter {
  runtime: { aiObjectiveMode: string | null };
  sprite: { active: boolean; scene?: unknown; body: unknown };
}

interface WarmupRoom {
  room: RoomSnapshot;
  liveObjects: readonly WarmupHunter[];
}

interface WarmupTask {
  room: RoomSnapshot;
  hunters: WarmupHunter[];
  bodySizes: Array<[width: number, height: number]>;
  graph: SwordsmanTraversalGraph | null;
  edges: SwordsmanTraversalEdge[];
  nextEdgeIndex: number;
  nextBodyIndex: number;
  lastActiveRunAt: number;
}

export interface SwordsmanEdgeWarmupOptions {
  getGraph: (room: RoomSnapshot) => SwordsmanTraversalGraph;
  /** Queues one atomic background CPU job; absent in tests and editor previews. */
  enqueueBackgroundCpuWork?: (label: string, execute: () => void) => { readonly state: string } | null;
  now?: () => number;
}

/**
 * Simulates every jump of a room for each coin-collecting Sword Hunter's body size while the room
 * is prepared, so its first route plans read cached physics instead of freezing a frame (F302).
 * Plans never wait for it: an edge the warm-up has not reached yet is simulated when a plan needs it.
 */
export class SwordsmanEdgeWarmup {
  private readonly tasksByRoomId = new Map<string, WarmupTask>();
  private backgroundJob: { readonly state: string } | null = null;
  private readonly now: () => number;

  constructor(private readonly options: SwordsmanEdgeWarmupOptions) {
    this.now = options.now ?? (() => performance.now());
  }

  queueRoom(loadedRoom: WarmupRoom): void {
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
      room: loadedRoom.room,
      hunters,
      bodySizes: Array.from(bodySizes.values()),
      graph: null,
      edges: [],
      nextEdgeIndex: 0,
      nextBodyIndex: 0,
      lastActiveRunAt: Number.NaN,
    });
    this.scheduleBackgroundChunk();
  }

  /** Called as a room's Sword Hunters update; runs one larger chunk per frame while any is awake. */
  runForActiveRoom(loadedRoom: WarmupRoom, frameTime: number): void {
    const task = this.tasksByRoomId.get(loadedRoom.room.id);
    if (!task || task.room !== loadedRoom.room || task.lastActiveRunAt === frameTime) {
      return;
    }
    task.lastActiveRunAt = frameTime;
    if (task.hunters.some(isAwake)) {
      this.advance(task, SWORDSMAN_EDGE_WARMUP_ACTIVE_CHUNK_MS);
    }
    // Background jobs are cancelled with the streaming queue on some resets; pick them back up.
    this.scheduleBackgroundChunk();
  }

  hasPendingWork(roomId: string): boolean {
    return this.tasksByRoomId.has(roomId);
  }

  private scheduleBackgroundChunk(): void {
    const state = this.backgroundJob?.state;
    if (state === 'queued' || state === 'running' || this.tasksByRoomId.size === 0) {
      return;
    }

    this.backgroundJob = this.options.enqueueBackgroundCpuWork?.('swordsman-edge-warmup', () => {
      this.backgroundJob = null;
      const task = this.tasksByRoomId.values().next().value;
      if (task) {
        this.advance(task, SWORDSMAN_EDGE_WARMUP_BACKGROUND_CHUNK_MS);
      }
      this.scheduleBackgroundChunk();
    }) ?? null;
  }

  private advance(task: WarmupTask, budgetMs: number): void {
    if (!task.hunters.some((hunter) => hunter.sprite.scene)) {
      // Destroyed with their room (dormant ones are only inactive); nothing will plan here.
      this.finish(task);
      return;
    }

    if (!task.graph) {
      // Building the graph is a chunk of its own (about 1.5 ms in a dense room); planning reuses it.
      task.graph = this.options.getGraph(task.room);
      task.edges = Array.from(task.graph.edgesById.values());
      return;
    }
    const deadline = this.now() + budgetMs;
    while (this.now() < deadline) {
      if (task.nextEdgeIndex >= task.edges.length) {
        task.nextEdgeIndex = 0;
        task.nextBodyIndex += 1;
      }
      const bodySize = task.bodySizes[task.nextBodyIndex];
      if (!bodySize) {
        this.finish(task);
        return;
      }
      prepareSwordsmanTraversalEdgeSimulation(
        task.room,
        task.graph,
        task.edges[task.nextEdgeIndex],
        bodySize[0],
        bodySize[1],
      );
      task.nextEdgeIndex += 1;
    }
  }

  private finish(task: WarmupTask): void {
    if (this.tasksByRoomId.get(task.room.id) === task) {
      this.tasksByRoomId.delete(task.room.id);
    }
  }
}

function getBodySize(liveObject: WarmupHunter): [number, number] | null {
  const body = liveObject.sprite.body as { width?: unknown; height?: unknown } | null;
  return body && typeof body.width === 'number' && typeof body.height === 'number'
    ? [body.width, body.height]
    : null;
}

function isAwake(liveObject: WarmupHunter): boolean {
  const body = liveObject.sprite.body as { enable?: unknown } | null;
  return liveObject.sprite.active && body?.enable !== false;
}
