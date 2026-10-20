import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
interface Spec {
  name?: string;
  profile: string;
  mode?: string;
  player?: boolean;
  speed?: number;
  criticalAt?: number | null;
  slot?: number;
  course?: boolean;
  rush?: boolean;
  dead?: boolean;
  held?: boolean;
  mutateAt?: string;
  mutation?: Record<string, unknown>;
  throwAt?: string[];
  undefinedSegment?: number;
  tileWork?: boolean;
  steps?: number;
  keys?: string[];
  pad?: string[];
  pvp?: boolean;
  countdown?: boolean;
  bufferedSword?: boolean;
  bufferedGun?: boolean;
  lostSongChanged?: boolean;
  touch?: string[];
  delta?: number;
}
// These hashes were captured from delivered main ba02037f BEFORE extraction.
// They cover ordered calls, argument identity tags, clock values, final state and errors.
// Transpile the actual planner in a deterministic clock/touch realm without Phaser.
const frozen = JSON.parse(
  readFileSync(
    new URL('./__fixtures__/frameTraces.json', import.meta.url),
    'utf8',
  ),
) as {
  records: {
    spec: Spec;
    sha256: string;
  }[];
};
const pipelineSource = readFileSync(
  new URL('./framePipeline.ts', import.meta.url),
  'utf8',
)
  .replace(/^import .*;$/gm, '')
  .replace(/export (class|const) /g, '$1 ');
const compilerOptions = {
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ESNext,
};
const candidateJavascript = ts.transpileModule(
  pipelineSource +
    '\n(function(){let pipeline;return function(_time,delta){pipeline??=new OverworldFramePipeline(this);pipeline.update(delta);}})()',
  { compilerOptions },
).outputText;
function characterize(
  spec: Spec,
  options: {
    reenter?: boolean;
    repeat?: number;
  } = {},
) {
  const events: unknown[][] = [],
    cache = new Map<string, unknown>(),
    tags = new WeakMap<object, string>(),
    consumed = new Set<string>();
  let time = 0,
    segment = 0;
  const coordinates = { x: -11, y: -6 },
    movement = { grounded: true, downHeld: false, verticalInput: 0 },
    frameResult = { budget: 7 },
    perfContext = { frame: 'fixture' },
    bodyToken = { actor: 1 };
  for (const [obj, name] of [
    [coordinates, 'coordinates'],
    [movement, 'movement'],
    [frameResult, 'workResult'],
    [perfContext, 'performanceContext'],
    [bodyToken, 'player'],
  ] as const)
    tags.set(obj, name);
  const state: Record<string, unknown> = {
    mode: spec.mode ?? 'play',
    playerBody: spec.player === false ? null : bodyToken,
    assist: { runtime: { speed: spec.speed ?? 1 } },
    criticalFrameStartedAtMs:
      spec.criticalAt === undefined ? 0 : spec.criticalAt,
    mobilePerformanceControllerProfilingEnabled: spec.profile !== 'disabled',
    mobilePerformanceControllerProfileSlot: spec.slot ?? 0,
    playerPresentationGroundedOverride: null,
    roomMusicSyncInput: {
      mode: 'old',
      currentRoomCoordinates: null,
      activeCourseRun: null,
    },
    currentRoomCoordinates: coordinates,
    activeCourseRun: spec.course ? { course: 'active' } : null,
    activeRoomRushRun: spec.rush ? { rush: 'active' } : null,
    dead: spec.dead ?? false,
    held: spec.held ?? false,
  };
  tags.set(state.roomMusicSyncInput as object, 'musicInput');
  if (state.activeCourseRun)
    tags.set(state.activeCourseRun as object, 'courseRun');
  if (state.activeRoomRushRun)
    tags.set(state.activeRoomRushRun as object, 'rushRun');
  function value(v: unknown): unknown {
    if (v === undefined) return { $undefined: true };
    if (v === null || (typeof v !== 'object' && typeof v !== 'function'))
      return v;
    if (tags.has(v)) {
      const tag = tags.get(v);
      return tag === 'musicInput'
        ? {
            $ref: tag,
            fields: Object.fromEntries(
              Object.entries(v).map(([k, x]) => [k, value(x)]),
            ),
          }
        : { $ref: tag };
    }
    if (typeof v === 'function') return { $function: true };
    if (Array.isArray(v)) return v.map(value);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, value(x)]));
  }
  function clock() {
    const v = time;
    time += 0.125;
    events.push(['clock', v]);
    return v;
  }
  let owner: Record<string, unknown>;
  let run: (this: Record<string, unknown>, time: number, delta: number) => void;
  let entered = false;
  function callable(path: string): unknown {
    if (cache.has(path)) return cache.get(path);
    const target = function () {};
    const proxy = new Proxy(target, {
      get: (_t, key) => callable(path + '.' + String(key)),
      apply: (_t, _receiver, args) => {
        events.push([path, args.map(value)]);
        if (options.reenter && !entered && path === 'updateBackdrop') {
          entered = true;
          run.call(owner, 0, 5);
        }
        if (spec.mutateAt === path)
          for (const [key, val] of Object.entries(spec.mutation ?? {}))
            owner[key] = val === 'PROFILE_OFF' ? null : val;
        if ((spec.throwAt ?? []).includes(path))
          throw new Error(path + ' failed');
        switch (path) {
          case 'profiler.beginSegment': {
            const stamp = clock();
            return ++segment === spec.undefinedSegment ? undefined : stamp;
          }
          case 'profiler.endSegment':
          case 'profiler.endFrame':
            clock();
            return;
          case 'worldStreamingController.updateWorldTiles':
            return spec.tileWork ?? false;
          case 'worldStreamingController.runDiscretionaryFrameWork':
            return frameResult;
          case 'physicsCadence.getStepsThisFrame':
            return spec.steps ?? 1;
          case 'physicsCadence.getMovement':
            return movement;
          case 'gameplayKeyboard.pressed':
            return (spec.keys ?? []).includes(args[0]);
          case 'gamepadInput.pressed':
            return (spec.pad ?? []).includes(args[0]);
          case 'isPvpMatchActive':
            return spec.pvp ?? false;
          case 'isPvpCountdownActive':
            return spec.countdown ?? false;
          case 'gameFeelController.isHoldingPhysics':
            return state.held;
          case 'gameFeelController.isDeathPending':
            return state.dead;
          case 'gameFeelController.consumeCombatInput':
            return {
              ...args[0],
              swordPressed: args[0].swordPressed || Boolean(spec.bufferedSword),
              gunPressed: args[0].gunPressed || Boolean(spec.bufferedGun),
            };
          case 'lostSongController.update':
            return spec.lostSongChanged ?? false;
          case 'buildMobilePerformanceContext':
            return perfContext;
          default:
            return;
        }
      },
    });
    cache.set(path, proxy);
    return proxy;
  }
  state.mobilePerformanceProfiler =
    spec.profile === 'none' ? null : callable('profiler');
  state.physicsCadence = callable('physicsCadence');
  owner = new Proxy(state, {
    get: (target, key) =>
      Object.prototype.hasOwnProperty.call(target, key)
        ? target[String(key)]
        : callable(String(key)),
    set: (target, key, v) => {
      events.push(['set:' + String(key), value(v)]);
      target[String(key)] = v;
      return true;
    },
  });
  run = runInNewContext(candidateJavascript, {
    performance: { now: clock },
    consumeTouchAction: (action: string) => {
      events.push(['touch', [action]]);
      const active =
        (spec.touch ?? []).includes(action) && !consumed.has(action);
      consumed.add(action);
      return active;
    },
  });
  let error: {
    name: string;
    message: string;
  } | null = null;
  try {
    for (let i = 0; i < (options.repeat ?? 1); i++)
      run.call(owner, 0, spec.delta ?? 16.5);
  } catch (e) {
    const failure = e as Error;
    error = { name: failure.name, message: failure.message };
  }
  return {
    events,
    error,
    state: {
      mode: state.mode,
      slot: state.mobilePerformanceControllerProfileSlot,
      criticalAt: state.criticalFrameStartedAtMs,
      groundedOverride: state.playerPresentationGroundedOverride,
      music: value(state.roomMusicSyncInput),
      touchConsumed: [...consumed],
    },
    clock: time,
  };
}
describe('overworld frame behavior captured before extraction', () => {
  it.each(frozen.records)(
    '$spec.name / $spec.profile / $spec.slot',
    ({ spec, sha256 }) => {
      const result = characterize(spec);
      expect(
        createHash('sha256').update(JSON.stringify(result)).digest('hex'),
      ).toBe(sha256);
    },
  );
  it('constructs without reading controllers that are still being initialized', () => {
    const Constructor = runInNewContext(
      ts.transpileModule(pipelineSource + '\nOverworldFramePipeline', {
        compilerOptions,
      }).outputText,
    ) as new (host: object) => object;
    const host = new Proxy(
      {},
      {
        get: () => {
          throw new Error('eager frame dependency');
        },
      },
    );
    expect(() => new Constructor(host)).not.toThrow();
  });
  it('keeps nested frame locals independent and reuses storage without stale movement or delta', () => {
    const result = characterize(
      { profile: 'none', speed: 0.6 },
      { reenter: true, repeat: 2 },
    );
    expect(result.error).toBeNull();
    const traces = result.events.filter(
      (e) => e[0] === 'recordRankedRunTraceFrame',
    );
    expect(traces.map((e) => (e[1] as unknown[])[0])).toEqual([3, 9.9, 9.9]);
    expect(
      result.events.filter(
        (e) => e[0] === 'worldStreamingController.runDiscretionaryFrameWork',
      ),
    ).toHaveLength(3);
    expect(
      result.events.filter((e) => e[0] === 'recordPerformanceAdvisorFrame'),
    ).toHaveLength(3);
    expect(result.state.groundedOverride).toBeNull();
  });
  it('rotates the controller profile slot across successive frames', () => {
    const result = characterize(
      { profile: 'enabled', slot: 19 },
      { repeat: 2 },
    );
    expect(result.error).toBeNull();
    expect(result.state.slot).toBe(1);
    const labels = result.events
      .filter((e) => e[0] === 'profiler.endSegment')
      .map((e) => (e[1] as string[])[0]);
    expect(labels).toEqual([
      'update.world',
      'controller.objectiveRoomRush',
      'update.player',
      'controller.worldStreaming',
      'update.world',
      'update.player',
    ]);
  });
});
