import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getTilesetByKey, ROOM_HEIGHT, ROOM_WIDTH } from '../config';
import { createDefaultRoomSnapshot, type RoomSnapshot } from '../persistence/roomModel';
import { buildSwordsmanTraversalGraph, type SwordsmanBodySnapshot } from './swordsmanTraversal';
import {
  debugSimulateSwordsmanTraversalEdge,
  planSwordsmanRobustTraversal,
  prepareSwordsmanTraversalEdgeSimulation,
  type SwordsmanRobustTraversalPlan,
} from './swordsmanRobustPlanner';

type Layout = {
  ledges: Array<[tileY: number, fromTileX: number, toTileX: number]>;
  walls: Array<[tileX: number, fromTileY: number, toTileY: number]>;
};
type PlanSummary = ReturnType<typeof summarize>;

/** Plans recorded from origin/main's planner (before F302), each on a room with nothing simulated. */
const recorded = JSON.parse(readFileSync(
  new URL('./__fixtures__/robustPlannerMainPlans.json', import.meta.url),
  'utf8',
)) as {
  layouts: Record<string, Layout>;
  cases: Array<{
    layout: string;
    enemy: SwordsmanBodySnapshot;
    target: SwordsmanBodySnapshot;
    blockedEdgeIds: string[];
    bodyWidth: number;
    bodyHeight: number;
    plan: PlanSummary;
  }>;
};

const GROUND = getTilesetByKey('forest')!.firstGid + 14;
let roomSerial = 0;

/** A new room id each time, so none of its edges are simulated yet. */
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
  for (const [tileX, fromTileY, toTileY] of layout.walls) {
    for (let tileY = fromTileY; tileY <= toTileY; tileY += 1) room.tileData.terrain[tileY][tileX] = GROUND;
  }
  return room;
}

function summarize(plan: SwordsmanRobustTraversalPlan | null) {
  return plan && {
    edgeIds: plan.edges.map((edge) => edge.id),
    currentNodeId: plan.currentNodeId,
    targetNodeId: plan.targetNodeId,
    targetNodeIds: plan.targetNodeIds,
    exactRoute: plan.exactRoute,
    routeCost: plan.routeCost,
    expandedStates: plan.expandedStates,
    simulatedEdges: plan.simulatedEdges,
  };
}

function warmEveryEdge(room: RoomSnapshot, bodyWidth = 16, bodyHeight = 32): number {
  const graph = buildSwordsmanTraversalGraph(room);
  let simulated = 0;
  for (const edge of graph.edgesById.values()) {
    if (prepareSwordsmanTraversalEdgeSimulation(room, graph, edge, bodyWidth, bodyHeight)) simulated += 1;
  }
  return simulated;
}

function planIn(room: RoomSnapshot, testCase: typeof recorded.cases[number]) {
  return planSwordsmanRobustTraversal({
    room,
    graph: buildSwordsmanTraversalGraph(room),
    enemy: testCase.enemy,
    target: testCase.target,
    blockedEdgeIds: new Set(testCase.blockedEdgeIds),
    bodyWidth: testCase.bodyWidth,
    bodyHeight: testCase.bodyHeight,
  });
}

describe('robust Sword Hunter planning (F302)', () => {
  it('plans exactly like origin/main in a room it has not simulated yet', () => {
    expect(recorded.cases.length).toBeGreaterThan(100);
    expect(recorded.cases.filter((testCase) => testCase.plan?.edgeIds.length).length).toBeGreaterThan(80);
    for (const testCase of recorded.cases) {
      expect(summarize(planIn(freshRoom(recorded.layouts[testCase.layout]), testCase))).toEqual(testCase.plan);
    }
  });

  it('plans exactly like origin/main from edges simulated ahead, simulating nothing itself', () => {
    for (const testCase of recorded.cases) {
      const room = freshRoom(recorded.layouts[testCase.layout]);
      warmEveryEdge(room, testCase.bodyWidth, testCase.bodyHeight);
      const plan = planIn(room, testCase);
      expect(summarize(plan)).toEqual(testCase.plan);
      expect(plan?.coldSimulatedEdges ?? 0).toBe(0);
    }
  });

  it('simulates each jump the same whichever tiles were read first', () => {
    const layout = recorded.layouts.typical;
    const forwardRoom = freshRoom(layout);
    const reverseRoom = freshRoom(layout);
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

  it('evicts whole least-recently-planned rooms past 4,096 edges instead of clearing every room', () => {
    const dense = recorded.layouts.dense;
    const denseCase = recorded.cases.find((testCase) => testCase.layout === 'dense' && testCase.plan?.edgeIds.length
      && testCase.bodyWidth === 16 && testCase.blockedEdgeIds.length === 0)!;
    const played = freshRoom(dense);
    const edgesPerRoom = warmEveryEdge(played);
    expect(edgesPerRoom).toBeGreaterThan(500);
    // Seven dense rooms fit under the limit; an eighth pushes the least recently used one out.
    const others = Array.from({ length: 6 }, () => freshRoom(dense));
    for (const room of others) warmEveryEdge(room);
    expect(planIn(played, denseCase)?.coldSimulatedEdges).toBe(0);
    warmEveryEdge(freshRoom(dense));

    expect(planIn(played, denseCase)?.coldSimulatedEdges).toBe(0);
    expect(planIn(others[1], denseCase)?.coldSimulatedEdges).toBe(0);
    expect(planIn(others[0], denseCase)?.coldSimulatedEdges).toBeGreaterThan(0);
  });
});
