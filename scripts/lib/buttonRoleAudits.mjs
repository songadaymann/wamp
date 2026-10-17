import assert from 'node:assert/strict';

const backgrounds = { play: 'rgb(39, 123, 48)', build: 'rgb(252, 234, 124)', curate: 'rgb(121, 204, 222)', neutral: 'rgb(255, 244, 223)', danger: 'rgb(237, 95, 75)' };
function luminance(color) {
  const rgb = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}

/** Inspect the real enabled/disabled controls; do not submit Publish, Log out or destructive actions. */
export async function auditButtonRoles(page, phase) {
  await page.waitForTimeout(150); // Let the existing 100ms color transition finish after Play/Stop.
  const states = await page.locator('[data-button-variant]').evaluateAll(nodes => nodes.filter(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden').map(e => {
    const css = getComputedStyle(e), r = e.getBoundingClientRect();
    const label = e.matches('[data-editor-shell-action]') ? e.lastElementChild : e;
    const l = label?.getBoundingClientRect();
    const tapsClear = !e.matches('[data-editor-shell-action]') || [[0.5,0.5],[0,0],[1,0],[0,1],[1,1]].every(([x,y]) => e.contains(document.elementFromPoint(r.left + 3 + x * (r.width - 6), r.top + 3 + y * (r.height - 6))));
    return { id: e.id || e.dataset.editorShellAction, text: e.textContent?.trim(), role: e.dataset.buttonVariant, disabled: e.disabled || e.getAttribute('aria-disabled') === 'true', background: css.backgroundColor, color: css.color, opacity: css.opacity, radius: css.borderRadius, height: r.height, right: r.right, x: r.x, viewport: innerWidth, primary: e.dataset.buttonSize === 'lg', tapsClear, labelFits: !l || l.left >= r.left - 1 && l.right <= r.right + 1 && label.scrollWidth <= r.width + 1 };
  }));
  assert(states.length, `No action buttons visible during ${phase}`);
  const expectedRoles = { 'btn-world-play': phase === 'editor-test' ? 'neutral' : phase === 'play' ? 'danger' : 'play', 'btn-world-build': 'build', 'btn-world-edit': 'build', 'btn-world-course-builder': 'build', 'btn-world-comment': 'curate', 'btn-world-room-comment': 'curate', 'btn-room-sequence-comment': 'curate', 'btn-world-leaderboard': 'curate', 'btn-world-restart': 'play', 'btn-mobile-world-restart': 'play', 'btn-mobile-world-stop': phase === 'editor-test' ? 'neutral' : 'danger', back: 'neutral', share: 'curate', save: 'build', test: 'play', publish: 'play', 'btn-course-workbench-publish': 'play', 'btn-course-workbench-test': 'play', 'btn-course-workbench-save': 'build', 'btn-course-workbench-edit-course': 'build', 'btn-course-workbench-open-room': 'build', 'btn-course-workbench-unpublish': 'danger', 'btn-course-workbench-back-world': 'neutral' };
  for (const state of states) {
    if (expectedRoles[state.id]) assert.equal(state.role, expectedRoles[state.id], `${phase}/${state.id}: action meaning`);
    assert(state.x >= -1 && state.right <= state.viewport + 1, `${phase}: action outside viewport ${JSON.stringify(state)}`);
    assert.equal(state.radius, '0px', `${phase}/${state.id}: square action corners`);
    assert.equal(state.opacity, '1', `${phase}/${state.id}: opaque action state`);
    assert(state.tapsClear, `${phase}/${state.id}: another control covers the action`);
    assert(state.labelFits, `${phase}/${state.id}: clipped action label ${JSON.stringify(state)}`);
    if (state.disabled) {
      assert.equal(state.background, 'rgb(210, 202, 186)', `${phase}/${state.id}: quiet disabled action`);
      continue;
    }
    assert.equal(state.background, backgrounds[state.role], `${phase}/${state.id}: ${state.role} action color`);
    const a = luminance(state.background), b = luminance(state.color);
    assert((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5, `${phase}/${state.id}: readable action text`);
    if (state.primary) assert(state.height >= 44, `${phase}/${state.id}: primary action target`);
  }
  const required = phase === 'workbench' ? ['btn-course-workbench-publish', 'btn-course-workbench-test', 'btn-course-workbench-back-world'] : phase === 'build' ? ['btn-world-build'] : phase === 'browse' ? ['btn-world-play'] : phase === 'editor' ? ['test', 'publish'] : [];
  for (const id of required) assert(states.some(s => s.id === id), `${phase}: ${id} stays reachable`);
  return states;
}
