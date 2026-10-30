import type {
  SwordsmanEdgeWarmup,
  SwordsmanEdgeWarmupOptions,
  WarmupRoom,
} from './swordsmanEdgeWarmup';

export type { SwordsmanEdgeWarmupOptions } from './swordsmanEdgeWarmup';

/** How long a run start or respawn may spend finishing the arrival room's warm-up. */
export const SWORDSMAN_EDGE_WARMUP_SPAWN_BUDGET_MS = 250;
/** How long a portal arrival into another room may spend; the rest continues as catch-up. */
export const SWORDSMAN_EDGE_WARMUP_PORTAL_BUDGET_MS = 50;

/**
 * Loads the Sword Hunter jump warm-up (F302) outside the boot bundle. The import starts with the
 * overworld's live objects; until it lands there is simply no warm-up yet, so hunters simulate
 * jumps as they plan, exactly as on main. Rooms already loaded by then are queued on arrival.
 */
export class LazySwordsmanEdgeWarmup {
  private warmup: SwordsmanEdgeWarmup | null = null;
  readonly ready: Promise<void>;

  /** `load` imports the module; tests pass their own to choose when it arrives. */
  constructor(
    options: SwordsmanEdgeWarmupOptions,
    getLoadedRooms: () => Iterable<WarmupRoom>,
    load: () => Promise<{ SwordsmanEdgeWarmup: typeof SwordsmanEdgeWarmup }> = () => import('./swordsmanEdgeWarmup'),
  ) {
    this.ready = load()
      .then(({ SwordsmanEdgeWarmup: Warmup }) => {
        const warmup = new Warmup(options);
        for (const loadedRoom of getLoadedRooms()) {
          warmup.queueRoom(loadedRoom);
        }
        this.warmup = warmup;
      })
      .catch((error: unknown) => {
        console.error('Sword Hunter jump warm-up did not load; hunters will simulate jumps as they plan.', error);
      });
  }

  queueRoom(loadedRoom: WarmupRoom): void {
    this.warmup?.queueRoom(loadedRoom);
  }

  noteActiveRoom(loadedRoom: WarmupRoom, frameTime: number): void {
    this.warmup?.noteActiveRoom(loadedRoom, frameTime);
  }

  prioritizeRoom(roomId: string): void {
    this.warmup?.prioritizeRoom(roomId);
  }

  finishRoom(roomId: string, budgetMs: number): void {
    this.warmup?.finishRoom(roomId, budgetMs);
  }
}
