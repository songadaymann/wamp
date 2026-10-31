import { getPlacedObjectLayer, type PlacedObject } from '../../config';

export function getPlacedObjectEditorDepth(placed: PlacedObject): number {
  switch (getPlacedObjectLayer(placed)) {
    case 'background':
      return 5;
    case 'foreground':
      return 60;
    case 'terrain':
    default:
      return 25;
  }
}
