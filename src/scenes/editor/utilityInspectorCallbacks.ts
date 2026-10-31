interface UtilityInspectorTarget {
  setFocusedBallGraphic(graphicId: string): void;
  setFocusedBallWeight(weight: number): void;
  setFocusedBallHurtEnemies(enabled: boolean): void;
  setFocusedBallHurtFriendlies(enabled: boolean): void;
  setFocusedBallHurtPlayer(enabled: boolean): void;
  setFocusedBallPushable(enabled: boolean): void;
  setFocusedTriangleFill(color: string): void;
  setFocusedTriangleStroke(color: string): void;
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
    onSetFocusedTriangleStroke: (color: string) => inspector.setFocusedTriangleStroke(color),
    onSetTriangleOrientation: (flipX: boolean, flipY: boolean) => inspector.setTriangleOrientation(flipX, flipY),
  };
}
