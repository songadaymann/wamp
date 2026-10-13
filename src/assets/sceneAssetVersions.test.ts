import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installSceneAssetVersions } from './sceneAssetVersions';

afterEach(() => vi.unstubAllGlobals());

describe('Phaser asset versions', () => {
  it('versions both files of an atlas before transfer, without changing keys, registries or external URLs', () => {
    vi.stubGlobal('__WAMP_PUBLIC_ASSET_HASHES__', { 'assets/player.png': '111111111111', 'assets/player.json': '222222222222' });
    const events = new EventEmitter(), load = new EventEmitter(); const scene = { events, load };
    installSceneAssetVersions(scene as never); installSceneAssetVersions(scene as never);
    const files = [{ key: 'player', url: 'assets/player.png' }, { key: 'player', url: 'assets/player.json' }, { key: 'external', url: 'https://avatars.example/assets/player.png' }];
    for (const file of files) load.emit('addfile', file.key, 'image', load, file);
    expect(files).toEqual([{ key: 'player', url: 'assets/player.png?v=111111111111' }, { key: 'player', url: 'assets/player.json?v=222222222222' }, { key: 'external', url: 'https://avatars.example/assets/player.png' }]);
    expect(load.listenerCount('addfile')).toBe(1);
    events.emit('shutdown'); expect(load.listenerCount('addfile')).toBe(0);
    installSceneAssetVersions(scene as never); expect(load.listenerCount('addfile')).toBe(1);
    events.emit('destroy'); expect(load.listenerCount('addfile')).toBe(0);
  });
});
