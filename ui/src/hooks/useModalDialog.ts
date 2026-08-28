import { useCallback, useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Dialog semantics for the app's overlays: focus moves in on open, Tab is
 * trapped inside, and focus returns to whatever opened it on close.
 *
 * Escape is deliberately NOT handled here -- App owns the modal keyboard so
 * that one guard decides what the cull keys do while something is open.
 */
export function useModalDialog<T extends HTMLElement = HTMLDivElement>(options?: {
  labelledBy?: string;
  label?: string;
}) {
  const ref = useRef<T>(null);
  const restoreTo = useRef<Element | null>(null);

  useEffect(() => {
    restoreTo.current = document.activeElement;
    const el = ref.current;
    if (el) {
      const first = el.querySelector<HTMLElement>(FOCUSABLE);
      // Focus the panel itself when it holds nothing focusable, so the reader
      // lands inside the dialog rather than back on the page behind it.
      (first ?? el).focus({ preventScroll: true });
    }
    return () => {
      const back = restoreTo.current;
      if (back instanceof HTMLElement && document.contains(back)) {
        back.focus({ preventScroll: true });
      }
    };
  }, []);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const el = ref.current;
    if (!el) return;
    const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (n) => n.offsetParent !== null || n === document.activeElement,
    );
    if (!items.length) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === el)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  return {
    ref,
    /** Spread onto the dialog panel element. */
    dialogProps: {
      ref,
      role: "dialog" as const,
      "aria-modal": true,
      "aria-labelledby": options?.labelledBy,
      "aria-label": options?.label,
      tabIndex: -1,
      onKeyDown,
    },
  };
}
