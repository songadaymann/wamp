import type { LayerName } from '../../config/room';
import {
  applyRegisteredSmartBrushCells,
  applyRegisteredSmartBrushOutlineCells,
  constrainRegisteredSmartBrushStroke,
  getRegisteredSmartBrushRectangleCells,
  getRegisteredSmartRecipeOwnerId,
  getRegisteredSmartSemanticOwnerId,
  isRegisteredSmartRecipeBrush,
} from '../../autotiling/brushEngine';
import {
  smartOwnedOutputPartKey,
  smartSemanticCellKey,
  SmartBrushId,
  SmartCellCoordinate,
  SmartStyleId,
} from '../../autotiling/model';
import { getSmartBrushDefinition } from '../../autotiling/registry';
import {
  setSmartTerrainDetailsEnabled,
  type SmartTerrainDocument,
} from '../../autotiling/solver';
import type { ClipboardSmartPastePlan } from './clipboard';

export interface SmartTileEditorSelection {
  brushId: SmartBrushId;
  styleId: SmartStyleId;
  /** Undefined keeps Beginner mode on the brush's authored default layer. */
  sourceLayer?: LayerName;
}

export interface NormalizedSmartStroke {
  cell: SmartCellCoordinate;
  anchor: SmartCellCoordinate | null;
}

/**
 * Editor-facing Smart Tile boundary. It owns selection-aware solver routing and
 * gesture normalization while leaving Phaser layer mutation to EditRuntime.
 */
export class SmartTileController {
  constructor(private readonly getSelection: () => SmartTileEditorSelection) {}

  applyCells(
    document: SmartTerrainDocument,
    cells: Iterable<SmartCellCoordinate>,
    mode: 'paint' | 'erase',
  ): SmartTerrainDocument {
    const selection = this.getSelection();
    return applyRegisteredSmartBrushCells(document, {
      cells,
      mode,
      brushId: selection.brushId,
      styleId: selection.styleId,
      layer: selection.sourceLayer,
    });
  }

  applyOutlineCells(
    document: SmartTerrainDocument,
    filledCells: Iterable<SmartCellCoordinate>,
    outlineCells: Iterable<SmartCellCoordinate>,
  ): SmartTerrainDocument {
    const selection = this.getSelection();
    return applyRegisteredSmartBrushOutlineCells(document, {
      filledCells,
      outlineCells,
      brushId: selection.brushId,
      styleId: selection.styleId,
      layer: selection.sourceLayer,
    });
  }

  normalizeStrokeCell(
    cell: SmartCellCoordinate,
    currentAnchor: SmartCellCoordinate | null,
  ): NormalizedSmartStroke {
    const { brushId } = this.getSelection();
    const { strokeAxis } = getSmartBrushDefinition(brushId);
    if (strokeAxis === 'free') return { cell, anchor: null };
    const anchor = currentAnchor ?? cell;
    return {
      cell: constrainRegisteredSmartBrushStroke(brushId, cell, anchor),
      anchor,
    };
  }

  getRectangleCells(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ): SmartCellCoordinate[] | null {
    return getRegisteredSmartBrushRectangleCells(
      this.getSelection().brushId,
      x1,
      y1,
      x2,
      y2,
    );
  }

  applyClipboardPlan(
    document: SmartTerrainDocument,
    plan: ClipboardSmartPastePlan,
  ): SmartTerrainDocument {
    let next = document;
    const semanticGroups = new Map<
      string,
      {
        brushId: SmartBrushId;
        styleId: SmartStyleId;
        layer: LayerName;
        cells: SmartCellCoordinate[];
      }
    >();
    for (const semantic of plan.semanticCells) {
      const groupKey = `${semantic.layer}:${semantic.cell.brushId}:${semantic.cell.styleId}`;
      const group = semanticGroups.get(groupKey) ?? {
        brushId: semantic.cell.brushId,
        styleId: semantic.cell.styleId,
        layer: semantic.layer,
        cells: [],
      };
      group.cells.push({ x: semantic.x, y: semantic.y });
      semanticGroups.set(groupKey, group);
    }
    for (const group of semanticGroups.values()) {
      next = applyRegisteredSmartBrushCells(next, {
        ...group,
        mode: 'paint',
      });
    }

    for (const semantic of plan.semanticCells) {
      const semanticKey = smartSemanticCellKey(semantic.layer, semantic.x, semantic.y);
      const target = next.smartTerrain.semanticCells[semanticKey];
      if (!target) continue;
      next.smartTerrain.semanticCells[semanticKey] = { ...semantic.cell };
      const ownerId = getRegisteredSmartSemanticOwnerId(semantic.cell.brushId, semanticKey);
      next.smartTerrain.suppressedOutputParts.push(
        ...semantic.suppressedPartIds.map((partId) => smartOwnedOutputPartKey(ownerId, partId)),
      );
    }

    for (const clipboardRecipe of plan.recipes) {
      if (!isRegisteredSmartRecipeBrush(clipboardRecipe.recipe.brushId)) continue;
      let instanceId = clipboardRecipe.sourceInstanceId;
      if (next.smartTerrain.recipes[instanceId]) {
        const baseId = `${instanceId}-copy`;
        instanceId = baseId;
        let suffix = 2;
        while (next.smartTerrain.recipes[instanceId]) {
          instanceId = `${baseId}-${suffix}`;
          suffix += 1;
        }
      }
      const recipe = {
        ...clipboardRecipe.recipe,
        ownerId: getRegisteredSmartRecipeOwnerId(
          clipboardRecipe.recipe.brushId,
          instanceId,
        ),
      };
      next.smartTerrain.recipes[instanceId] = recipe;
      next.smartTerrain.suppressedOutputParts.push(
        ...clipboardRecipe.suppressedPartIds.map(
          (partId) => smartOwnedOutputPartKey(recipe.ownerId, partId),
        ),
      );
    }

    next.smartTerrain.suppressedOutputParts = Array.from(
      new Set(next.smartTerrain.suppressedOutputParts),
    );
    return setSmartTerrainDetailsEnabled(next, next.smartTerrain.detailsEnabled);
  }
}
