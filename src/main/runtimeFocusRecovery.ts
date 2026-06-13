import Phaser from 'phaser';

type RecoveryTrigger =
  | 'install'
  | 'window-focus'
  | 'pageshow'
  | 'document-visible'
  | 'document-focusin'
  | 'pointerdown'
  | 'keydown'
  | 'touchstart'
  | 'manual';

type SkipReason = 'document-hidden' | 'loop-healthy';

type TimeStepWithInternals = Phaser.Core.TimeStep & {
  _coolDown?: number;
  wake: (seamless?: boolean) => void;
};

type GameWithFocusHook = {
  onFocus?: () => void;
};

interface LoopRecoverySnapshot {
  at: number;
  trigger: RecoveryTrigger;
  documentVisibilityState: DocumentVisibilityState;
  documentHidden: boolean;
  documentHasFocus: boolean;
  loopInFocus: boolean;
  loopRunning: boolean;
  gameHasFocus: boolean;
  gameIsPaused: boolean;
  actualFps: number;
  rawDelta: number | null;
  cooldownFrames: number | null;
}

interface LoopRecoverySkipSnapshot extends LoopRecoverySnapshot {
  reason: SkipReason;
}

let installed = false;
let signalCount = 0;
let recoveryCount = 0;
let lastSignal: LoopRecoverySnapshot | null = null;
let lastRecoveryBefore: LoopRecoverySnapshot | null = null;
let lastRecoveryAfter: LoopRecoverySnapshot | null = null;
let lastSkipped: LoopRecoverySkipSnapshot | null = null;

export function installGameLoopFocusRecovery(
  game: Phaser.Game,
  windowObj: Window = window,
  doc: Document = document,
): void {
  if (installed) {
    return;
  }

  installed = true;

  const recover = (trigger: RecoveryTrigger) => {
    recoverGameLoopFocus(game, trigger, doc);
  };

  windowObj.addEventListener('focus', () => recover('window-focus'), { passive: true });
  windowObj.addEventListener('pageshow', () => recover('pageshow'), { passive: true });
  windowObj.addEventListener('keydown', () => recover('keydown'), { capture: true, passive: true });
  windowObj.addEventListener('touchstart', () => recover('touchstart'), { capture: true, passive: true });
  doc.addEventListener('focusin', () => recover('document-focusin'), { passive: true });
  doc.addEventListener('pointerdown', () => recover('pointerdown'), { capture: true, passive: true });
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'visible') {
      recover('document-visible');
    }
  });

  (windowObj as Window & { recover_wamp_game_loop?: () => Record<string, unknown> }).recover_wamp_game_loop = () => {
    recoverGameLoopFocus(game, 'manual', doc);
    return getGameLoopFocusRecoveryDebugState();
  };

  recover('install');
}

export function getGameLoopFocusRecoveryDebugState(): Record<string, unknown> {
  return {
    installed,
    signalCount,
    recoveryCount,
    lastSignal,
    lastRecoveryBefore,
    lastRecoveryAfter,
    lastSkipped,
  };
}

function recoverGameLoopFocus(
  game: Phaser.Game,
  trigger: RecoveryTrigger,
  doc: Document,
): void {
  const before = getLoopRecoverySnapshot(game, trigger, doc);
  signalCount += 1;
  lastSignal = before;

  if (doc.visibilityState === 'hidden') {
    lastSkipped = { ...before, reason: 'document-hidden' };
    return;
  }

  const loop = game.loop as TimeStepWithInternals;
  const shouldRecover =
    !loop.inFocus ||
    !loop.running ||
    game.isPaused ||
    shouldResetSlowVisibleLoop(loop, doc);

  if (!shouldRecover) {
    lastSkipped = { ...before, reason: 'loop-healthy' };
    return;
  }

  lastRecoveryBefore = before;
  recoveryCount += 1;

  if (game.isPaused) {
    game.resume();
  }

  if (!loop.running) {
    loop.wake?.(true);
  }

  const gameWithFocusHook = game as unknown as GameWithFocusHook;
  if (isFocusAffirmingTrigger(trigger) && typeof gameWithFocusHook.onFocus === 'function') {
    gameWithFocusHook.onFocus();
  } else {
    loop.focus();
  }

  lastRecoveryAfter = getLoopRecoverySnapshot(game, trigger, doc);
}

function shouldResetSlowVisibleLoop(loop: TimeStepWithInternals, doc: Document): boolean {
  if (!doc.hasFocus()) {
    return false;
  }

  return typeof loop.rawDelta === 'number' && loop.rawDelta > 80;
}

function isFocusAffirmingTrigger(trigger: RecoveryTrigger): boolean {
  return (
    trigger === 'window-focus' ||
    trigger === 'document-focusin' ||
    trigger === 'pointerdown' ||
    trigger === 'keydown' ||
    trigger === 'touchstart' ||
    trigger === 'manual'
  );
}

function getLoopRecoverySnapshot(
  game: Phaser.Game,
  trigger: RecoveryTrigger,
  doc: Document,
): LoopRecoverySnapshot {
  const loop = game.loop as TimeStepWithInternals;
  return {
    at: Date.now(),
    trigger,
    documentVisibilityState: doc.visibilityState,
    documentHidden: doc.hidden,
    documentHasFocus: doc.hasFocus(),
    loopInFocus: loop.inFocus,
    loopRunning: loop.running,
    gameHasFocus: game.hasFocus,
    gameIsPaused: game.isPaused,
    actualFps: Number(loop.actualFps.toFixed(1)),
    rawDelta: typeof loop.rawDelta === 'number' ? Number(loop.rawDelta.toFixed(2)) : null,
    cooldownFrames: typeof loop._coolDown === 'number' ? loop._coolDown : null,
  };
}
