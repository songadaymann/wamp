/*
Paste this file into the browser DevTools console while signed in on a safety preview.

It exposes:
  window.wampRankedRunSpoof.spoofCurrentRoomRun(...)
  window.wampRankedRunSpoof.spoofCurrentCourseRun(...)

Example:
  await wampRankedRunSpoof.spoofCurrentRoomRun({ traceMode: 'none', elapsedMs: 250 });
  await wampRankedRunSpoof.spoofCurrentRoomRun({ traceMode: 'bad-trace', elapsedMs: 250 });

Use a published non-survival room/course if you want the verifier to trigger reliably.
*/
(function installWampRankedRunSpoof() {
  const DEFAULT_SAFETY_API_BASE = 'https://everybodys-platformer-safety.novox-robot.workers.dev';
  const SAFETY_HOST_PATTERN = /safety/i;

  function ensureSafetyTarget(apiBase) {
    if (
      !SAFETY_HOST_PATTERN.test(location.hostname) &&
      !SAFETY_HOST_PATTERN.test(apiBase) &&
      window.ALLOW_WAMP_NON_SAFETY !== true
    ) {
      throw new Error(
        `Refusing to run outside safety. Host=${location.hostname} apiBase=${apiBase}. ` +
          'Set window.ALLOW_WAMP_NON_SAFETY = true only if you really mean it.'
      );
    }
  }

  function getApiBase() {
    if (SAFETY_HOST_PATTERN.test(location.hostname)) {
      return DEFAULT_SAFETY_API_BASE;
    }
    const metaBase = document
      .querySelector('meta[name="ai-api-base"]')
      ?.getAttribute('content')
      ?.trim();
    return metaBase || DEFAULT_SAFETY_API_BASE;
  }

  function getOverworldDebugState() {
    if (typeof window.render_game_to_text !== 'function') {
      throw new Error('render_game_to_text is not available on this build.');
    }
    const raw = window.render_game_to_text();
    const parsed = JSON.parse(raw);
    const activeScene = parsed?.activeScene ?? null;
    if (!activeScene || activeScene.scene !== 'overworld-play') {
      throw new Error('Open the overworld play scene on the safety preview first.');
    }
    return activeScene;
  }

  function getSceneForCourseOnly() {
    const game = window.__EVERYBODYS_PLATFORMER_GAME__ ?? window.Phaser?.GAMES?.[0] ?? null;
    const scene = game?.scene?.keys?.OverworldPlayScene ?? null;
    if (!scene) {
      throw new Error(
        'Direct scene access is not exposed on this build. Room spoofing works from debug state; ' +
          'course spoofing still needs a dev-exposed scene.'
      );
    }
    return scene;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  async function requestJson(apiBase, path, body) {
    const response = await fetch(`${apiBase}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify(body),
    });

    const raw = await response.text();
    let parsed = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = raw;
    }

    return {
      ok: response.ok,
      status: response.status,
      data: parsed,
      raw,
    };
  }

  function buildBadTrace(binding, coordinates, elapsedMs) {
    return {
      schemaVersion: binding.verificationSchemaVersion,
      verificationNonce: binding.verificationNonce,
      snapshotHash: binding.snapshotHash,
      traceDurationMs: elapsedMs,
      inputEvents: [],
      breadcrumbs: [
        {
          atMs: 0,
          roomX: coordinates.x,
          roomY: coordinates.y,
          x: 8,
          y: 8,
          vx: 0,
          vy: 0,
          grounded: true,
        },
      ],
      roomTransitions: [],
      goalEvents: [],
    };
  }

  function buildRoomFinishBody(goalRun, startData, options) {
    const elapsedMs = Math.max(1, Math.trunc(options.elapsedMs ?? 250));
    const goal = goalRun.goal;
    const body = {
      result: 'completed',
      elapsedMs,
      deaths: 0,
      collectiblesCollected: 0,
      enemiesDefeated: 0,
      checkpointsReached: 0,
      score: null,
      finishedAt: new Date().toISOString(),
    };

    switch (goal.type) {
      case 'collect_target':
        body.collectiblesCollected = Number(goalRun.collectibleTarget ?? goal.requiredCount ?? 0);
        break;
      case 'defeat_all':
        body.enemiesDefeated = Number(goalRun.enemyTarget ?? 0);
        break;
      case 'checkpoint_sprint':
        body.checkpointsReached = Number(goalRun.checkpointTarget ?? goal.checkpoints.length ?? 0);
        break;
      case 'survival':
        body.elapsedMs = Math.max(elapsedMs, goal.durationMs);
        body.score = Math.max(
          Number(options.scoreOverride ?? 0),
          Math.trunc(goal.durationMs / 1000) * 10 + 1000
        );
        break;
      case 'reach_exit':
      default:
        break;
    }

    if (options.traceMode === 'bad-trace') {
      body.verificationTrace = buildBadTrace(startData, goalRun.roomCoordinates, body.elapsedMs);
    }

    return body;
  }

  function buildCourseFinishBody(scene, activeCourseRun, startData, options) {
    const elapsedMs = Math.max(1, Math.trunc(options.elapsedMs ?? 250));
    const goal = activeCourseRun.course.goal;
    const body = {
      result: 'completed',
      elapsedMs,
      deaths: 0,
      collectiblesCollected: 0,
      enemiesDefeated: 0,
      checkpointsReached: 0,
      score: null,
      finishedAt: new Date().toISOString(),
    };

    switch (goal.type) {
      case 'collect_target':
        body.collectiblesCollected = goal.requiredCount;
        body.score = Math.max(Number(options.scoreOverride ?? 0), 5000);
        break;
      case 'defeat_all':
        body.enemiesDefeated = Number(activeCourseRun.enemyTarget ?? 0);
        body.score = Math.max(Number(options.scoreOverride ?? 0), 5000);
        break;
      case 'checkpoint_sprint':
        body.checkpointsReached = goal.checkpoints.length;
        break;
      case 'survival':
        body.elapsedMs = Math.max(elapsedMs, goal.durationMs);
        body.score = Math.max(
          Number(options.scoreOverride ?? 0),
          Math.trunc(goal.durationMs / 1000) * 10 + 1000
        );
        break;
      case 'reach_exit':
        if (!goal.timeLimitMs) {
          body.score = Math.max(Number(options.scoreOverride ?? 0), 5000);
        }
        break;
      default:
        break;
    }

    if (options.traceMode === 'bad-trace') {
      body.verificationTrace = buildBadTrace(
        startData,
        scene.currentRoomCoordinates ?? { x: 0, y: 0 },
        body.elapsedMs
      );
    }

    return body;
  }

  async function spoofCurrentRoomRun(options = {}) {
    const debugState = getOverworldDebugState();
    const apiBase = getApiBase();
    ensureSafetyTarget(apiBase);

    const goalRun = debugState.goalRun;
    if (!goalRun || goalRun.roomStatus !== 'published' || !goalRun.goal) {
      throw new Error('Stand in a published room with an active ranked goal first.');
    }

    const startBody = {
      roomId: goalRun.roomId,
      roomCoordinates: clone(goalRun.roomCoordinates),
      roomVersion: goalRun.roomVersion,
      goal: clone(goalRun.goal),
      startedAt: new Date().toISOString(),
    };

    const start = await requestJson(apiBase, '/api/runs/start', startBody);
    if (!start.ok) {
      console.error('Start failed', start);
      return start;
    }

    const finishBody = buildRoomFinishBody(goalRun, start.data, {
      elapsedMs: options.elapsedMs ?? 250,
      scoreOverride: options.scoreOverride ?? null,
      traceMode: options.traceMode ?? 'bad-trace',
    });

    if ((options.traceMode ?? 'bad-trace') === 'none') {
      delete finishBody.verificationTrace;
    }

    const finish = await requestJson(
      apiBase,
      `/api/runs/${encodeURIComponent(start.data.attemptId)}/finish`,
      finishBody
    );

    const result = {
      kind: 'room',
      roomId: goalRun.roomId,
      roomVersion: goalRun.roomVersion,
      attemptId: start.data.attemptId,
      traceMode: options.traceMode ?? 'bad-trace',
      start,
      finish,
    };
    console.log('wampRankedRunSpoof room result', result);
    return result;
  }

  async function spoofCurrentCourseRun(options = {}) {
    const scene = getSceneForCourseOnly();
    const apiBase = getApiBase();
    ensureSafetyTarget(apiBase);

    const activeCourseRun = scene.activeCourseRun;
    if (!activeCourseRun?.course?.goal || activeCourseRun.course.status !== 'published') {
      throw new Error('Start a published course run first, then call spoofCurrentCourseRun().');
    }

    const startBody = {
      courseId: activeCourseRun.course.id,
      courseVersion: activeCourseRun.course.version,
      goal: clone(activeCourseRun.course.goal),
      startedAt: new Date().toISOString(),
    };

    const start = await requestJson(
      apiBase,
      `/api/courses/${encodeURIComponent(activeCourseRun.course.id)}/runs/start`,
      startBody
    );
    if (!start.ok) {
      console.error('Course start failed', start);
      return start;
    }

    const finishBody = buildCourseFinishBody(scene, activeCourseRun, start.data, {
      elapsedMs: options.elapsedMs ?? 250,
      scoreOverride: options.scoreOverride ?? null,
      traceMode: options.traceMode ?? 'bad-trace',
    });

    if ((options.traceMode ?? 'bad-trace') === 'none') {
      delete finishBody.verificationTrace;
    }

    const finish = await requestJson(
      apiBase,
      `/api/course-runs/${encodeURIComponent(start.data.attemptId)}/finish`,
      finishBody
    );

    const result = {
      kind: 'course',
      courseId: activeCourseRun.course.id,
      courseVersion: activeCourseRun.course.version,
      attemptId: start.data.attemptId,
      traceMode: options.traceMode ?? 'bad-trace',
      start,
      finish,
    };
    console.log('wampRankedRunSpoof course result', result);
    return result;
  }

  window.wampRankedRunSpoof = {
    spoofCurrentRoomRun,
    spoofCurrentCourseRun,
    apiBase: getApiBase(),
  };

  console.log(
    'wampRankedRunSpoof ready.',
    'Use:',
    "await wampRankedRunSpoof.spoofCurrentRoomRun({ traceMode: 'none', elapsedMs: 250 })",
    "or await wampRankedRunSpoof.spoofCurrentRoomRun({ traceMode: 'bad-trace', elapsedMs: 250 })",
  );
})();
