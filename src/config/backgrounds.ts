// ══════════════════════════════════════
// BACKGROUNDS (parallax layer groups)
// ══════════════════════════════════════

export interface BackgroundLayer {
  key: string;           // Phaser texture key
  path: string;          // asset path
  width: number;
  height: number;
  scrollFactor: number;  // 0 = fixed, 0.1-0.9 = parallax, 1.0 = moves with world
  repeat?: boolean;      // false = scale once to the room instead of tiling
}

export interface BackgroundGroup {
  id: string;
  name: string;
  bgColor?: string;    // Solid color behind all layers (hex, e.g. '#87CEEB')
  layers: BackgroundLayer[];
}

export const BACKGROUND_GROUPS: BackgroundGroup[] = [
  { id: 'none', name: 'None', layers: [] },
  {
    id: 'forest',
    name: 'Forest',
    layers: [
      { key: 'forest_1',  path: 'assets/backgrounds/forest/1.png',  width: 576, height: 324, scrollFactor: 0.0 },
      { key: 'forest_2',  path: 'assets/backgrounds/forest/2.png',  width: 576, height: 324, scrollFactor: 0.05 },
      { key: 'forest_3',  path: 'assets/backgrounds/forest/3.png',  width: 576, height: 324, scrollFactor: 0.1 },
      { key: 'forest_5',  path: 'assets/backgrounds/forest/5.png',  width: 576, height: 324, scrollFactor: 0.2 },
      { key: 'forest_6',  path: 'assets/backgrounds/forest/6.png',  width: 576, height: 324, scrollFactor: 0.3 },
      { key: 'forest_10', path: 'assets/backgrounds/forest/10.png', width: 576, height: 324, scrollFactor: 0.4 },
      { key: 'forest_7',  path: 'assets/backgrounds/forest/7.png',  width: 576, height: 324, scrollFactor: 0.5 },
      { key: 'forest_8',  path: 'assets/backgrounds/forest/8.png',  width: 576, height: 324, scrollFactor: 0.6 },
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
    id: 'jungle_vines',
    name: 'Jungle Vines',
    bgColor: '#d2f7bb',
    layers: [
      { key: 'jungle_vines_0', path: 'assets/backgrounds/jungle_vines/layer_0.png', width: 384, height: 176, scrollFactor: 0.0 },
      { key: 'jungle_vines_1', path: 'assets/backgrounds/jungle_vines/layer_1.png', width: 384, height: 176, scrollFactor: 0.08 },
      { key: 'jungle_vines_2', path: 'assets/backgrounds/jungle_vines/layer_2.png', width: 384, height: 176, scrollFactor: 0.16 },
      { key: 'jungle_vines_3', path: 'assets/backgrounds/jungle_vines/layer_3.png', width: 384, height: 176, scrollFactor: 0.28 },
      { key: 'jungle_vines_4', path: 'assets/backgrounds/jungle_vines/layer_4.png', width: 384, height: 176, scrollFactor: 0.42 },
      { key: 'jungle_vines_5', path: 'assets/backgrounds/jungle_vines/layer_5.png', width: 384, height: 176, scrollFactor: 0.6 },
    ],
  },
  {
    id: 'spooky_moon',
    name: 'Spooky Moon',
    layers: [
      { key: 'spooky_moon_sky', path: 'assets/backgrounds/spooky_moon/sky.png', width: 320, height: 180, scrollFactor: 0.0 },
      { key: 'spooky_moon_moon', path: 'assets/backgrounds/spooky_moon/moon.png', width: 320, height: 180, scrollFactor: 0.03 },
      { key: 'spooky_moon_cloud_1', path: 'assets/backgrounds/spooky_moon/cloud_1.png', width: 320, height: 180, scrollFactor: 0.08 },
      { key: 'spooky_moon_cloud_2', path: 'assets/backgrounds/spooky_moon/cloud_2.png', width: 320, height: 180, scrollFactor: 0.14 },
      { key: 'spooky_moon_cloud_3', path: 'assets/backgrounds/spooky_moon/cloud_3.png', width: 320, height: 180, scrollFactor: 0.22 },
    ],
  },
  {
    id: 'spooky_mountain',
    name: 'Spooky Mountain',
    layers: [
      { key: 'spooky_mountain_sky', path: 'assets/backgrounds/spooky_mountain/sky.png', width: 320, height: 180, scrollFactor: 0.0 },
      { key: 'spooky_mountain_moon', path: 'assets/backgrounds/spooky_mountain/moon.png', width: 320, height: 180, scrollFactor: 0.03 },
      { key: 'spooky_mountain_cloud_1', path: 'assets/backgrounds/spooky_mountain/cloud_1.png', width: 320, height: 180, scrollFactor: 0.06 },
      { key: 'spooky_mountain_cloud_2', path: 'assets/backgrounds/spooky_mountain/cloud_2.png', width: 320, height: 180, scrollFactor: 0.1 },
      { key: 'spooky_mountain_cloud_3', path: 'assets/backgrounds/spooky_mountain/cloud_3.png', width: 320, height: 180, scrollFactor: 0.16 },
      { key: 'spooky_mountain_far', path: 'assets/backgrounds/spooky_mountain/mountain_far.png', width: 320, height: 180, scrollFactor: 0.32 },
      { key: 'spooky_mountain_near', path: 'assets/backgrounds/spooky_mountain/mountain_near.png', width: 320, height: 180, scrollFactor: 0.5 },
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
      { key: 'cave_far',  path: 'assets/backgrounds/cave/layer1_far.png',  width: 960, height: 480, scrollFactor: 0.0 },
      { key: 'cave_mid',  path: 'assets/backgrounds/cave/layer2_mid.png',  width: 960, height: 480, scrollFactor: 0.2 },
      { key: 'cave_near', path: 'assets/backgrounds/cave/layer3_near.png', width: 960, height: 480, scrollFactor: 0.5 },
    ],
  },
  {
    id: 'desert',
    name: 'Desert',
    layers: [
      { key: 'desert_far', path: 'assets/backgrounds/desert/far.png', width: 576, height: 324, scrollFactor: 0.0, repeat: false },
      { key: 'desert_mid', path: 'assets/backgrounds/desert/middle.png', width: 576, height: 324, scrollFactor: 0.2, repeat: false },
      { key: 'desert_near', path: 'assets/backgrounds/desert/near.png', width: 576, height: 324, scrollFactor: 0.5, repeat: false },
    ],
  },
];

export function getBackgroundGroup(id: string): BackgroundGroup | undefined {
  return BACKGROUND_GROUPS.find(g => g.id === id);
}
