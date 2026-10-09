export const ROOM_TEMPLATE_IDS = ['flat_run', 'stairs_up', 'vertical_climb', 'arena', 'platform_chain', 'blank'] as const;
export type RoomTemplateId = typeof ROOM_TEMPLATE_IDS[number];
export interface TemplateRectangle { x1: number; y1: number; x2: number; y2: number }
export interface TemplatePoint { tileX: number; tileY: number }
export interface RoomTemplateDefinition {
  id: RoomTemplateId;
  label: string;
  description: string;
  rectangles: readonly TemplateRectangle[];
  spawn: TemplatePoint | null;
  exit: TemplatePoint | null;
  enemies?: readonly (TemplatePoint & { id: string })[];
}

const floor = { x1: 0, y1: 20, x2: 39, y2: 21 };
const spawn = { tileX: 3, tileY: 19 };
export const ROOM_TEMPLATE_DEFINITIONS: readonly RoomTemplateDefinition[] = [
  { id: 'flat_run', label: 'Flat Run', description: 'A floor, a start and an exit. Make it your own.', rectangles: [floor], spawn, exit: { tileX: 36, tileY: 19 } },
  { id: 'stairs_up', label: 'Stairs Up', description: 'Six short climbs to an exit above.', rectangles: [floor, ...Array.from({ length: 6 }, (_, step) => ({ x1: 10 + step * 4, y1: 18 - step * 2, x2: step === 5 ? 38 : 13 + step * 4, y2: 21 }))], spawn, exit: { tileX: 36, tileY: 7 } },
  { id: 'vertical_climb', label: 'Vertical Climb', description: 'Alternating ledges. The floor catches missed jumps.', rectangles: [floor, ...Array.from({ length: 6 }, (_, step) => ({ x1: step % 2 === 0 ? 8 : 16, y1: 18 - step * 2, x2: step % 2 === 0 ? 14 : 22, y2: 18 - step * 2 }))], spawn, exit: { tileX: 19, tileY: 7 } },
  { id: 'arena', label: 'Arena', description: 'Two slimes on a flat floor. Jump past them to the exit.', rectangles: [floor], spawn, exit: { tileX: 36, tileY: 19 }, enemies: [{ id: 'slime_blue', tileX: 12, tileY: 19 }, { id: 'slime_red', tileX: 26, tileY: 19 }] },
  { id: 'platform_chain', label: 'Platform Chain', description: 'A line of small jumps with a floor below.', rectangles: [floor, { x1: 9, y1: 18, x2: 13, y2: 18 }, { x1: 16, y1: 16, x2: 20, y2: 16 }, { x1: 23, y1: 17, x2: 27, y2: 17 }, { x1: 30, y1: 16, x2: 38, y2: 16 }], spawn, exit: { tileX: 35, tileY: 15 } },
  { id: 'blank', label: 'Blank', description: 'An empty layout for your own idea.', rectangles: [], spawn: null, exit: null },
];

export function getRoomTemplateDefinition(id: RoomTemplateId): RoomTemplateDefinition {
  const definition = ROOM_TEMPLATE_DEFINITIONS.find(template => template.id === id);
  if (!definition) throw new RangeError('Unknown room template.');
  return definition;
}
