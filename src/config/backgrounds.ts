export interface BackgroundLayer {
  key: string;
  path: string;
  width: number;
  height: number;
  scrollFactor: number;
}

export interface BackgroundGroup {
  id: string;
  name: string;
  bgColor?: string;
  layers: BackgroundLayer[];
}

export const BACKGROUND_GROUPS: BackgroundGroup[] = [
  { id: 'none', name: 'None', layers: [] },
  {
    id: 'forest',
    name: 'Forest',
    layers: [
      { key: 'forest_1', path: 'assets/backgrounds/forest/1.png', width: 576, height: 324, scrollFactor: 0.0 },
      { key: 'forest_2', path: 'assets/backgrounds/forest/2.png', width: 576, height: 324, scrollFactor: 0.05 },
      { key: 'forest_3', path: 'assets/backgrounds/forest/3.png', width: 576, height: 324, scrollFactor: 0.1 },
      { key: 'forest_5', path: 'assets/backgrounds/forest/5.png', width: 576, height: 324, scrollFactor: 0.2 },
      { key: 'forest_6', path: 'assets/backgrounds/forest/6.png', width: 576, height: 324, scrollFactor: 0.3 },
      { key: 'forest_10', path: 'assets/backgrounds/forest/10.png', width: 576, height: 324, scrollFactor: 0.4 },
      { key: 'forest_7', path: 'assets/backgrounds/forest/7.png', width: 576, height: 324, scrollFactor: 0.5 },
      { key: 'forest_8', path: 'assets/backgrounds/forest/8.png', width: 576, height: 324, scrollFactor: 0.6 },
    ],
  },
  {
    id: 'dark_forest',
    name: 'Dark Forest',
    layers: [
      { key: 'dkforest_1', path: 'assets/backgrounds/dark_forest/1.png', width: 576, height: 324, scrollFactor: 0.0 },
      { key: 'dkforest_2', path: 'assets/backgrounds/dark_forest/2.png', width: 576, height: 324, scrollFactor: 0.05 },
      { key: 'dkforest_3', path: 'assets/backgrounds/dark_forest/3.png', width: 576, height: 324, scrollFactor: 0.1 },
      { key: 'dkforest_4', path: 'assets/backgrounds/dark_forest/4.png', width: 576, height: 324, scrollFactor: 0.2 },
      { key: 'dkforest_5', path: 'assets/backgrounds/dark_forest/5.png', width: 576, height: 324, scrollFactor: 0.35 },
      { key: 'dkforest_6', path: 'assets/backgrounds/dark_forest/6.png', width: 576, height: 324, scrollFactor: 0.5 },
      { key: 'dkforest_7', path: 'assets/backgrounds/dark_forest/7.png', width: 576, height: 324, scrollFactor: 0.6 },
    ],
  },
  {
    id: 'grassland',
    name: 'Grassland',
    layers: [
      { key: 'grass_1', path: 'assets/backgrounds/grassland/1.png', width: 576, height: 324, scrollFactor: 0.0 },
      { key: 'grass_2', path: 'assets/backgrounds/grassland/2.png', width: 576, height: 324, scrollFactor: 0.15 },
      { key: 'grass_3', path: 'assets/backgrounds/grassland/3.png', width: 576, height: 324, scrollFactor: 0.35 },
      { key: 'grass_4', path: 'assets/backgrounds/grassland/4.png', width: 576, height: 324, scrollFactor: 0.6 },
    ],
  },
  {
    id: 'mountains',
    name: 'Mountains',
    layers: [
      { key: 'mtn_1', path: 'assets/backgrounds/mountains/1.png', width: 576, height: 324, scrollFactor: 0.0 },
      { key: 'mtn_2', path: 'assets/backgrounds/mountains/2.png', width: 576, height: 324, scrollFactor: 0.15 },
      { key: 'mtn_3', path: 'assets/backgrounds/mountains/3.png', width: 576, height: 324, scrollFactor: 0.35 },
      { key: 'mtn_4', path: 'assets/backgrounds/mountains/4.png', width: 576, height: 324, scrollFactor: 0.6 },
    ],
  },
  {
    id: 'meadow',
    name: 'Meadow',
    layers: [
      { key: 'meadow_1', path: 'assets/backgrounds/meadow/1.png', width: 576, height: 324, scrollFactor: 0.0 },
      { key: 'meadow_2', path: 'assets/backgrounds/meadow/2.png', width: 576, height: 324, scrollFactor: 0.1 },
      { key: 'meadow_3', path: 'assets/backgrounds/meadow/3.png', width: 576, height: 324, scrollFactor: 0.25 },
      { key: 'meadow_4', path: 'assets/backgrounds/meadow/4.png', width: 576, height: 324, scrollFactor: 0.45 },
      { key: 'meadow_5', path: 'assets/backgrounds/meadow/5.png', width: 576, height: 324, scrollFactor: 0.6 },
    ],
  },
  {
    id: 'aurora',
    name: 'Aurora',
    layers: [
      { key: 'aurora_1', path: 'assets/backgrounds/aurora/1.png', width: 576, height: 324, scrollFactor: 0.0 },
      { key: 'aurora_2', path: 'assets/backgrounds/aurora/2.png', width: 576, height: 324, scrollFactor: 0.2 },
      { key: 'aurora_3', path: 'assets/backgrounds/aurora/3.png', width: 576, height: 324, scrollFactor: 0.5 },
    ],
  },
  {
    id: 'cave',
    name: 'Cave',
    layers: [
      { key: 'cave_far', path: 'assets/backgrounds/cave/layer1_far.png', width: 960, height: 480, scrollFactor: 0.0 },
      { key: 'cave_mid', path: 'assets/backgrounds/cave/layer2_mid.png', width: 960, height: 480, scrollFactor: 0.2 },
      { key: 'cave_near', path: 'assets/backgrounds/cave/layer3_near.png', width: 960, height: 480, scrollFactor: 0.5 },
    ],
  },
  {
    id: 'desert',
    name: 'Desert',
    layers: [
      { key: 'desert_far', path: 'assets/backgrounds/desert/far.png', width: 576, height: 324, scrollFactor: 0.0 },
      { key: 'desert_mid', path: 'assets/backgrounds/desert/middle.png', width: 576, height: 324, scrollFactor: 0.2 },
      { key: 'desert_near', path: 'assets/backgrounds/desert/near.png', width: 576, height: 324, scrollFactor: 0.5 },
    ],
  },
];

export function getBackgroundGroup(id: string): BackgroundGroup | undefined {
  return BACKGROUND_GROUPS.find((group) => group.id === id);
}
