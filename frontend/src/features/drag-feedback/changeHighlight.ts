export function highlightChange(kind: 'task' | 'event' | 'sort', id: string) {
  const escaped = CSS.escape(id);
  const selector = kind === 'task' ? `[data-task-id="${escaped}"], [data-deadline-id="${escaped}"]` : kind === 'event' ? `button[data-event-id="${escaped}"]` : `[data-sort-id="${escaped}"]`;
  const token = `${Date.now()}:${Math.random()}`;
  const nodes = new Set<Element>();
  const apply = () => document.querySelectorAll(selector).forEach(node => { if (!nodes.has(node)) {
    nodes.add(node); node.setAttribute('data-drag-highlight', token); node.setAttribute('data-drop-flash', token);
    window.setTimeout(() => { if (node.getAttribute('data-drop-flash') === token) node.removeAttribute('data-drop-flash'); }, 500);
  } });
  apply();
  const observer = new MutationObserver(apply);
  observer.observe(document.body, { childList: true, subtree: true });
  window.setTimeout(() => { observer.disconnect(); nodes.forEach(node => { if (node.getAttribute('data-drag-highlight') === token) node.removeAttribute('data-drag-highlight'); }); }, 3000);
}

export function shakeSource(node?: HTMLElement | null) {
  if (node && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) node.animate([{ translate: '0px' }, { translate: '-3px' }, { translate: '3px' }, { translate: '-2px' }, { translate: '0px' }], { duration: 180 });
}
