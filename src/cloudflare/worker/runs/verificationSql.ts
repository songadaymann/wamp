export function sqlIsVerificationAccepted(tableName: string): string {
  return `COALESCE(${tableName}.verification_status, 'not_required') IN ('not_required', 'passed')`;
}
