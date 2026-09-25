/**
 * The one DOM helper every panel builds with.
 *
 * Plain DOM rather than a framework — the whole UI is a few hundred nodes and
 * the render loop already owns the frame budget, so per-frame updates in the
 * panels are hand-written and touch only the text that actually changed.
 */

export const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className !== undefined && className !== '') {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
};
