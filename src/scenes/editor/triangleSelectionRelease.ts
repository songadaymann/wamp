import { editorState, subscribeEditorState } from '../../config/editorState';

const listeners = new Set<() => void>();

/** Drop a selected triangle when the editor leaves the tool or mode that was editing it. */
export function requestTriangleDeselect(): void {
  for (const listener of listeners) listener();
}

export function watchTriangleSelectionRelease(release: () => void): () => void {
  let tool = editorState.activeTool;
  let mode = editorState.paletteMode;
  let objectId = editorState.selectedObjectId;
  let layer = editorState.activeLayer;
  const stopState = subscribeEditorState(() => {
    const nextTool = editorState.activeTool;
    const nextMode = editorState.paletteMode;
    const nextObjectId = editorState.selectedObjectId;
    const nextLayer = editorState.activeLayer;
    const releaseForTool = nextTool !== tool && nextTool !== 'triangle';
    const releaseForMode = nextMode !== mode;
    const releaseForObject = nextObjectId !== objectId;
    const releaseForLayer = nextLayer !== layer;
    tool = nextTool;
    mode = nextMode;
    objectId = nextObjectId;
    layer = nextLayer;
    if (releaseForTool || releaseForMode || releaseForObject || releaseForLayer) release();
  });
  listeners.add(release);
  return () => {
    listeners.delete(release);
    stopState();
  };
}
