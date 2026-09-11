import { useEffect, useState } from "react";

export interface VisualViewportState {
  height: number;
  width: number;
  offsetTop: number;
  offsetLeft: number;
  isConstrained: boolean;
}

function readVisualViewportState(): VisualViewportState {
  if (typeof window === "undefined") {
    return {
      height: 0,
      width: 0,
      offsetTop: 0,
      offsetLeft: 0,
      isConstrained: false,
    };
  }

  const vv = window.visualViewport;
  if (!vv) {
    return {
      height: window.innerHeight,
      width: window.innerWidth,
      offsetTop: 0,
      offsetLeft: 0,
      isConstrained: false,
    };
  }

  // A difference > 40px between layout innerHeight and visualViewport height
  // indicates an on-screen software keyboard or accessory bar is active on touch/tablet devices.
  const isConstrained = vv.height < window.innerHeight - 40;

  return {
    height: Math.round(vv.height),
    width: Math.round(vv.width),
    offsetTop: Math.round(vv.offsetTop),
    offsetLeft: Math.round(vv.offsetLeft),
    isConstrained,
  };
}

function syncRootCssVariables(state: VisualViewportState) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (!root) return;

  if (state.isConstrained) {
    root.style.setProperty("--visual-viewport-height", `${state.height}px`);
    const keyboardInset = Math.max(0, window.innerHeight - (state.height + state.offsetTop));
    root.style.setProperty("--keyboard-inset-bottom", `${keyboardInset}px`);
  } else {
    root.style.removeProperty("--visual-viewport-height");
    root.style.removeProperty("--keyboard-inset-bottom");
  }
}

export function useVisualViewport(): VisualViewportState {
  const [state, setState] = useState<VisualViewportState>(() => {
    const initial = readVisualViewportState();
    syncRootCssVariables(initial);
    return initial;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const vv = window.visualViewport;

    const updateState = () => {
      const next = readVisualViewportState();
      syncRootCssVariables(next);
      setState(next);

      if (next.isConstrained) {
        const active = document.activeElement;
        if (
          active instanceof HTMLElement &&
          (active.tagName === "INPUT" ||
            active.tagName === "TEXTAREA" ||
            active.isContentEditable ||
            Boolean(active.closest("[contenteditable='true']")))
        ) {
          window.requestAnimationFrame(() => {
            active.scrollIntoView({ block: "nearest", inline: "nearest" });
          });
        }
      }
    };

    updateState();

    if (vv) {
      vv.addEventListener("resize", updateState);
      vv.addEventListener("scroll", updateState);
    }
    window.addEventListener("resize", updateState);

    return () => {
      if (vv) {
        vv.removeEventListener("resize", updateState);
        vv.removeEventListener("scroll", updateState);
      }
      window.removeEventListener("resize", updateState);

      if (typeof document !== "undefined" && document.documentElement) {
        document.documentElement.style.removeProperty("--visual-viewport-height");
        document.documentElement.style.removeProperty("--keyboard-inset-bottom");
      }
    };
  }, []);

  return state;
}
