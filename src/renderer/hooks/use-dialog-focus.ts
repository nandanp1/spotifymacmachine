import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function useDialogFocus<ElementType extends HTMLElement>(
  open: boolean,
  initialFocus?: RefObject<HTMLElement | null>,
) {
  const containerRef = useRef<ElementType>(null);

  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    if (!container) return;

    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const focusFrame = window.requestAnimationFrame(() => {
      const target =
        initialFocus?.current ??
        container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      target?.focus();
    });

    const keepFocusInside = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((element) => !element.hidden && element.offsetParent !== null);
      if (!focusable.length) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    container.addEventListener("keydown", keepFocusInside);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      container.removeEventListener("keydown", keepFocusInside);
      if (previousFocus?.isConnected) {
        previousFocus.focus();
      }
    };
  }, [initialFocus, open]);

  return containerRef;
}
