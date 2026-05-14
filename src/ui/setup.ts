import Phaser from 'phaser';
import { loadCustomSpritesFromStorage } from '../customSprites/registry';
import { initializeDeviceLayout } from './deviceLayout';
import { setupUiControllers } from './setup/controllers';

export function setupUI(game: Phaser.Game): void {
  initializeDeviceLayout();
  loadCustomSpritesFromStorage();
  setupUiControllers(game);
}
