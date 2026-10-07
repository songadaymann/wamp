import { describe, expect, it, vi } from 'vitest';
import { CRUMBLE_RETURN_MS, CRUMBLE_SHAKE_MS, OverworldCrumblingTilesController } from './crumblingTiles';

const tile = { roomId: '5,-3', tileX: 7, tileY: 11 };
function harness() {
  let occupied = false;
  const warnings: { shake: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }[] = [];
  const host = { showWarning: vi.fn(() => { const warning = { shake: vi.fn(), destroy: vi.fn() }; warnings.push(warning); return warning; }),
    removeTile: vi.fn(), restoreTile: vi.fn(), isOccupied: () => occupied, refreshRoom: vi.fn() };
  return { controller: new OverworldCrumblingTilesController(host), host, warnings,
    setOccupied(value: boolean) { occupied = value; } };
}

describe('crumbling terrain lifecycle', () => {
  it('warns once, remains solid for 400ms even if stepped off, then returns after two seconds', () => {
    const h = harness();
    h.controller.update(100, [tile]);
    h.controller.update(200, [tile]);
    h.controller.update(100 + CRUMBLE_SHAKE_MS - 1, []);
    expect(h.host.showWarning).toHaveBeenCalledTimes(1);
    expect(h.host.removeTile).not.toHaveBeenCalled();
    expect(h.controller.isGone(tile.roomId, tile.tileX, tile.tileY)).toBe(false);
    expect([...h.controller.getHiddenTiles(tile.roomId)]).toHaveLength(1);
    h.controller.update(500, []);
    expect(h.host.removeTile).toHaveBeenCalledTimes(1);
    expect(h.warnings[0].destroy).toHaveBeenCalledOnce();
    expect(h.controller.isGone(tile.roomId, tile.tileX, tile.tileY)).toBe(true);
    h.controller.update(500 + CRUMBLE_RETURN_MS - 1, []);
    expect(h.host.restoreTile).not.toHaveBeenCalled();
    h.controller.update(2500, []);
    expect(h.host.restoreTile).toHaveBeenCalledOnce();
    expect([...h.controller.getHiddenTiles(tile.roomId)]).toHaveLength(0);
    h.controller.update(2600, [tile]);
    expect(h.host.showWarning).toHaveBeenCalledTimes(2);
  });

  it('waits for the player to leave the missing block before restoring collision', () => {
    const h = harness(); h.controller.update(0, [tile]); h.controller.update(400, []);
    h.setOccupied(true); h.controller.update(2400, []); h.controller.update(3000, []);
    expect(h.host.restoreTile).not.toHaveBeenCalled();
    h.setOccupied(false); h.controller.update(3001, []);
    expect(h.host.restoreTile).toHaveBeenCalledOnce();
  });

  it('batches row imagery updates and isolates coordinates in adjacent expanded cells', () => {
    const h = harness(), nextCell = { ...tile, roomId: '6,-3' };
    h.controller.update(0, [tile, { ...tile, tileX: 8 }, nextCell]);
    expect(h.host.refreshRoom).toHaveBeenCalledTimes(2);
    h.controller.update(400, []);
    h.controller.resetRoom(tile.roomId);
    expect(h.host.restoreTile).toHaveBeenCalledTimes(2);
    expect(h.controller.isGone(nextCell.roomId, nextCell.tileX, nextCell.tileY)).toBe(true);
    h.controller.update(2400, []);
    expect(h.host.restoreTile).toHaveBeenCalledTimes(3);
  });

  it('death/restart and room teardown cancel warning helpers and future timers', () => {
    const h = harness(); h.controller.update(0, [tile]); h.controller.resetRoom(tile.roomId);
    h.controller.update(4000, []);
    expect(h.host.removeTile).not.toHaveBeenCalled(); expect(h.warnings[0].destroy).toHaveBeenCalledOnce();
    h.controller.update(5000, [tile]); h.controller.update(5400, []);
    h.controller.destroyRoom(tile.roomId); h.controller.update(10000, []);
    expect(h.host.restoreTile).not.toHaveBeenCalled();
    expect([...h.controller.getHiddenTiles(tile.roomId)]).toHaveLength(0);
  });
});
