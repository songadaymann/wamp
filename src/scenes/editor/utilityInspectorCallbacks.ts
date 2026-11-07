interface UtilityInspectorTarget {
  setFocusedBallGraphic(graphicId: string): void;
  setFocusedBallWeight(weight: number): void;
  setFocusedBallHurtEnemies(enabled: boolean): void;
  setFocusedBallHurtFriendlies(enabled: boolean): void;
  setFocusedBallHurtPlayer(enabled: boolean): void;
  setFocusedBallPushable(enabled: boolean): void;
  setFocusedTriangleFill(color: string): void;
  setFocusedTriangleTileFill(enabled: boolean): void;
  setFocusedTriangleSlopeOnly(enabled: boolean): void;
  setFocusedTriangleStroke(color: string): void;
  setFocusedTriangleStrokeEnabled(enabled: boolean): void;
  setFocusedTriangleBackgroundEnabled(enabled: boolean): void;
  setTriangleOrientation(flipX: boolean, flipY: boolean): void;
}

export function utilityInspectorCallbacks(inspector: UtilityInspectorTarget) {
  return {
    onSetFocusedBallGraphic: (graphicId: string) => inspector.setFocusedBallGraphic(graphicId),
    onSetFocusedBallWeight: (weight: number) => inspector.setFocusedBallWeight(weight),
    onSetFocusedBallHurtEnemies: (enabled: boolean) => inspector.setFocusedBallHurtEnemies(enabled),
    onSetFocusedBallHurtFriendlies: (enabled: boolean) => inspector.setFocusedBallHurtFriendlies(enabled),
    onSetFocusedBallHurtPlayer: (enabled: boolean) => inspector.setFocusedBallHurtPlayer(enabled),
    onSetFocusedBallPushable: (enabled: boolean) => inspector.setFocusedBallPushable(enabled),
    onSetFocusedTriangleFill: (color: string) => inspector.setFocusedTriangleFill(color),
    onSetFocusedTriangleTileFill: (enabled: boolean) => inspector.setFocusedTriangleTileFill(enabled),
    onSetFocusedTriangleSlopeOnly: (enabled: boolean) => inspector.setFocusedTriangleSlopeOnly(enabled),
    onSetFocusedTriangleStroke: (color: string) => inspector.setFocusedTriangleStroke(color),
    onSetFocusedTriangleStrokeEnabled: (enabled: boolean) => inspector.setFocusedTriangleStrokeEnabled(enabled),
    onSetFocusedTriangleBackgroundEnabled: (enabled: boolean) => inspector.setFocusedTriangleBackgroundEnabled(enabled),
    onSetTriangleOrientation: (flipX: boolean, flipY: boolean) => inspector.setTriangleOrientation(flipX, flipY),
  };
}
