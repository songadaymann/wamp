import { roomIdFromCoordinates } from '../persistence/roomModel';
import { expandedRoomIdFromStandaloneRoomId } from '../expandedRooms/model';
import {
  ROOM_RUSH_NAME,
  type ActiveRoomRushRunState,
  type RoomRushRouteStep,
} from '../scenes/overworld/roomRushRuns';
import type { RunShareImage } from './runShare';

const CARD_WIDTH = 1200;
const CARD_HEIGHT = 630;
const MAP_X = 46;
const MAP_Y = 118;
const MAP_WIDTH = 760;
const MAP_HEIGHT = 458;
const PANEL_X = 842;
const PANEL_Y = 106;
const PANEL_WIDTH = 312;
const PANEL_HEIGHT = 470;

export interface RoomRushOverworldCapture {
  source: CanvasImageSource;
  sourceWidth: number;
  sourceHeight: number;
  routePoints: Array<{ x: number; y: number }>;
}

const PALETTE = {
  ink: '#18161c',
  cream: '#fff3db',
  paper: '#fffaf0',
  cyan: '#79ccde',
  blue: '#2c5071',
  green: '#7fcf60',
  red: '#ed5f4b',
  yellow: '#fcea7c',
  orange: '#faaa39',
  lavender: '#d7d2ff',
};

const TILE_COLORS = [
  '#eef7dd',
  '#eefbfd',
  '#fff7cf',
  '#ffe7e2',
  '#f4ecff',
  '#e8f2ff',
];

export function buildRoomRushShareText(run: ActiveRoomRushRunState): string {
  const score = run.visitedRoomIds.length;
  const roomText = `${score} ${score === 1 ? 'room' : 'rooms'}`;
  const modeText = `${formatRoomRushDifficulty(run)} / ${formatRoomRushStartRule(run)}`;
  const deathText =
    run.deaths === 0
      ? 'no deaths'
      : `${run.deaths} ${run.deaths === 1 ? 'death' : 'deaths'}`;
  const verb = run.result === 'failed' ? 'made it through' : 'traversed';
  const playerName = getRoomRushPlayerDisplayName(run);
  const subject = playerName ?? 'I';
  const routePhrase = playerName ? 'this route' : 'my route';
  return `${subject} ${verb} ${roomText} in WAMP ${ROOM_RUSH_NAME} (${modeText}) in ${formatRoomRushDuration(run.elapsedMs)} with ${deathText}. Can you beat ${routePhrase}?`;
}

export function buildRoomRushShareImageFileName(run: ActiveRoomRushRunState): string {
  const startId = roomIdFromCoordinates(run.startCoordinates).replace('-', 'neg');
  return `wamp-room-rush-${startId}-${run.runId.replace(/[^a-z0-9-]/gi, '-')}.png`;
}

export function renderRoomRushShareImage(
  canvas: HTMLCanvasElement,
  run: ActiveRoomRushRunState,
  options: { overworldCapture?: RoomRushOverworldCapture | null } = {},
): RunShareImage {
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Room Rush share canvas unavailable.');
  }

  drawRoomRushCard(context, run, options.overworldCapture ?? null);
  return {
    dataUrl: canvas.toDataURL('image/png'),
    fileName: buildRoomRushShareImageFileName(run),
  };
}

export function formatRoomRushDuration(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.round(elapsedMs / 100) / 10);
  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(1)}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`;
}

export function formatRoomRushDifficulty(run: ActiveRoomRushRunState): string {
  return run.difficulty === 'hard' ? 'Hard' : 'Easy';
}

export function formatRoomRushStartRule(run: ActiveRoomRushRunState): string {
  return run.startRule === 'origin' ? 'Origin start' : 'Free start';
}

function drawRoomRushCard(
  context: CanvasRenderingContext2D,
  run: ActiveRoomRushRunState,
  overworldCapture: RoomRushOverworldCapture | null,
): void {
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  if (overworldCapture) {
    drawOverworldCard(context, run, overworldCapture);
    return;
  }

  context.fillStyle = PALETTE.cream;
  context.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  drawPixelBackdrop(context);

  drawText(context, 'WAMP', 46, 52, {
    size: 18,
    family: "'Early GameBoy', monospace",
    color: PALETTE.blue,
  });
  drawText(context, ROOM_RUSH_NAME.toUpperCase(), 46, 90, {
    size: 34,
    family: "'Super Mario Bros. NES', monospace",
    color: PALETTE.ink,
  });
  drawText(context, buildRoomRushPlayerTagline(run), 472, 88, {
    size: 24,
    family: "'HomeVideo', monospace",
    color: PALETTE.blue,
    maxWidth: 660,
    minSize: 17,
  });

  drawMap(context, run);
  drawStatsPanel(context, run);
}

function drawOverworldCard(
  context: CanvasRenderingContext2D,
  run: ActiveRoomRushRunState,
  capture: RoomRushOverworldCapture,
): void {
  context.fillStyle = '#050607';
  context.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  const placement = drawImageCover(
    context,
    capture.source,
    capture.sourceWidth,
    capture.sourceHeight,
    0,
    0,
    CARD_WIDTH,
    CARD_HEIGHT,
  );

  context.fillStyle = 'rgba(0, 0, 0, 0.18)';
  context.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  drawRouteOnCapture(context, capture.routePoints, placement);
  drawOverworldTitlePanel(context, run);
  drawOverworldStatsPanel(context, run);
}

interface ImagePlacement {
  x: number;
  y: number;
  scale: number;
}

function drawImageCover(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  x: number,
  y: number,
  width: number,
  height: number,
): ImagePlacement {
  const safeSourceWidth = Math.max(1, sourceWidth);
  const safeSourceHeight = Math.max(1, sourceHeight);
  const scale = Math.max(width / safeSourceWidth, height / safeSourceHeight);
  const drawWidth = safeSourceWidth * scale;
  const drawHeight = safeSourceHeight * scale;
  const drawX = x + (width - drawWidth) / 2;
  const drawY = y + (height - drawHeight) / 2;
  context.drawImage(source, drawX, drawY, drawWidth, drawHeight);
  return { x: drawX, y: drawY, scale };
}

function drawRouteOnCapture(
  context: CanvasRenderingContext2D,
  routePoints: Array<{ x: number; y: number }>,
  placement: ImagePlacement,
): void {
  if (routePoints.length === 0) {
    return;
  }

  const points = routePoints.map((point) => ({
    x: placement.x + point.x * placement.scale,
    y: placement.y + point.y * placement.scale,
  }));
  if (points.length > 1) {
    drawPolyline(context, points, 'rgba(24, 22, 28, 0.92)', 18);
    drawGlowingPolyline(context, points, 'rgba(255, 243, 219, 0.95)', 13, 'rgba(255, 36, 84, 0.9)', 18);
    drawPolyline(context, points, '#ff2454', 9);
    drawPolyline(context, points, '#fff06a', 4);
  }

  const start = points[0];
  const finish = points[points.length - 1];
  if (start) {
    drawRoutePin(context, start.x, start.y, 'S', PALETTE.green);
  }
  if (finish) {
    drawRoutePin(context, finish.x, finish.y, 'F', PALETTE.red);
  }
}

function drawRoutePin(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
  fill: string,
): void {
  context.save();
  context.shadowColor = fill;
  context.shadowBlur = 18;
  context.fillStyle = 'rgba(255, 243, 219, 0.95)';
  context.beginPath();
  context.arc(x, y, 24, 0, Math.PI * 2);
  context.fill();
  context.shadowBlur = 0;

  context.fillStyle = PALETTE.ink;
  context.beginPath();
  context.arc(x + 4, y + 4, 18, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = fill;
  context.beginPath();
  context.arc(x, y, 18, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = PALETTE.cream;
  context.lineWidth = 5;
  context.stroke();
  context.restore();

  drawText(context, label, x - 7, y + 8, {
    size: 23,
    family: "'HomeVideo', monospace",
    color: PALETTE.ink,
  });
}

function drawOverworldTitlePanel(
  context: CanvasRenderingContext2D,
  run: ActiveRoomRushRunState,
): void {
  drawPanel(context, 426, 44, 724, 94, PALETTE.cream, PALETTE.ink, 5);
  drawText(context, buildRoomRushPlayerTagline(run).toUpperCase(), 452, 66, {
    size: 16,
    family: "'HomeVideo', monospace",
    color: PALETTE.blue,
    maxWidth: 656,
    minSize: 13,
  });
  drawText(context, `${ROOM_RUSH_NAME.toUpperCase()} COMPLETE`, 452, 88, {
    size: 34,
    family: "'Super Mario Bros. NES', monospace",
    color: PALETTE.ink,
  });
  drawText(context, buildRoomRushSummaryLine(run), 452, 120, {
    size: 25,
    family: "'HomeVideo', monospace",
    color: PALETTE.ink,
    maxWidth: 656,
    minSize: 18,
  });
}

function drawOverworldStatsPanel(
  context: CanvasRenderingContext2D,
  run: ActiveRoomRushRunState,
): void {
  drawPanel(context, 36, 44, 220, 520, PALETTE.cream, PALETTE.ink, 5);
  context.fillStyle = PALETTE.cyan;
  context.fillRect(58, 66, 176, 10);
  context.fillStyle = PALETTE.yellow;
  context.fillRect(58, 82, 176, 10);

  const score = run.visitedRoomIds.length;
  drawText(context, String(score), 66, 160, {
    size: score >= 100 ? 56 : 74,
    family: "'Super Mario Bros. NES', monospace",
    color: PALETTE.ink,
  });
  drawText(context, score === 1 ? 'ROOM' : 'ROOMS', 74, 210, {
    size: 25,
    family: "'Early GameBoy', monospace",
    color: PALETTE.blue,
  });

  const playerName = getRoomRushPlayerDisplayName(run);
  if (playerName) {
    drawText(context, 'PLAYER', 72, 238, {
      size: 13,
      family: "'Early GameBoy', monospace",
      color: PALETTE.blue,
    });
    drawText(context, playerName, 72, 262, {
      size: 20,
      family: "'HomeVideo', monospace",
      color: PALETTE.ink,
      maxWidth: 154,
      minSize: 14,
    });
  }

  const statRows = [
    ['Mode', `${formatRoomRushDifficulty(run)} - ${formatRoomRushStartRule(run)}`],
    ['Start', roomIdFromCoordinates(run.startCoordinates)],
    ['Finish', roomIdFromCoordinates(run.currentCoordinates)],
    ['Time', formatRoomRushDuration(run.elapsedMs)],
    ['Deaths', String(run.deaths)],
  ];
  let y = playerName ? 302 : 262;
  const rowGap = playerName ? 44 : 52;
  for (const [label, value] of statRows) {
    drawText(context, label.toUpperCase(), 72, y, {
      size: 13,
      family: "'Early GameBoy', monospace",
      color: PALETTE.blue,
    });
    drawText(context, value, 72, y + 24, {
      size: 22,
      family: "'HomeVideo', monospace",
      color: PALETTE.ink,
      maxWidth: 154,
      minSize: 16,
    });
    y += rowGap;
  }

  const resultFill = run.result === 'failed' ? PALETTE.red : PALETTE.green;
  context.fillStyle = PALETTE.ink;
  context.fillRect(67, 510, 144, 34);
  context.fillStyle = resultFill;
  context.fillRect(64, 507, 144, 34);
  context.strokeStyle = PALETTE.ink;
  context.lineWidth = 3;
  context.strokeRect(64, 507, 144, 34);
  drawText(context, run.result === 'failed' ? 'ENDED' : 'COMPLETE', 78, 531, {
    size: 17,
    family: "'HomeVideo', monospace",
    color: PALETTE.ink,
  });
}

function buildRoomRushSummaryLine(run: ActiveRoomRushRunState): string {
  const score = run.visitedRoomIds.length;
  return [
    `${score} ${score === 1 ? 'ROOM' : 'ROOMS'}`,
    `${formatRoomRushDifficulty(run).toUpperCase()} - ${formatRoomRushStartRule(run).toUpperCase()}`,
    formatRoomRushDuration(run.elapsedMs),
    `${run.deaths} ${run.deaths === 1 ? 'DEATH' : 'DEATHS'}`,
  ].join(' / ');
}

function getRoomRushPlayerDisplayName(run: ActiveRoomRushRunState): string | null {
  const name = run.playerDisplayName?.replace(/\s+/g, ' ').trim();
  return name || null;
}

function buildRoomRushPlayerTagline(run: ActiveRoomRushRunState): string {
  const playerName = getRoomRushPlayerDisplayName(run);
  return playerName ? `By ${playerName}` : 'A route through the world';
}

function drawPixelBackdrop(context: CanvasRenderingContext2D): void {
  context.fillStyle = PALETTE.cyan;
  context.fillRect(0, 0, CARD_WIDTH, 14);
  context.fillRect(0, CARD_HEIGHT - 16, CARD_WIDTH, 16);
  context.fillStyle = PALETTE.yellow;
  context.fillRect(0, 14, CARD_WIDTH, 8);
  context.fillStyle = PALETTE.red;
  context.fillRect(0, CARD_HEIGHT - 24, CARD_WIDTH, 8);

  context.globalAlpha = 0.28;
  context.fillStyle = PALETTE.cyan;
  for (let x = 24; x < CARD_WIDTH; x += 96) {
    for (let y = 132; y < CARD_HEIGHT - 44; y += 96) {
      context.fillRect(x, y, 18, 18);
      context.fillRect(x + 18, y + 18, 18, 18);
    }
  }
  context.globalAlpha = 1;
}

function drawMap(context: CanvasRenderingContext2D, run: ActiveRoomRushRunState): void {
  drawPanel(context, MAP_X, MAP_Y, MAP_WIDTH, MAP_HEIGHT, PALETTE.paper, PALETTE.cyan, 6);

  const route = normalizeRoute(run);
  const geometry = getMapGeometry(route);
  drawGrid(context, geometry);
  drawVisitedTiles(context, route, geometry);
  drawRouteLine(context, route, geometry);
  drawRouteMarkers(context, route, geometry);
}

function drawStatsPanel(context: CanvasRenderingContext2D, run: ActiveRoomRushRunState): void {
  drawPanel(context, PANEL_X, PANEL_Y, PANEL_WIDTH, PANEL_HEIGHT, '#fffaf0', PALETTE.ink, 5);
  context.fillStyle = PALETTE.cyan;
  context.fillRect(PANEL_X + 16, PANEL_Y + 18, PANEL_WIDTH - 32, 12);
  context.fillStyle = PALETTE.yellow;
  context.fillRect(PANEL_X + 16, PANEL_Y + 34, PANEL_WIDTH - 32, 12);

  const score = run.visitedRoomIds.length;
  drawText(context, String(score), PANEL_X + 28, PANEL_Y + 112, {
    size: score >= 100 ? 62 : 76,
    family: "'Super Mario Bros. NES', monospace",
    color: PALETTE.ink,
  });
  drawText(context, score === 1 ? 'ROOM' : 'ROOMS', PANEL_X + 40, PANEL_Y + 158, {
    size: 24,
    family: "'Early GameBoy', monospace",
    color: PALETTE.blue,
  });

  const statRows = [
    ['Player', getRoomRushPlayerDisplayName(run) ?? 'Unknown player'],
    ['Mode', `${formatRoomRushDifficulty(run)} - ${formatRoomRushStartRule(run)}`],
    ['Start', roomIdFromCoordinates(run.startCoordinates)],
    ['Finish', roomIdFromCoordinates(run.currentCoordinates)],
    ['Time', formatRoomRushDuration(run.elapsedMs)],
    ['Deaths', String(run.deaths)],
  ];

  let y = PANEL_Y + 202;
  for (const [label, value] of statRows) {
    drawText(context, label.toUpperCase(), PANEL_X + 30, y, {
      size: 13,
      family: "'Early GameBoy', monospace",
      color: PALETTE.blue,
    });
    drawText(context, value, PANEL_X + 30, y + 22, {
      size: 21,
      family: "'HomeVideo', monospace",
      color: PALETTE.ink,
      maxWidth: PANEL_WIDTH - 60,
      minSize: 14,
    });
    y += 48;
  }

  const resultText =
    run.result === 'failed'
      ? 'HARD RUN ENDED'
      : run.result === 'abandoned'
        ? 'RUN ENDED'
        : 'RUN COMPLETE';
  context.fillStyle = run.result === 'failed' ? PALETTE.red : PALETTE.green;
  context.fillRect(PANEL_X + 24, PANEL_Y + PANEL_HEIGHT - 58, PANEL_WIDTH - 48, 34);
  context.strokeStyle = PALETTE.ink;
  context.lineWidth = 3;
  context.strokeRect(PANEL_X + 24, PANEL_Y + PANEL_HEIGHT - 58, PANEL_WIDTH - 48, 34);
  drawText(context, resultText, PANEL_X + 42, PANEL_Y + PANEL_HEIGHT - 35, {
    size: 18,
    family: "'HomeVideo', monospace",
    color: PALETTE.ink,
  });
}

function drawPanel(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
  stroke: string,
  shadow: number,
): void {
  context.fillStyle = PALETTE.ink;
  context.fillRect(x + shadow, y + shadow, width, height);
  context.fillStyle = fill;
  context.fillRect(x, y, width, height);
  context.strokeStyle = stroke;
  context.lineWidth = 4;
  context.strokeRect(x, y, width, height);
}

function drawGrid(context: CanvasRenderingContext2D, geometry: MapGeometry): void {
  const { cellSize, gridX, gridY, gridWidth, gridHeight } = geometry;
  const cellCount = gridWidth * gridHeight;
  if (cellCount > 360) {
    return;
  }

  context.strokeStyle = 'rgba(44, 80, 113, 0.18)';
  context.lineWidth = 2;
  for (let x = 0; x <= gridWidth; x += 1) {
    const drawX = gridX + x * cellSize;
    context.beginPath();
    context.moveTo(drawX, gridY);
    context.lineTo(drawX, gridY + gridHeight * cellSize);
    context.stroke();
  }
  for (let y = 0; y <= gridHeight; y += 1) {
    const drawY = gridY + y * cellSize;
    context.beginPath();
    context.moveTo(gridX, drawY);
    context.lineTo(gridX + gridWidth * cellSize, drawY);
    context.stroke();
  }
}

function drawVisitedTiles(
  context: CanvasRenderingContext2D,
  route: RoomRushRouteStep[],
  geometry: MapGeometry,
): void {
  const uniqueSteps = new Map<string, RoomRushRouteStep>();
  for (const step of route) {
    if (!uniqueSteps.has(step.roomId)) {
      uniqueSteps.set(step.roomId, step);
    }
  }

  for (const step of uniqueSteps.values()) {
    const point = getStepPoint(step, geometry);
    const size = Math.max(12, geometry.cellSize - 8);
    const x = point.x - size / 2;
    const y = point.y - size / 2;
    const color = TILE_COLORS[(step.uniqueVisitIndex - 1) % TILE_COLORS.length] ?? PALETTE.paper;
    context.fillStyle = PALETTE.ink;
    context.fillRect(x + 3, y + 3, size, size);
    context.fillStyle = color;
    context.fillRect(x, y, size, size);
    context.strokeStyle = PALETTE.ink;
    context.lineWidth = 3;
    context.strokeRect(x, y, size, size);

    if (geometry.cellSize >= 34) {
      drawText(context, String(step.uniqueVisitIndex), x + 7, y + 20, {
        size: geometry.cellSize >= 48 ? 18 : 13,
        family: "'HomeVideo', monospace",
        color: PALETTE.ink,
      });
    }
  }
}

function drawRouteLine(
  context: CanvasRenderingContext2D,
  route: RoomRushRouteStep[],
  geometry: MapGeometry,
): void {
  if (route.length < 2) {
    return;
  }

  const points = route.map((step) => getStepPoint(step, geometry));
  drawPolyline(context, points, PALETTE.ink, Math.max(10, geometry.cellSize * 0.26));
  drawGlowingPolyline(
    context,
    points,
    '#ff2454',
    Math.max(6, geometry.cellSize * 0.15),
    'rgba(255, 36, 84, 0.82)',
    Math.max(10, geometry.cellSize * 0.25),
  );
  drawPolyline(context, points, '#fff06a', Math.max(3, geometry.cellSize * 0.08));
}

function drawRouteMarkers(
  context: CanvasRenderingContext2D,
  route: RoomRushRouteStep[],
  geometry: MapGeometry,
): void {
  route.forEach((step, index) => {
    const point = getStepPoint(step, geometry);
    const isStart = index === 0;
    const isFinish = index === route.length - 1;
    const radius = isStart || isFinish
      ? Math.max(8, geometry.cellSize * 0.22)
      : Math.max(3, geometry.cellSize * 0.08);
    context.fillStyle = isStart ? PALETTE.green : isFinish ? PALETTE.red : PALETTE.cream;
    context.strokeStyle = PALETTE.ink;
    context.lineWidth = 3;
    context.beginPath();
    context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();

    if (isStart || isFinish) {
      drawText(context, isStart ? 'S' : 'F', point.x - radius * 0.42, point.y + radius * 0.38, {
        size: Math.max(12, radius * 1.15),
        family: "'HomeVideo', monospace",
        color: PALETTE.ink,
      });
    }
  });
}

function drawPolyline(
  context: CanvasRenderingContext2D,
  points: Array<{ x: number; y: number }>,
  stroke: string,
  width: number,
): void {
  context.strokeStyle = stroke;
  context.lineWidth = width;
  context.lineJoin = 'round';
  context.lineCap = 'round';
  context.beginPath();
  context.moveTo(points[0]?.x ?? 0, points[0]?.y ?? 0);
  for (let index = 1; index < points.length; index += 1) {
    context.lineTo(points[index]?.x ?? 0, points[index]?.y ?? 0);
  }
  context.stroke();
}

function drawGlowingPolyline(
  context: CanvasRenderingContext2D,
  points: Array<{ x: number; y: number }>,
  stroke: string,
  width: number,
  glow: string,
  glowBlur: number,
): void {
  context.save();
  context.shadowColor = glow;
  context.shadowBlur = glowBlur;
  drawPolyline(context, points, stroke, width);
  context.restore();
}

function normalizeRoute(run: ActiveRoomRushRunState): RoomRushRouteStep[] {
  if (run.route.length > 0) {
    return run.route;
  }

  return [{
    routeIndex: 0,
    roomId: roomIdFromCoordinates(run.startCoordinates),
    expandedRoomId: run.visitedRoomIds[0] ??
      expandedRoomIdFromStandaloneRoomId(roomIdFromCoordinates(run.startCoordinates)),
    coordinates: { ...run.startCoordinates },
    uniqueVisitIndex: 1,
    uniqueAreaVisitIndex: 1,
  }];
}

interface MapGeometry {
  minX: number;
  minY: number;
  gridX: number;
  gridY: number;
  gridWidth: number;
  gridHeight: number;
  cellSize: number;
}

function getMapGeometry(route: RoomRushRouteStep[]): MapGeometry {
  const xs = route.map((step) => step.coordinates.x);
  const ys = route.map((step) => step.coordinates.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const gridWidth = Math.max(1, maxX - minX + 1);
  const gridHeight = Math.max(1, maxY - minY + 1);
  const availableWidth = MAP_WIDTH - 72;
  const availableHeight = MAP_HEIGHT - 72;
  const cellSize = Math.max(
    18,
    Math.min(72, Math.floor(Math.min(availableWidth / gridWidth, availableHeight / gridHeight))),
  );
  const gridPixelWidth = gridWidth * cellSize;
  const gridPixelHeight = gridHeight * cellSize;
  return {
    minX,
    minY,
    gridX: MAP_X + Math.floor((MAP_WIDTH - gridPixelWidth) / 2),
    gridY: MAP_Y + Math.floor((MAP_HEIGHT - gridPixelHeight) / 2),
    gridWidth,
    gridHeight,
    cellSize,
  };
}

function getStepPoint(
  step: RoomRushRouteStep,
  geometry: MapGeometry,
): { x: number; y: number } {
  return {
    x: geometry.gridX + (step.coordinates.x - geometry.minX + 0.5) * geometry.cellSize,
    y: geometry.gridY + (step.coordinates.y - geometry.minY + 0.5) * geometry.cellSize,
  };
}

function drawText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  options: {
    size: number;
    family: string;
    color: string;
    maxWidth?: number;
    minSize?: number;
  },
): void {
  const size = resolveTextSize(context, text, options);
  context.fillStyle = options.color;
  context.font = `${Math.round(size)}px ${options.family}`;
  context.textBaseline = 'alphabetic';
  context.fillText(text, x, y);
}

function resolveTextSize(
  context: CanvasRenderingContext2D,
  text: string,
  options: {
    size: number;
    family: string;
    maxWidth?: number;
    minSize?: number;
  },
): number {
  if (!options.maxWidth || options.maxWidth <= 0) {
    return options.size;
  }

  context.font = `${Math.round(options.size)}px ${options.family}`;
  const measuredWidth = context.measureText(text).width;
  if (measuredWidth <= options.maxWidth) {
    return options.size;
  }

  const minSize = options.minSize ?? 8;
  return Math.max(minSize, Math.floor(options.size * (options.maxWidth / Math.max(1, measuredWidth))));
}
