import { TILESETS, getTilesetByKey, type TilesetConfig } from '../../config';

const TILESET_MENU_SECTIONS: readonly { label: string | null; keys: readonly string[] }[] = [
  { label: 'Beginner', keys: ['essentials', 'boygame'] },
  { label: null, keys: ['special'] },
  { label: 'Intermediate', keys: ['forest', 'desert', 'cave', 'lava', 'snow', 'water', 'gothic', 'smb_lvl1_3_5'] },
  { label: 'Expert', keys: ['cybercity yellow', 'cybercity pink', 'wampos95', 'backrooms'] },
  { label: 'Deco', keys: ['cybercity extras', 'jungle-vines', 'signs and graffiti'] },
  { label: 'Text', keys: ['text white', 'text black', 'cybertext', 'micromono', 'micromonobold'] },
];

export function getEditorTilesetSections(tilesets: readonly TilesetConfig[] = TILESETS): { label: string | null; tilesets: TilesetConfig[] }[] {
  const visible = new Map(tilesets.filter(tileset => !tileset.editorHidden).map(tileset => [tileset.key, tileset]));
  const sections = TILESET_MENU_SECTIONS.map(section => ({
    label: section.label,
    tilesets: section.keys.flatMap(key => {
      const tileset = visible.get(key);
      visible.delete(key);
      return tileset ? [tileset] : [];
    }),
  })).filter(section => section.tilesets.length > 0);
  // New packs remain available until their menu group is assigned.
  if (visible.size > 0) sections.push({ label: null, tilesets: [...visible.values()].sort((left, right) => left.name.localeCompare(right.name)) });
  return sections;
}

export function populateEditorTilesetOptions(select: HTMLSelectElement, selectedKey: string): void {
  const doc = select.ownerDocument;
  const sections = getEditorTilesetSections();
  const available = sections.flatMap(section => section.tilesets);
  const normalizedKey = getTilesetByKey(selectedKey)?.key;
  const nextKey = available.find(tileset => tileset.key === normalizedKey)?.key ?? available[0]?.key ?? '';
  const nodes = sections.flatMap(section => {
    const options = section.tilesets.map(tileset => {
      const option = doc.createElement('option');
      option.value = tileset.key;
      option.textContent = tileset.name;
      return option;
    });
    if (!section.label) return options;
    const group = doc.createElement('optgroup');
    group.label = section.label;
    group.append(...options);
    return [group];
  });
  select.replaceChildren(...nodes);
  select.value = nextKey;
}
