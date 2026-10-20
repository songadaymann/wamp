import { describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import { OverworldRuntimeContext, type RuntimePlayerReader } from './runtimeContext';

function fixture() {
  const refs: { current: RuntimePlayerReader } = { current: { player: null, playerBody: null, playerSprite: null,
    playerPickupSensor: null, playerPickupSensorBody: null } };
  const state = { mode: 'browse' as 'browse' | 'play', camera: 'inspect' as 'inspect' | 'follow',
    selected: { x: -11, y: -6 }, current: { x: 0, y: 0 } };
  const getBody = vi.fn(() => refs.current.playerBody);
  const context = new OverworldRuntimeContext({
    getMode: () => state.mode, setMode: mode => { state.mode = mode; },
    getCameraMode: () => state.camera, setCameraMode: mode => { state.camera = mode; },
    getSelectedCoordinates: () => state.selected, getCurrentRoomCoordinates: () => state.current,
    getPlayer: () => refs.current.player, getPlayerBody: getBody, getPlayerSprite: () => refs.current.playerSprite,
    getPlayerPickupSensor: () => refs.current.playerPickupSensor, getPlayerPickupSensorBody: () => refs.current.playerPickupSensorBody,
    isPvpArenaActive: () => true, isPvpMatchActive: () => false, isRoomRushActive: () => false,
    isBackdropCameraActive: () => true, getBackdropLayerCount: () => 3, isLightingActive: () => state.mode === 'play',
  });
  return { context, state, refs, getBody };
}
function actor(x: number): RuntimePlayerReader {
  return { player: { x } as Phaser.GameObjects.Rectangle, playerBody: { center: { x } } as Phaser.Physics.Arcade.Body,
    playerSprite: { x } as Phaser.GameObjects.Sprite, playerPickupSensor: { x } as Phaser.GameObjects.Rectangle,
    playerPickupSensorBody: { center: { x } } as Phaser.Physics.Arcade.Body };
}

describe('live overworld controller state', () => {
  it('does not read uncreated player dependencies during context construction or a diagnostic snapshot', () => {
    const f = fixture(); expect(f.getBody).not.toHaveBeenCalled();
    f.context.getSnapshot(); expect(f.getBody).not.toHaveBeenCalled();
    expect(f.context.playerBody).toBeNull(); expect(f.getBody).toHaveBeenCalledOnce();
    expect(f.context.player).toBeNull(); expect(f.context.playerSprite).toBeNull();
    expect(f.context.playerPickupSensor).toBeNull(); expect(f.context.playerPickupSensorBody).toBeNull();
  });
  it('exposes the current references through create, destroy and respawn without retaining old actors', () => {
    const f = fixture(), first = actor(10), second = actor(99);
    const check = (expected: RuntimePlayerReader) => {
      expect(f.context.player).toBe(expected.player); expect(f.context.playerBody).toBe(expected.playerBody);
      expect(f.context.playerSprite).toBe(expected.playerSprite); expect(f.context.playerPickupSensor).toBe(expected.playerPickupSensor);
      expect(f.context.playerPickupSensorBody).toBe(expected.playerPickupSensorBody);
    };
    f.refs.current = first; check(first);
    f.refs.current = { player: null, playerBody: null, playerSprite: null, playerPickupSensor: null, playerPickupSensorBody: null };
    check(f.refs.current); f.refs.current = second; check(second);
    second.player!.x = 117; expect(f.context.player?.x).toBe(117);
  });
  it('keeps detached mode/camera access live when the scene replaces values', () => {
    const f = fixture(), get = f.context.mode.get, set = f.context.mode.set;
    const cameraGet = f.context.cameraMode.get, cameraSet = f.context.cameraMode.set;
    expect(get()).toBe('browse'); set('play'); expect(f.state.mode).toBe('play');
    f.state.mode = 'browse'; expect(get()).toBe('browse');
    cameraSet('follow'); expect(f.state.camera).toBe('follow'); f.state.camera = 'inspect'; expect(cameraGet()).toBe('inspect');
  });
  it('retains live coordinate identity for controllers and detached coordinates for diagnostics', () => {
    const f = fixture(); expect(f.context.selectedCoordinates).toBe(f.state.selected);
    expect(f.context.currentRoomCoordinates).toBe(f.state.current);
    const snapshot = f.context.getSnapshot(); snapshot.selectedCoordinates.x = 99; snapshot.currentRoomCoordinates.y = 99;
    expect(f.state.selected).toEqual({ x: -11, y: -6 }); expect(f.state.current).toEqual({ x: 0, y: 0 });
    f.state.selected = { x: 7, y: -8 }; f.state.current = { x: -7, y: 8 };
    expect(f.context.selectedCoordinates).toBe(f.state.selected); expect(f.context.currentRoomCoordinates).toBe(f.state.current);
  });
  it('preserves the serialized diagnostic contract without leaking circular Phaser references', () => {
    const f = fixture(), player = actor(1); Object.assign(player.player!, { scene: player }); f.refs.current = player;
    f.context.mode.set('play'); f.context.cameraMode.set('follow'); f.context.setLifecycle('active');
    expect(JSON.parse(JSON.stringify(f.context.getSnapshot()))).toEqual({ lifecycle: 'active', mode: 'play', cameraMode: 'follow',
      selectedCoordinates: { x: -11, y: -6 }, currentRoomCoordinates: { x: 0, y: 0 }, pvp: { arenaActive: true, matchActive: false },
      roomRush: { active: false }, backdrop: { cameraActive: true, layerCount: 3 }, lighting: { active: true } });
    f.context.setLifecycle('shutting-down'); expect(f.context.getSnapshot().lifecycle).toBe('shutting-down');
    f.context.setLifecycle('initializing'); expect(f.context.getSnapshot().lifecycle).toBe('initializing');
  });
});
