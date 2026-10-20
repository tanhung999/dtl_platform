import { RefObject, useLayoutEffect } from 'react';

// Keep the panel inside its modal for focus, but above scrolling/clipping ancestors.
export function usePickerPopover(open: boolean, anchor: RefObject<HTMLElement>, panel: RefObject<HTMLDivElement>, align: 'start' | 'end' = 'start') {
  useLayoutEffect(() => {
    const node = panel.current;
    if (!open || !node || !anchor.current) return;
    node.setAttribute('popover', 'manual');
    node.showPopover();
    const position = () => {
      if (!anchor.current) return;
      const view = window.visualViewport;
      const left = view?.offsetLeft ?? 0, top = view?.offsetTop ?? 0;
      const width = view?.width ?? window.innerWidth, height = view?.height ?? window.innerHeight;
      const box = anchor.current.getBoundingClientRect();
      node.style.maxWidth = `${Math.max(0, width - 16)}px`;
      node.style.maxHeight = `${Math.max(0, height - 16)}px`;
      const size = node.getBoundingClientRect();
      const x = align === 'end' ? box.right - size.width : box.left;
      const below = box.bottom + 6;
      const y = below + size.height <= top + height - 8 ? below : box.top - size.height - 6;
      node.style.left = `${Math.max(left + 8, Math.min(x, left + width - size.width - 8))}px`;
      node.style.top = `${Math.max(top + 8, Math.min(y, top + height - size.height - 8))}px`;
    };
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    window.visualViewport?.addEventListener('resize', position);
    window.visualViewport?.addEventListener('scroll', position);
    return () => {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
      window.visualViewport?.removeEventListener('resize', position);
      window.visualViewport?.removeEventListener('scroll', position);
      node.hidePopover();
    };
  }, [open, anchor, panel, align]);
}
