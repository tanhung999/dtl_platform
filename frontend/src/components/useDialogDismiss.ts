import { useRef, type MouseEvent, type PointerEvent, type SyntheticEvent } from 'react';

/** Close only a press that starts and ends on the native dialog backdrop. */
export function useDialogDismiss(onClose: () => void, enabled = true) {
  const pressedOutside = useRef(false);
  const outside = (event: MouseEvent<HTMLDialogElement> | PointerEvent<HTMLDialogElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.target === event.currentTarget &&
      (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
  };
  return {
    onPointerDown: (event: PointerEvent<HTMLDialogElement>) => { pressedOutside.current = enabled && event.button === 0 && outside(event); },
    onClick: (event: MouseEvent<HTMLDialogElement>) => {
      const dismiss = pressedOutside.current && enabled && outside(event);
      pressedOutside.current = false;
      if (dismiss) { event.stopPropagation(); onClose(); }
    },
    onCancel: (event: SyntheticEvent<HTMLDialogElement>) => {
      event.preventDefault(); event.stopPropagation();
      if (enabled) onClose();
    },
  };
}
