import Phaser from 'phaser';
import { loadCustomSpritesFromStorage } from '../customSprites/registry';
import { initializeCustomSpriteCatalogSync } from '../customSprites/sync';
import { initializeDeviceLayout } from './deviceLayout';
import { setupUiControllers } from './setup/controllers';

export function setupUI(game: Phaser.Game): void {
  initializeDeviceLayout();
  loadCustomSpritesFromStorage();
  initializeCustomSpriteCatalogSync();
  setupUiControllers(game);
}
