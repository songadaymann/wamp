import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTilesetByKey, ROOM_HEIGHT, ROOM_WIDTH, TILE_SIZE } from '../config';
import { createDefaultRoomSnapshot, type RoomSnapshot } from '../persistence/roomModel';
import {
  buildSwordsmanTraversalDecisionFromEdge,
  buildSwordsmanTraversalGraph,
  decideSwordsmanTraversal,
  getSwordsmanTraversalContext,
  getSwordsmanTraversalGraphCacheKey,
  getSwordsmanTraversalGraphForRoom,
  getSwordsmanTraversalTargetContext,
  isSwordsmanTraversalRoomInPlay,
  markSwordsmanTraversalRoomInPlay,
  measureSwordsmanTraversalNodeDistanceToBody,
  peekSwordsmanTraversalGraphForRoom,
  type SwordsmanBodySnapshot,
  type SwordsmanTraversalEdge,
  type SwordsmanTraversalGraph,
} from './swordsmanTraversal';

const GROUND = getTilesetByKey('forest')!.firstGid + 14;

function buildRoom(
  name: string,
  ledges: Array<[tileY: number, fromTileX: number, toTileX: number]>,
  walls: Array<[tileX: number, fromTileY: number, toTileY: number]> = [],
): RoomSnapshot {
  const room = createDefaultRoomSnapshot(`traversal-${name}`, { x: 0, y: 0 });
  for (let tileX = 0; tileX < ROOM_WIDTH; tileX += 1) {
    room.tileData.terrain[ROOM_HEIGHT - 1][tileX] = GROUND;
    room.tileData.terrain[ROOM_HEIGHT - 2][tileX] = GROUND;
  }
  for (const [tileY, fromTileX, toTileX] of ledges) {
    for (let tileX = fromTileX; tileX <= toTileX; tileX += 1) room.tileData.terrain[tileY][tileX] = GROUND;
  }
  for (const [tileX, fromTileY, toTileY] of walls) {
    for (let tileY = fromTileY; tileY <= toTileY; tileY += 1) room.tileData.terrain[tileY][tileX] = GROUND;
  }
  return room;
}

function denseLedgeGrid(): RoomSnapshot {
  const ledges: Array<[number, number, number]> = [];
  for (const tileY of [17, 14, 11, 8, 5]) {
    for (let tileX = tileY % 2 ? 1 : 3; tileX < 38; tileX += 5) ledges.push([tileY, tileX, tileX + 2]);
  }
  return buildRoom('dense', ledges);
}

function typicalRoom(): RoomSnapshot {
  return buildRoom('typical', [
    [17, 3, 7], [17, 12, 16], [17, 24, 28], [17, 33, 37],
    [13, 0, 4], [13, 9, 13], [13, 18, 22], [13, 28, 32],
    [9, 4, 8], [9, 14, 18], [9, 24, 28], [9, 34, 38],
    [5, 10, 14], [5, 26, 30],
  ], [[20, 2, 8]]);
}

function staircaseRoom(): RoomSnapshot {
  return buildRoom('staircase', Array.from({ length: 6 }, (_, step) => [
    17 - step * 2, 4 + step * 5, 7 + step * 5,
  ] as [number, number, number]));
}

function standingOn(centerX: number, bottom: number): SwordsmanBodySnapshot {
  return { centerX, centerY: bottom - 16, left: centerX - 8, right: centerX + 8, bottom, onFloor: true, wallContactSide: 0 };
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** The search as it was before F305: every route, copied per step, scored as it is dequeued. */
function oracleFirstEdge(
  graph: SwordsmanTraversalGraph,
  enemy: SwordsmanBodySnapshot,
  target: SwordsmanBodySnapshot,
  blockedEdgeIds: ReadonlySet<string>,
): SwordsmanTraversalEdge | null {
  const startNodeIds = getSwordsmanTraversalContext(graph, enemy).startNodeIds;
  const targetIdSet = new Set(getSwordsmanTraversalTargetContext(graph, target).targetNodeIds);
  let best: { edges: SwordsmanTraversalEdge[]; score: number } | null = null;
  for (const startNodeId of startNodeIds) {
    const queue = [{ nodeId: startNodeId, edges: [] as SwordsmanTraversalEdge[], visited: new Set([startNodeId]) }];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.edges.length > 0) {
        const node = graph.nodesById.get(current.nodeId);
        let endScore = Number.POSITIVE_INFINITY;
        if (node) {
          const { horizontalDistance, verticalDistance } = measureSwordsmanTraversalNodeDistanceToBody(node, target);
          const bonus = targetIdSet.has(node.id) ? 240 : 0;
          endScore = current.edges.length * 72 + horizontalDistance * 1.5 + verticalDistance * 2 - bonus;
        }
        const score = endScore + oracleEntryScore(current.edges[0], enemy, target);
        if (!best || score < best.score) best = { edges: current.edges, score };
      }
      if (current.edges.length >= 3) continue;
      for (const edge of graph.edgesByNodeId.get(current.nodeId) ?? []) {
        if (blockedEdgeIds.has(edge.id) || current.visited.has(edge.toId)) continue;
        queue.push({ nodeId: edge.toId, edges: [...current.edges, edge], visited: new Set([...current.visited, edge.toId]) });
      }
    }
  }
  return best?.edges[0] ?? null;
}

function oracleEntryScore(edge: SwordsmanTraversalEdge, enemy: SwordsmanBodySnapshot, target: SwordsmanBodySnapshot): number {
  const direction = (delta: number): number => (delta > 0.01 ? 1 : delta < -0.01 ? -1 : edge.directionX >= 0 ? 1 : -1);
  const setupPenalty = Math.abs(edge.setupX - enemy.centerX) * 1.25;
  const currentTargetDistance = Math.abs(target.centerX - enemy.centerX);
  const setupTargetDistance = Math.abs(target.centerX - edge.setupX);
  const directionPenalty =
    currentTargetDistance > TILE_SIZE * 0.75 &&
    direction(target.centerX - enemy.centerX) !== direction(edge.setupX - enemy.centerX)
      ? 52
      : 0;
  return setupPenalty + directionPenalty + Math.max(0, setupTargetDistance - currentTargetDistance) * 4;
}

function expectSameDecisionAsOracle(
  graph: SwordsmanTraversalGraph,
  enemy: SwordsmanBodySnapshot,
  target: SwordsmanBodySnapshot,
  blockedEdgeIds: ReadonlySet<string>,
): boolean {
  const currentContext = getSwordsmanTraversalContext(graph, enemy);
  const targetContext = getSwordsmanTraversalTargetContext(graph, target);
  const decision = decideSwordsmanTraversal(graph, enemy, target, blockedEdgeIds);
  if (currentContext.currentSurface && currentContext.currentSurface.id === targetContext.targetSurface?.id) {
    expect(decision.intent).toBe('same-platform');
    return false;
  }
  const oracleEdge = oracleFirstEdge(graph, enemy, target, blockedEdgeIds);
  if (!oracleEdge) {
    expect(decision.traversalEdgeId === null || !graph.edgesById.has(decision.traversalEdgeId)).toBe(true);
    return false;
  }
  expect(decision).toEqual(buildSwordsmanTraversalDecisionFromEdge(
    oracleEdge,
    enemy,
    target.centerX >= enemy.centerX ? 1 : -1,
    targetContext.targetSurface?.centerX ?? target.centerX,
    currentContext.currentNodeId,
    targetContext.targetNodeId,
    target,
  ));
  return true;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('classic traversal route choice (F305)', () => {
  it.each([
    ['dense ledge grid', denseLedgeGrid],
    ['typical room with a wall', typicalRoom],
    ['staircase', staircaseRoom],
  ])('picks the same first edge as the full per-frame search in a %s', (_name, makeRoom) => {
    const graph = buildSwordsmanTraversalGraph(makeRoom());
    const random = seededRandom(305);
    const surfaces = graph.surfaceSegments;
    const allEdgeIds = Array.from(graph.edgesById.keys());
    let routedCases = 0;
    for (let index = 0; index < 900; index += 1) {
      const enemySurface = surfaces[Math.floor(random() * surfaces.length)];
      const targetSurface = surfaces[Math.floor(random() * surfaces.length)];
      const enemy = standingOn(enemySurface.leftX + random() * (enemySurface.rightX - enemySurface.leftX), enemySurface.topY);
      const target = random() < 0.85
        ? standingOn(targetSurface.leftX + random() * (targetSurface.rightX - targetSurface.leftX), targetSurface.topY)
        : { ...standingOn(random() * ROOM_WIDTH * TILE_SIZE, random() * ROOM_HEIGHT * TILE_SIZE), onFloor: false };
      const blockedEdgeIds = new Set<string>();
      const blockedCount = random() < 0.7 ? 0 : 1 + Math.floor(random() * 3);
      for (let blocked = 0; blocked < blockedCount; blocked += 1) {
        blockedEdgeIds.add(allEdgeIds[Math.floor(random() * allEdgeIds.length)]);
      }
      if (expectSameDecisionAsOracle(graph, enemy, target, blockedEdgeIds)) routedCases += 1;
    }
    expect(routedCases).toBeGreaterThan(300);
  });

  it('keeps choosing like the full search as the enemy and player move along the same ledges', () => {
    const graph = buildSwordsmanTraversalGraph(denseLedgeGrid());
    const ground = graph.surfaceSegments.reduce((lowest, surface) => (surface.topY > lowest.topY ? surface : lowest));
    const high = graph.surfaceSegments.reduce((highest, surface) => (surface.topY < highest.topY ? surface : highest));
    let routedFrames = 0;
    for (let frame = 0; frame < 240; frame += 1) {
      const enemy = standingOn(ground.leftX + 12 + frame * 2, ground.topY);
      const target = standingOn(high.rightX - 4 - (frame % 30), high.topY);
      if (expectSameDecisionAsOracle(graph, enemy, target, new Set())) routedFrames += 1;
    }
    expect(routedFrames).toBe(240);
  });

  it('searches routes only when the enemy reaches another node or an edge is blocked', () => {
    const graph = buildSwordsmanTraversalGraph(denseLedgeGrid());
    const readEdgeList = vi.spyOn(graph.edgesByNodeId, 'get');
    const midLedge = graph.surfaceSegments.find((surface) => surface.tileY === 11)!;
    const otherLedge = graph.surfaceSegments.find((surface) => surface.tileY === 14)!;
    const high = graph.surfaceSegments.find((surface) => surface.tileY === 5)!;
    const target = (frame: number) => standingOn(high.centerX + (frame % 3) * 4, high.topY);

    decideSwordsmanTraversal(graph, standingOn(midLedge.centerX, midLedge.topY), target(0), new Set());
    const firstSearchReads = readEdgeList.mock.calls.length;
    expect(firstSearchReads).toBeGreaterThan(50);

    readEdgeList.mockClear();
    for (let frame = 1; frame < 60; frame += 1) {
      const enemy = standingOn(midLedge.leftX + 4 + (frame % 20), midLedge.topY);
      decideSwordsmanTraversal(graph, enemy, target(frame), new Set());
    }
    expect(readEdgeList).not.toHaveBeenCalled();

    decideSwordsmanTraversal(graph, standingOn(otherLedge.centerX, otherLedge.topY), target(0), new Set());
    expect(readEdgeList.mock.calls.length).toBeGreaterThan(0);

    const firstEdgeId = graph.edgesByNodeId.get(midLedge.id)![0].id;
    readEdgeList.mockClear();
    const blocked = new Set([firstEdgeId]);
    decideSwordsmanTraversal(graph, standingOn(midLedge.centerX, midLedge.topY), target(0), blocked);
    expect(readEdgeList.mock.calls.length).toBeGreaterThan(0);
    readEdgeList.mockClear();
    decideSwordsmanTraversal(graph, standingOn(midLedge.centerX + 3, midLedge.topY), target(1), new Set(blocked));
    expect(readEdgeList).not.toHaveBeenCalled();
  });

  it('keeps one least-recently-used cap on route lists across every room graph', () => {
    const graphs = Array.from({ length: 7 }, () => buildSwordsmanTraversalGraph(denseLedgeGrid()));
    const high = graphs[0].surfaceSegments.find((surface) => surface.tileY === 5)!;
    const target = standingOn(high.centerX, high.topY);
    // 31 route lists per graph: one per ledge below the player's.
    const chaseFromEveryLedge = (graph: SwordsmanTraversalGraph): void => {
      for (const surface of graph.surfaceSegments.filter((candidate) => candidate.tileY !== 5)) {
        decideSwordsmanTraversal(graph, standingOn(surface.centerX, surface.topY), target, new Set());
      }
    };
    const [watched, ...others] = graphs;
    const watchedLedge = watched.surfaceSegments.find((surface) => surface.tileY === 11)!;
    const chaseWatched = (): number => {
      const readEdgeList = vi.spyOn(watched.edgesByNodeId, 'get');
      decideSwordsmanTraversal(watched, standingOn(watchedLedge.centerX, watchedLedge.topY), target, new Set());
      const reads = readEdgeList.mock.calls.length;
      readEdgeList.mockRestore();
      return reads;
    };

    expect(chaseWatched()).toBeGreaterThan(0);
    chaseFromEveryLedge(others[0]);
    chaseFromEveryLedge(others[1]);
    expect(chaseWatched()).toBe(0);
    // 94 lists now: the 30 oldest go, which no longer include the one just used.
    chaseFromEveryLedge(others[2]);
    expect(chaseWatched()).toBe(0);
    // 93 newer lists, more than the 64 kept, push it out.
    chaseFromEveryLedge(others[3]);
    chaseFromEveryLedge(others[4]);
    chaseFromEveryLedge(others[5]);
    expect(chaseWatched()).toBeGreaterThan(0);
  });
});

describe('shared traversal caches (F302)', () => {
  it('drops stale in-play marks first, then the oldest, never one marked this frame', () => {
    const keys = Array.from({ length: 64 }, (_, index) => `in-play-room-${index}`);
    keys.forEach((key, index) => markSwordsmanTraversalRoomInPlay(key, 10_000 + index));
    markSwordsmanTraversalRoomInPlay(keys[0], 10_100);
    markSwordsmanTraversalRoomInPlay('in-play-new', 10_101);
    expect(isSwordsmanTraversalRoomInPlay(keys[0], 10_102)).toBe(true);
    expect(isSwordsmanTraversalRoomInPlay(keys[1], 10_102)).toBe(false);
    expect(isSwordsmanTraversalRoomInPlay(keys[2], 10_102)).toBe(true);

    // Two seconds later every mark but one is stale; all of those go before any fresh one.
    markSwordsmanTraversalRoomInPlay('in-play-new', 12_101);
    markSwordsmanTraversalRoomInPlay('in-play-later', 12_102);
    expect(isSwordsmanTraversalRoomInPlay('in-play-new', 12_103)).toBe(true);
    expect(isSwordsmanTraversalRoomInPlay(keys[0], 12_103)).toBe(false);
  });

  it('keeps graphs least recently used first and never evicts a room in play', () => {
    // In play means marked in the last 2 s of performance.now(); hold it still on a slow machine.
    vi.useFakeTimers({ toFake: ['performance'] });
    const rooms = Array.from({ length: 66 }, (_, index) => createDefaultRoomSnapshot(`graph-cache-${index}`, { x: index, y: 50 }));
    const [played, touched, ...rest] = rooms;
    const playedGraph = getSwordsmanTraversalGraphForRoom(played);
    const touchedGraph = getSwordsmanTraversalGraphForRoom(touched);
    markSwordsmanTraversalRoomInPlay(getSwordsmanTraversalGraphCacheKey(played));
    for (const room of rest.slice(0, 30)) getSwordsmanTraversalGraphForRoom(room);
    expect(peekSwordsmanTraversalGraphForRoom(touched)).toBe(touchedGraph);
    for (const room of rest.slice(30)) getSwordsmanTraversalGraphForRoom(room);

    expect(peekSwordsmanTraversalGraphForRoom(played)).toBe(playedGraph);
    expect(peekSwordsmanTraversalGraphForRoom(touched)).toBe(touchedGraph);
    expect(peekSwordsmanTraversalGraphForRoom(rest[0])).toBeNull();
  });
});

