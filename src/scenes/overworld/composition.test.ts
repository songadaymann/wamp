import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Compile the actual private-state adapter in isolation: importing the Phaser scene
// would require a browser and obscure these construction/lifecycle contracts.
const source = readFileSync(new URL('../OverworldPlayScene.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('OverworldPlayScene.ts', source, ts.ScriptTarget.Latest, true);
const scene = ast.statements.find(ts.isClassDeclaration)!;
const adapter = scene.members.find((member): member is ts.MethodDeclaration =>
  ts.isMethodDeclaration(member) && member.name.getText(ast) === 'createCompositionPorts')!;
const javascript = ts.transpileModule(`(function(owner) ${adapter.body!.getText(ast)})`, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
}).outputText;
type Ports = Record<string, unknown>;
const createPorts = runInNewContext(javascript) as (owner: Ports) => Ports;
function call(ports: Ports, name: string, ...args: unknown[]): unknown {
  const command = ports[name];
  if (typeof command !== 'function') throw new Error(`Missing command ${name}`);
  return command(...args);
}

// Frozen construction order from delivered main b4b63234. Lazy callbacks can refer
// to controllers built later, so reordering a factory is an observable change.
const constructionOrder = [
  "backdropController",
  "runtimeContext",
  "quicksandController",
  "playerDeathPresentation",
  "gameFeelController",
  "ghostRaceController",
  "playerHealthController",
  "guestRunPlaybackController",
  "goalRunController",
  "roomAudioController",
  "lightingController",
  "weatherController",
  "respawnCheckpointController",
  "lostSongController",
  "liveObjectController",
  "signController",
  "portalObjectController",
  "specialTilesController",
  "worldStreamingController",
  "roomRushResultController",
  "roomRushModeController",
  "presenceController",
  "combatPresentationController",
  "pvpInstanceRenderer",
  "pvpLocalPresentationController",
  "pvpArenaController",
  "roomChatController",
  "browseRealtimeStartupGate",
  "roomCommentsController",
  "coursePlaybackController",
  "roomMusicPlaybackController",
  "windowController",
  "objectiveController",
  "gridOverlayController",
  "browseOverlayController",
  "roomCellController",
  "goalMarkerController",
  "cameraController",
  "viewportController",
  "runtimeController",
  "playerLifecycleController",
  "respawnController",
  "playerPresentationController",
  "movementController",
  "combatController",
  "sessionResetController",
  "hudStateController",
  "selectionController",
  "roomTransitionController",
  "presenceOverlayController",
  "flowController",
  "inspectInputController",
  // The frame planner is pure and is installed after every controller it uses.
  "framePipeline"
];

describe('overworld composition lifecycle', () => {
  it('builds every controller in the established order and keeps construction out of the scene', () => {
    const constructor = scene.members.find(ts.isConstructorDeclaration)!;
    const actual: string[] = [];
    let directConstructions = 0;
    for (const statement of constructor.body!.statements) {
      const find = (node: ts.Node): void => {
        if (ts.isNewExpression(node)) directConstructions++;
        if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
          && ts.isPropertyAccessExpression(node.left) && node.left.expression.kind === ts.SyntaxKind.ThisKeyword) {
          actual.push(node.left.name.text);
          expect(ts.isCallExpression(node.right)).toBe(true);
        }
        ts.forEachChild(node, find);
      };
      find(statement);
    }
    expect(actual).toEqual(constructionOrder);
    expect(directConstructions).toBe(0);
    expect(constructor.body!.statements.length).toBe(55);
  });

  it('creates the adapter without reading any uninitialized controller or player state', () => {
    const reads: string[] = [];
    const owner = new Proxy({}, { get: (_target, key) => { reads.push(String(key)); throw new Error('eager dependency'); } });
    const ports = createPorts(owner);
    expect(ports.scene).toBe(owner);
    expect(reads).toEqual([]);
  });

  it('keeps every field live through missing, created, destroyed and replaced values', () => {
    const owner: Ports = {}, ports = createPorts(owner);
    const descriptors = Object.getOwnPropertyDescriptors(ports);
    let fields = 0;
    for (const [name, descriptor] of Object.entries(descriptors)) {
      if (!descriptor.get) continue;
      expect(ports[name]).toBeUndefined();
      const first = { generation: 1 }, second = { generation: 2 };
      owner[name] = first; expect(ports[name]).toBe(first);
      owner[name] = null; expect(ports[name]).toBeNull();
      owner[name] = second; expect(ports[name]).toBe(second);
      fields++;
    }
    expect(fields).toBeGreaterThan(100);
  });

  it('writes only owned mutable state, preserving value identity and unrelated state', () => {
    const owner: Ports = { unrelated: 7 }, ports = createPorts(owner);
    let writers = 0;
    for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(ports))) {
      if (!descriptor.set) continue;
      const value = { name }; ports[name] = value;
      expect(owner[name]).toBe(value); expect(owner.unrelated).toBe(7); writers++;
    }
    expect(writers).toBe(24);
    for (const name of ['player', 'playerBody', 'worldStreamingController', 'activeRoomRushRun', 'PLAYER_WIDTH']) {
      expect(Object.getOwnPropertyDescriptor(ports, name)?.set).toBeUndefined();
    }
  });

  it('resolves every command at call time with the original receiver, arguments and result', () => {
    const owner: Ports = {}, ports = createPorts(owner);
    let commands = 0;
    for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(ports))) {
      if (typeof descriptor.value !== 'function') continue;
      const token = {}, arg = {};
      owner[name] = function(this: Ports, ...args: unknown[]) {
        expect(this).toBe(owner); expect(args).toEqual([7, arg]); return token;
      };
      expect(call(ports, name, 7, arg)).toBe(token);
      const replacement = {};
      owner[name] = () => replacement;
      expect(call(ports, name)).toBe(replacement);
      commands++;
    }
    expect(commands).toBeGreaterThan(100);
  });

  it('passes asynchronous values and exceptions through without taking ownership', async () => {
    const owner: Ports = {}, ports = createPorts(owner), pending = Promise.resolve({ ready: true });
    owner.refreshAround = () => pending;
    expect(call(ports, 'refreshAround')).toBe(pending);
    expect(await pending).toEqual({ ready: true });
    const error = new Error('stream interrupted');
    owner.refreshAround = () => { throw error; };
    expect(() => call(ports, 'refreshAround')).toThrow(error);
  });

  it('retains the generic profiling callback and exact returned value', () => {
    const owner: Ports = {}, ports = createPorts(owner), result = {};
    let count = 0;
    owner.measureMobilePerformance = (label: unknown, run: unknown) => {
      expect(label).toBe('player.test');
      if (typeof run !== 'function') throw new Error('Missing callback');
      count++; return run();
    };
    expect(call(ports, 'measureMobilePerformance', 'player.test', () => result)).toBe(result);
    expect(count).toBe(1);
  });
});
