/** Forward reach follows the feet, independently of the movement body's profile. */
export function createForwardSwordAttackRect(input: {
  centerX: number;
  feetY: number;
  facing: -1 | 1;
  standingHeight: number;
}) {
  return {
    x: input.centerX + input.facing * 8 - 14,
    y: input.feetY - input.standingHeight,
    width: 28,
    height: input.standingHeight + 4,
  };
}
