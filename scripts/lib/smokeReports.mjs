/** Only the actual terminal failure can match an acknowledged product regression. */
export function classifySmokeResult(code, timedOut, output, knownIssue) {
  if (timedOut) return 'timeout';
  if (code === 0) return knownIssue ? 'fixed' : 'pass';
  const terminalError = output.match(/^(?:AssertionError(?: \[.*?\])?|Error|\w*Error):[^\n]*/gm)?.at(-1) ?? '';
  return code === 1 && knownIssue && terminalError.includes(knownIssue.match) ? 'known' : 'fail';
}
