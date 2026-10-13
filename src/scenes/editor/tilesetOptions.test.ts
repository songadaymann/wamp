import { describe, expect, it } from 'vitest';
import { TILESETS } from '../../config';
import { getEditorTilesetSections } from './tilesetOptions';

describe('editor tileset menu', () => {
  it('groups every visible pack once while preserving its saved key and GID', () => {
    const sections = getEditorTilesetSections();
    expect(sections.map(section => section.label)).toEqual(['Beginner', null, 'Intermediate', 'Expert', 'Deco', 'Text']);
    expect(sections[0].tilesets.map(tileset => tileset.name)).toEqual(['Essentials', 'Boygame']);
    expect(sections[1].tilesets.map(tileset => tileset.name)).toEqual(['Special']);
    expect(sections[4].tilesets.map(tileset => tileset.name)).toEqual(['Cybercity Extras', 'Jungle Vines', 'Signs and Graffiti']);
    expect(sections[5].tilesets.map(tileset => tileset.name)).toEqual(['Text White', 'Text Black', 'Cyber Text', 'MicroMono', 'MicroMonoBold']);
    const options = sections.flatMap(section => section.tilesets);
    expect(new Set(options.map(tileset => tileset.key)).size).toBe(options.length);
    expect([...options].sort((a, b) => a.firstGid - b.firstGid)).toEqual(TILESETS.filter(tileset => !tileset.editorHidden).sort((a, b) => a.firstGid - b.firstGid));
  });

  it('keeps newly added packs reachable and excludes hidden internal atlases', () => {
    const extra = { ...TILESETS[0], key: 'new-pack', name: 'New Pack' };
    const hidden = { ...TILESETS[0], key: 'hidden-pack', editorHidden: true };
    const options = getEditorTilesetSections([...TILESETS, extra, hidden]).flatMap(section => section.tilesets);
    expect(options).toContain(extra); expect(options).not.toContain(hidden);
  });
});
