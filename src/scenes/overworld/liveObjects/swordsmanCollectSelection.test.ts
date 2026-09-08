import { LiveObjectSwordsmanController } from './swordsmanController';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultRoomSnapshot } from '../../../persistence/roomModel';
import type { SwordsmanBodySnapshot, SwordsmanSurfaceSegment, SwordsmanTraversalEdge } from '../../../enemies/swordsmanTraversal';
import { planSwordsmanRobustTraversal } from '../../../enemies/swordsmanRobustPlanner';
import { selectSwordsmanCollectTarget, type CollectNodeCandidate, type CollectSelectionInput } from './swordsmanCollectSelection';
import type { LoadedRoomObjectRuntimeState } from './model';
import { SwordsmanRuntimeStateController } from './swordsmanRuntimeStateController';

vi.mock('../../../enemies/swordsmanRobustPlanner', () => ({ planSwordsmanRobustTraversal: vi.fn() }));

function snapshot(x: number, bottom = 160): SwordsmanBodySnapshot {
  return { centerX: x, centerY: bottom - 16, left: x - 8, right: x + 8, bottom, onFloor: true, wallContactSide: 0 };
}
function candidate(key: string, x: number, nodeId = 'current'): CollectNodeCandidate {
  const targetSnapshot = snapshot(x);
  return {
    collectible: { key } as CollectNodeCandidate['collectible'],
    targetBody: {} as CollectNodeCandidate['targetBody'], targetSnapshot, targetNodeId: nodeId,
    objectiveTarget: { kind: 'collectible', body: {} as never, directionX: 1, withinActionRange: false, traversalSnapshot: targetSnapshot },
    rawMetric: Math.abs(x - 100), collectibleCount: 1, collectDeltaY: 0, traversalCenterXSum: x,
  };
}
function fixture(candidates: CollectNodeCandidate[] = []): CollectSelectionInput {
  const currentSurface: SwordsmanSurfaceSegment = {
    id: 'current', kind: 'surface', tileY: 10, topY: 160, leftTileX: 0, rightTileX: 20,
    leftX: 0, rightX: 320, centerX: 160, hasOpenLeft: true, hasOpenRight: true,
  };
  const runtime = {
    directionX: 1, aiActiveTraversalNextNodeId: null, aiTraversalBlockedEdges: [],
    aiCollectState: null, aiCollectRouteTargetNodeId: null, aiCollectRouteExpiresAt: 0,
    aiCollectRouteScore: null, aiCollectRouteValue: 0, aiCollectRoutePenalty: 0,
  } as unknown as LoadedRoomObjectRuntimeState;
  return {
    groupedCandidates: new Map(candidates.map(c => [c.collectible.key, c])),
    currentSweepCandidates: candidates.filter(c => c.targetNodeId === 'current'),
    collectNodeStats: new Map(candidates.map(c => [c.targetNodeId!, { count: c.collectibleCount }])),
    bestImmediateTarget: null, bestOverheadJumpTarget: null, now: 1000,
    room: createDefaultRoomSnapshot('0,0', { x: 0, y: 0 }),
    graph: { cacheKey: 'collect-selection-fixture', surfaceSegments: [currentSurface], wallSegments: [], nodesById: new Map([['current', currentSurface]]), edgesByNodeId: new Map(), edgesById: new Map() },
    enemySnapshot: snapshot(100), currentContext: { currentSurface, currentWall: null, currentNodeId: 'current', startNodeIds: ['current'] },
    blockedEdgeIds: new Set(), sweepDirectionX: 1, bodyWidth: 16, bodyHeight: 32,
    runtime, buildNodeTarget: vi.fn(() => null),
  };
}
function route(input: CollectSelectionInput, target: CollectNodeCandidate, cost = 100) {
  const edge: SwordsmanTraversalEdge = { id: `to-${target.targetNodeId}`, type: 'jump-up', fromId: 'current', toId: target.targetNodeId!, directionX: 1, setupX: 100, targetX: target.targetSnapshot.centerX, allowEdgeDrop: false };
  input.graph.nodesById.set(target.targetNodeId!, { ...input.currentContext.currentSurface!, id: target.targetNodeId! });
  input.graph.edgesById.set(edge.id, edge);
  return { edges: [edge], currentNodeId: 'current', targetNodeId: target.targetNodeId, targetNodeIds: [target.targetNodeId!], exactRoute: true, routeCost: cost, expandedStates: 1, simulatedEdges: 1, planDurationMs: 0 };
}

beforeEach(() => { vi.mocked(planSwordsmanRobustTraversal).mockReset(); });
describe('collect objective priority and route scoring', () => {
  it('takes immediate pickup before overhead, preserves commitment, and does not mutate runtime', () => {
    const input = fixture(); const immediate = candidate('pickup', 100); const overhead = candidate('overhead', 110);
    input.bestImmediateTarget = { ...immediate, metric: 0 }; input.bestOverheadJumpTarget = { ...overhead, metric: 1 };
    Object.assign(input.runtime, { aiCollectState: 'route', aiCollectRouteTargetNodeId: 'distant', aiCollectRouteExpiresAt: 5000 });
    const before = { ...input.runtime }; const result = selectSwordsmanCollectTarget(input);
    expect(result.target?.collectible.key).toBe('pickup'); expect(result.state.aiCollectRouteTargetNodeId).toBe('distant');
    expect(input.runtime).toEqual(before); expect(planSwordsmanRobustTraversal).not.toHaveBeenCalled();
  });
  it('overhead jump clears route before productive sweep and applies only collect state', () => {
    const input = fixture([candidate('sweep', 120)]); input.bestOverheadJumpTarget = { ...candidate('overhead', 110), metric: 5 };
    Object.assign(input.runtime, { aiCollectState: 'route', aiCollectRouteTargetNodeId: 'old', aiCollectRouteExpiresAt: 5000, aiCollectRouteScore: 8, aiCollectRouteValue: 20, aiCollectRoutePenalty: 7 });
    const result = selectSwordsmanCollectTarget(input);
    expect(result.target?.collectible.key).toBe('overhead');
    expect(result.state).toEqual({ aiCollectState: 'jump', aiCollectRouteTargetNodeId: null, aiCollectRouteExpiresAt: 0, aiCollectRouteScore: null, aiCollectRouteValue: 0, aiCollectRoutePenalty: 0 });
    new SwordsmanRuntimeStateController().applyCollectSelection(input.runtime, result.state);
    expect(input.runtime.directionX).toBe(1); expect(input.runtime.aiCollectState).toBe('jump');
  });
  it('sweeps forward ahead of a nearer coin behind and of a committed route', () => {
    const input = fixture([candidate('behind', 70), candidate('forward', 140), candidate('route', 300, 'remote')]);
    Object.assign(input.runtime, { aiCollectRouteTargetNodeId: 'remote', aiCollectRouteExpiresAt: 5000 });
    expect(selectSwordsmanCollectTarget(input).target?.collectible.key).toBe('forward');
    expect(planSwordsmanRobustTraversal).not.toHaveBeenCalled();
  });
  it('honors active traversal before sweep and committed route until exact expiry', () => {
    const remote = candidate('remote', 300, 'remote'); const input = fixture([candidate('local', 120), remote]);
    Object.assign(input.runtime, { aiActiveTraversalNextNodeId: 'remote' }); vi.mocked(input.buildNodeTarget).mockReturnValue(remote);
    expect(selectSwordsmanCollectTarget(input).target?.collectible.key).toBe('remote');
    Object.assign(input.runtime, { aiActiveTraversalNextNodeId: null }); input.currentSweepCandidates = [];
    Object.assign(input.runtime, { aiCollectRouteTargetNodeId: 'remote', aiCollectRouteExpiresAt: 1001 });
    expect(selectSwordsmanCollectTarget(input).target?.collectible.key).toBe('remote'); expect(planSwordsmanRobustTraversal).not.toHaveBeenCalled();
    input.now = 1001; selectSwordsmanCollectTarget(input); expect(planSwordsmanRobustTraversal).toHaveBeenCalled();
  });
  it('chooses route value over raw proximity and retains exact score and 7200ms commitment', () => {
    const near = candidate('near', 200, 'near'); const rich = candidate('rich', 300, 'rich'); rich.collectibleCount = 6;
    const input = fixture([near, rich]); const nearPlan = route(input, near); const richPlan = route(input, rich);
    vi.mocked(planSwordsmanRobustTraversal).mockImplementation(request => request.target.centerX === 200 ? nearPlan : richPlan);
    const result = selectSwordsmanCollectTarget(input);
    expect(result.target?.collectible.key).toBe('rich');
    expect(result.state).toMatchObject({ aiCollectState: 'route', aiCollectRouteTargetNodeId: 'rich', aiCollectRouteExpiresAt: 8200, aiCollectRouteScore: -11, aiCollectRouteValue: 816, aiCollectRoutePenalty: 0 });
  });
  it('passes blocked edges to planner, rejects unreachable nodes, and falls back to nonproductive sweep', () => {
    const input = fixture([candidate('behind', 10), candidate('unreachable', 300, 'remote')]); input.blockedEdgeIds = new Set(['blocked']);
    vi.mocked(planSwordsmanRobustTraversal).mockReturnValue(null);
    const result = selectSwordsmanCollectTarget(input); expect(result.target?.collectible.key).toBe('behind'); expect(result.state.aiCollectState).toBe('sweep');
    expect(planSwordsmanRobustTraversal).toHaveBeenCalledWith(expect.objectContaining({ blockedEdgeIds: input.blockedEdgeIds }));
    input.currentSweepCandidates = []; input.groupedCandidates.delete('behind');
    expect(selectSwordsmanCollectTarget(input)).toMatchObject({ target: null, state: { aiCollectState: null } });
  });
  it('retains stable tie ordering and does not alter grouped traversal snapshots', () => {
    const first = candidate('first', 120); first.collectibleCount = 2; first.traversalCenterXSum = 280;
    const input = fixture([first, candidate('second', 120)]); input.currentSweepCandidates = [];
    const result = selectSwordsmanCollectTarget(input);
    expect(result.target?.collectible.key).toBe('first'); expect(result.target?.objectiveTarget.traversalSnapshot?.centerX).toBe(140);
    expect(first.targetSnapshot.centerX).toBe(120);
  });
  it('falls back locally for expensive wall routes after recent wall failure', () => {
    const remote = candidate('remote', 300, 'remote');
    const input = fixture([candidate('behind', 10), remote]); const plan = route(input, remote, 10000);
    plan.edges[0].type = 'wall-jump';
    plan.edges.push({ ...plan.edges[0], id: 'second-wall' }, { ...plan.edges[0], id: 'third-wall' });
    Object.assign(input.runtime, { aiTraversalBlockedEdges: [{ edgeId: 'missing:wall-jump', until: 1001 }] });
    vi.mocked(planSwordsmanRobustTraversal).mockReturnValue(plan);
    const failedWall = selectSwordsmanCollectTarget(input);
    expect(failedWall.target?.collectible.key).toBe('behind'); expect(failedWall.state.aiCollectState).toBe('sweep');
    input.now = 1001;
    const expiredFailure = selectSwordsmanCollectTarget(input);
    expect(expiredFailure.target?.collectible.key).toBe('remote'); expect(expiredFailure.state.aiCollectRoutePenalty).toBe(1680);
  });

  it('rejects partial routes ending on depleted nodes', () => {
    const remote = candidate('remote', 300, 'remote'); const input = fixture([remote]); const plan = route(input, remote);
    plan.exactRoute = false; plan.edges[0].toId = 'empty';
    vi.mocked(planSwordsmanRobustTraversal).mockReturnValue(plan);
    expect(selectSwordsmanCollectTarget(input).target).toBeNull(); expect(input.buildNodeTarget).not.toHaveBeenCalled();
  });
});

// The scene adapter needs rectangle overlap only; graph context and candidate grouping stay real.
vi.mock('phaser', () => ({ default: { Geom: {
  Rectangle: class { constructor(public x: number, public y: number, public width: number, public height: number) {} },
  Intersects: { RectangleToRectangle: (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) => a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y },
} } }));

function sceneInventory(objects: { key: string; x: number; y?: number; category?: string; active?: boolean; missingBody?: boolean }[], standing = true, activeEdge = false) {
  const input = fixture();
  const body = (x: number, y: number) => ({ center: { x, y }, left: x - 8, top: y - 16, width: 16, height: 32, halfWidth: 8, halfHeight: 16 });
  const controller = new LiveObjectSwordsmanController({ isCollectedObjectKey: (key: string) => key === 'collected' } as never);
  controller['getSwordsmanCollectOverheadJump'] = (_room, _surface, _enemy, target) => target.center.y < 100
    ? { directionX: 1, targetX: target.center.x, velocityX: 10, velocityY: -200 } : null;
  controller['buildSwordsmanCollectTraversalSnapshot'] = (_graph, _enemy, target) => standing ? snapshot(target.center.x) : null;
  const liveObjects = objects.map(object => ({ key: object.key, config: { category: object.category ?? 'collectible' }, sprite: { active: object.active ?? true, body: object.missingBody ? null : body(object.x, object.y ?? 144) } }));
  return controller['gatherSwordsmanCollectCandidates'](
    { room: input.room, liveObjects } as never,
    { runtime: { aiActiveTraversalEdgeId: activeEdge ? 'edge' : null } } as never,
    body(100, 144) as never, input.graph, input.currentContext, { x: 0, y: 0 }, 1,
  );
}

describe('collect candidate scene geometry', () => {
  it('excludes collected, inactive, bodyless and noncollectible objects before pickup selection', () => {
    const inventory = sceneInventory([
      { key: 'collected', x: 100 }, { key: 'inactive', x: 100, active: false },
      { key: 'bodyless', x: 100, missingBody: true }, { key: 'enemy', x: 100, category: 'enemy' },
      { key: 'eligible', x: 110 },
    ]);
    expect(inventory.bestImmediateTarget?.collectible.key).toBe('eligible');
    expect(inventory.groupedCandidates.size).toBe(0);
  });
  it('groups standing pickups by real traversal node, keeping nearest representative and count', () => {
    const inventory = sceneInventory([{ key: 'far', x: 200 }, { key: 'near', x: 150 }]);
    expect(inventory.groupedCandidates.get('current')).toMatchObject({ collectible: { key: 'near' }, collectibleCount: 2, traversalCenterXSum: 350 });
    expect(inventory.currentSweepCandidates).toHaveLength(2); expect(inventory.collectNodeStats.get('current')?.count).toBe(2);
  });
  it('keeps unsupported coins overhead-only, with forward preference and active-edge suppression', () => {
    const objects = [{ key: 'behind', x: 70, y: 80 }, { key: 'forward', x: 125, y: 80 }];
    const inventory = sceneInventory(objects, false);
    expect(inventory.bestOverheadJumpTarget?.collectible.key).toBe('forward');
    expect(inventory.currentSweepCandidates).toHaveLength(0); expect(inventory.groupedCandidates.size).toBe(0);
    expect(sceneInventory(objects, false, true).bestOverheadJumpTarget).toBeNull();
  });
});
