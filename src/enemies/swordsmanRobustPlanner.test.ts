import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTilesetByKey, ROOM_HEIGHT, ROOM_WIDTH, TILE_SIZE } from '../config';
import { createDefaultRoomSnapshot, type RoomSnapshot } from '../persistence/roomModel';
import { buildSwordsmanTraversalGraph, type SwordsmanBodySnapshot } from './swordsmanTraversal';
import {
  debugSimulateSwordsmanTraversalEdge,
  planSwordsmanRobustTraversal,
  type SwordsmanRobustTraversalPlan,
} from './swordsmanRobustPlanner';

const GROUND = getTilesetByKey('forest')!.firstGid + 14;
const FRAME_MS = 1000 / 60;
let roomSerial = 0;

type Layout = {
  ledges: Array<[tileY: number, fromTileX: number, toTileX: number]>;
  walls?: Array<[tileX: number, fromTileY: number, toTileY: number]>;
  enemy: [tileX: number, tileY: number];
  target: [tileX: number, tileY: number];
};

const DENSE: Layout = {
  ledges: [17, 14, 11, 8, 5].flatMap((tileY) => {
    const ledges: Array<[number, number, number]> = [];
    for (let tileX = tileY % 2 ? 1 : 3; tileX < 38; tileX += 5) ledges.push([tileY, tileX, tileX + 2]);
    return ledges;
  }),
  enemy: [2, 20],
  target: [36, 5],
};
const TYPICAL: Layout = {
  ledges: [
    [17, 3, 7], [17, 12, 16], [17, 24, 28], [17, 33, 37],
    [14, 0, 4], [14, 9, 13], [14, 18, 22], [14, 28, 32],
    [11, 4, 8], [11, 14, 18], [11, 24, 28], [11, 34, 38],
    [8, 10, 14], [8, 26, 30],
  ],
  walls: [[20, 2, 7]],
  enemy: [2, 20],
  target: [28, 8],
};
const STAIRCASE: Layout = {
  ledges: Array.from({ length: 6 }, (_, step) => [17 - step * 2, 4 + step * 5, 7 + step * 5] as [number, number, number]),
  enemy: [1, 20],
  target: [33, 7],
};

/** A new room id each time, so its edges start out unsimulated. */
function freshRoom(layout: Layout): RoomSnapshot {
  roomSerial += 1;
  const room = createDefaultRoomSnapshot(`robust-planner-${roomSerial}`, { x: roomSerial, y: 0 });
  for (let tileX = 0; tileX < ROOM_WIDTH; tileX += 1) {
    room.tileData.terrain[ROOM_HEIGHT - 1][tileX] = GROUND;
    room.tileData.terrain[ROOM_HEIGHT - 2][tileX] = GROUND;
  }
  for (const [tileY, fromTileX, toTileX] of layout.ledges) {
    for (let tileX = fromTileX; tileX <= toTileX; tileX += 1) room.tileData.terrain[tileY][tileX] = GROUND;
  }
  for (const [tileX, fromTileY, toTileY] of layout.walls ?? []) {
    for (let tileY = fromTileY; tileY <= toTileY; tileY += 1) room.tileData.terrain[tileY][tileX] = GROUND;
  }
  return room;
}

function standingAt([tileX, tileY]: [number, number]): SwordsmanBodySnapshot {
  const centerX = tileX * TILE_SIZE + TILE_SIZE / 2;
  const bottom = tileY * TILE_SIZE;
  return { centerX, centerY: bottom - 16, left: centerX - 8, right: centerX + 8, bottom, onFloor: true, wallContactSide: 0 };
}

function plan(room: RoomSnapshot, layout: Layout, deferColdEdgeSimulations: boolean) {
  return planSwordsmanRobustTraversal({
    room,
    graph: buildSwordsmanTraversalGraph(room),
    enemy: standingAt(layout.enemy),
    target: standingAt(layout.target),
    blockedEdgeIds: new Set(),
    bodyWidth: 16,
    bodyHeight: 32,
    deferColdEdgeSimulations,
  });
}

function routeOf(result: SwordsmanRobustTraversalPlan | null) {
  return result && {
    edgeIds: result.edges.map((edge) => edge.id),
    targetNodeId: result.targetNodeId,
    exactRoute: result.exactRoute,
    routeCost: result.routeCost,
    expandedStates: result.expandedStates,
    simulatedEdges: result.simulatedEdges,
  };
}

/** Every clock read moves time on by `stepMs`, so each edge simulation costs at least that. */
function useSteppingClock(stepMs: number): { nextFrame: () => void } {
  let now = 1_000_000 + roomSerial * 100_000;
  vi.spyOn(performance, 'now').mockImplementation(() => (now += stepMs));
  return { nextFrame: () => { now += FRAME_MS; } };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('collect-mode robust planning in a room it has not simulated yet (F302)', () => {
  it.each([
    ['dense ledge grid', DENSE],
    ['typical room with a wall', TYPICAL],
    ['staircase', STAIRCASE],
  ])('spreads the first plan in a %s over frames and lands on the full search route', (_name, layout) => {
    const clock = useSteppingClock(0.5);
    const fullSearch = plan(freshRoom(layout), layout, false);
    expect(fullSearch?.pending).toBeUndefined();
    expect(fullSearch?.edges.length).toBeGreaterThan(0);
    clock.nextFrame();
    clock.nextFrame();

    const room = freshRoom(layout);
    let result = plan(room, layout, true);
    const coldSimulationsPerFrame = [result!.coldSimulatedEdges];
    while (result?.pending && coldSimulationsPerFrame.length < 500) {
      clock.nextFrame();
      result = plan(room, layout, true);
      coldSimulationsPerFrame.push(result!.coldSimulatedEdges);
    }

    // 3 ms of physics a frame at 0.5 ms an edge, less what the clock refills between edges.
    expect(Math.max(...coldSimulationsPerFrame)).toBeLessThanOrEqual(8);
    expect(coldSimulationsPerFrame.length).toBeGreaterThan(1);
    expect(result?.pending).toBeUndefined();
    expect(routeOf(result)).toEqual(routeOf(fullSearch));
    expect(coldSimulationsPerFrame.reduce((sum, count) => sum + count, 0)).toBe(fullSearch!.coldSimulatedEdges);
  });

  it('still simulates every edge at once for plans that do not defer', () => {
    const clock = useSteppingClock(0.5);
    clock.nextFrame();
    const deferred = plan(freshRoom(DENSE), DENSE, true);
    expect(deferred).toMatchObject({ pending: true, edges: [] });
    expect(deferred!.coldSimulatedEdges).toBeGreaterThan(0);
    const result = plan(freshRoom(DENSE), DENSE, false);
    expect(result?.pending).toBeUndefined();
    expect(result!.coldSimulatedEdges).toBeGreaterThan(100);
  });

  it('simulates each jump the same whichever tiles were read first', () => {
    const forwardRoom = freshRoom(TYPICAL);
    const reverseRoom = freshRoom(TYPICAL);
    const forwardGraph = buildSwordsmanTraversalGraph(forwardRoom);
    const reverseGraph = buildSwordsmanTraversalGraph(reverseRoom);
    const forwardEdges = Array.from(forwardGraph.edgesById.values());
    const reverseEdges = Array.from(reverseGraph.edgesById.values()).reverse();
    const forward = new Map(forwardEdges.map((edge) => [edge.id, debugSimulateSwordsmanTraversalEdge(forwardRoom, forwardGraph, edge, 16, 32)]));
    const reverse = new Map(reverseEdges.map((edge) => [edge.id, debugSimulateSwordsmanTraversalEdge(reverseRoom, reverseGraph, edge, 16, 32)]));
    expect(forwardEdges.filter((edge) => forward.get(edge.id)!.success).length).toBeGreaterThan(20);
    expect(new Map([...reverse].sort(([left], [right]) => left.localeCompare(right))))
      .toEqual(new Map([...forward].sort(([left], [right]) => left.localeCompare(right))));
  });
});
