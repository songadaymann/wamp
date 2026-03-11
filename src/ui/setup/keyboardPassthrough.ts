export function setupKeyboardShortcutPassthrough(doc: Document = document): void {
  doc.getElementById('sidebar')?.addEventListener('mousedown', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const interactiveControl = target?.closest('button, input, select, textarea, label, a');
    if (!interactiveControl) {
      event.preventDefault();
    }
  });
}
