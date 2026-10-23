import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './content-tooltip.css';

export const CONTENT_TOOLTIP_DELAY = 250;

/** One tooltip for item summaries, with a consistent delay independent of the browser. */
export function ContentTooltip() {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const dismiss = useRef<() => void>(() => {});
  const [tip, setTip] = useState<{ text: string; anchor: HTMLElement } | null>(null);
  useEffect(() => {
    let anchor: HTMLElement | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let leaveTimer: ReturnType<typeof setTimeout> | undefined;
    const hide = () => {
      clearTimeout(timer);
      clearTimeout(leaveTimer);
      if (anchor) {
        const descriptions = (anchor.getAttribute('aria-describedby') || '').split(/\s+/).filter(value => value && value !== id);
        if (descriptions.length) anchor.setAttribute('aria-describedby', descriptions.join(' '));
        else anchor.removeAttribute('aria-describedby');
      }
      anchor = null;
      setTip(null);
    };
    dismiss.current = hide;
    const find = (target: EventTarget | null) => target instanceof Element ? target.closest<HTMLElement>('[data-tooltip]') : null;
    const schedule = (element: HTMLElement | null) => {
      clearTimeout(leaveTimer);
      if (element === anchor) return;
      hide();
      if (!element?.dataset.tooltip?.trim()) return;
      anchor = element;
      timer = setTimeout(() => {
        if (!element.isConnected) { hide(); return; }
        const text = element.dataset.tooltip;
        if (!text) { hide(); return; }
        const descriptions = element.getAttribute('aria-describedby');
        element.setAttribute('aria-describedby', [descriptions, id].filter(Boolean).join(' '));
        setTip({ text, anchor: element });
      }, CONTENT_TOOLTIP_DELAY);
    };
    const over = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      if (panel.current?.contains(event.target as Node)) { clearTimeout(leaveTimer); return; }
      schedule(find(event.target));
    };
    const out = (event: PointerEvent) => {
      if (!anchor) return;
      const next = event.relatedTarget as Node | null;
      if (next && (anchor.contains(next) || panel.current?.contains(next))) return;
      if (!panel.current) { hide(); return; }
      leaveTimer = setTimeout(hide, 100);
    };
    const focus = (event: FocusEvent) => {
      const element = find(event.target);
      if (element?.matches(':focus-visible')) schedule(element);
    };
    const blur = (event: FocusEvent) => {
      if (!anchor?.contains(event.relatedTarget as Node | null)) hide();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (panel.current) { event.preventDefault(); event.stopPropagation(); }
      hide();
    };
    const scroll = (event: Event) => { if (!(event.target instanceof Node && panel.current?.contains(event.target))) hide(); };
    document.addEventListener('pointerover', over);
    document.addEventListener('pointerout', out);
    document.addEventListener('focusin', focus);
    document.addEventListener('focusout', blur);
    document.addEventListener('pointerdown', hide);
    document.addEventListener('keydown', key, true);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', hide);
    return () => {
      hide();
      dismiss.current = () => {};
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointerout', out);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('focusout', blur);
      document.removeEventListener('pointerdown', hide);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', hide);
    };
  }, [id]);
  useLayoutEffect(() => {
    const node = panel.current;
    if (!tip || !node) return;
    node.setAttribute('popover', 'manual');
    node.showPopover();
    const anchor = tip.anchor.getBoundingClientRect(), size = node.getBoundingClientRect();
    const below = anchor.bottom + 8;
    node.style.left = `${Math.max(8, Math.min(anchor.left + (anchor.width - size.width) / 2, window.innerWidth - size.width - 8))}px`;
    node.style.top = `${Math.max(8, below + size.height <= window.innerHeight - 8 ? below : anchor.top - size.height - 8)}px`;
    const observer = new MutationObserver(() => {
      if (!tip.anchor.isConnected) { dismiss.current(); return; }
      const text = tip.anchor.dataset.tooltip;
      if (!text?.trim()) dismiss.current();
      else if (text !== tip.text) setTip({ text, anchor: tip.anchor });
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes:true, attributeFilter:['data-tooltip'] });
    return () => { observer.disconnect(); node.hidePopover(); };
  }, [tip]);
  return tip && createPortal(<div ref={panel} id={id} role="tooltip" className="content-tooltip">{tip.text}</div>, document.body);
}
