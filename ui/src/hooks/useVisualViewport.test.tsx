// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVisualViewport, type VisualViewportState } from "./useVisualViewport";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let lastState: VisualViewportState | null = null;

function TestHarness() {
  const state = useVisualViewport();
  lastState = state;
  return <div data-testid="viewport-state">{state.isConstrained ? "constrained" : "relaxed"}</div>;
}

describe("useVisualViewport", () => {
  let container: HTMLDivElement;
  let originalVisualViewportDescriptor: PropertyDescriptor | undefined;
  let originalInnerHeight: number;
  let originalInnerWidth: number;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    lastState = null;
    originalVisualViewportDescriptor = Object.getOwnPropertyDescriptor(window, "visualViewport");
    originalInnerHeight = window.innerHeight;
    originalInnerWidth = window.innerWidth;
  });

  afterEach(() => {
    container.remove();
    if (originalVisualViewportDescriptor) {
      Object.defineProperty(window, "visualViewport", originalVisualViewportDescriptor);
    } else {
      Reflect.deleteProperty(window, "visualViewport");
    }
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: originalInnerHeight,
    });
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: originalInnerWidth,
    });
    document.documentElement.style.removeProperty("--visual-viewport-height");
    document.documentElement.style.removeProperty("--keyboard-inset-bottom");
  });

  it("handles environment without visualViewport", () => {
    Reflect.deleteProperty(window, "visualViewport");
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1200 });

    const root = createRoot(container);
    act(() => {
      root.render(<TestHarness />);
    });

    expect(lastState?.height).toBe(800);
    expect(lastState?.width).toBe(1200);
    expect(lastState?.isConstrained).toBe(false);

    act(() => {
      root.unmount();
    });
  });

  it("tracks visualViewport dimensions and updates state on resize", () => {
    const visualViewport = new EventTarget() as EventTarget & {
      height: number;
      width: number;
      offsetTop: number;
      offsetLeft: number;
    };
    visualViewport.height = 1024;
    visualViewport.width = 1366;
    visualViewport.offsetTop = 0;
    visualViewport.offsetLeft = 0;

    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: visualViewport,
    });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 1024 });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1366 });

    const root = createRoot(container);
    act(() => {
      root.render(<TestHarness />);
    });

    expect(lastState?.height).toBe(1024);
    expect(lastState?.width).toBe(1366);
    expect(lastState?.isConstrained).toBe(false);

    // Keyboard opens on iPad: height shrinks to 624
    act(() => {
      visualViewport.height = 624;
      visualViewport.dispatchEvent(new Event("resize"));
    });

    expect(lastState?.height).toBe(624);
    expect(lastState?.isConstrained).toBe(true);
    expect(document.documentElement.style.getPropertyValue("--visual-viewport-height")).toBe("624px");
    expect(document.documentElement.style.getPropertyValue("--keyboard-inset-bottom")).toBe("400px");

    // Keyboard closes: returns to 1024
    act(() => {
      visualViewport.height = 1024;
      visualViewport.dispatchEvent(new Event("resize"));
    });

    expect(lastState?.height).toBe(1024);
    expect(lastState?.isConstrained).toBe(false);
    expect(document.documentElement.style.getPropertyValue("--visual-viewport-height")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--keyboard-inset-bottom")).toBe("");

    act(() => {
      root.unmount();
    });
  });

  it("scrolls active input into view when viewport becomes constrained", async () => {
    const visualViewport = new EventTarget() as EventTarget & {
      height: number;
      width: number;
      offsetTop: number;
      offsetLeft: number;
    };
    visualViewport.height = 1024;
    visualViewport.width = 1366;
    visualViewport.offsetTop = 0;
    visualViewport.offsetLeft = 0;

    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: visualViewport,
    });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 1024 });

    const rafSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 0;
    });

    const input = document.createElement("textarea");
    const scrollIntoViewMock = vi.fn();
    input.scrollIntoView = scrollIntoViewMock;
    document.body.appendChild(input);
    input.focus();

    const root = createRoot(container);
    act(() => {
      root.render(<TestHarness />);
    });

    act(() => {
      visualViewport.height = 600;
      visualViewport.dispatchEvent(new Event("resize"));
    });

    expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });

    rafSpy.mockRestore();
    document.body.removeChild(input);
    act(() => {
      root.unmount();
    });
  });
});
