import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { clearMocks } from "@tauri-apps/api/mocks";
import { toast } from "@/features/toast/toast";

// jsdom lacks these browser APIs; cmdk and Radix call them.
if (!("ResizeObserver" in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (!("scrollIntoView" in Element.prototype)) {
  Object.defineProperty(Element.prototype, "scrollIntoView", { value: () => undefined });
}

// jsdom lays nothing out, so every element is 0x0. The account list's
// scroll area gets a window-sized box, or the virtualized list would render
// no rows at all.
for (const [prop, size] of [
  ["offsetHeight", 720],
  ["offsetWidth", 1024],
  ["clientWidth", 1024],
] as const) {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop) ?? Object.getOwnPropertyDescriptor(Element.prototype, prop);
  Object.defineProperty(HTMLElement.prototype, prop, {
    configurable: true,
    get(this: HTMLElement) {
      if (this.hasAttribute("data-list-scroll")) return size;
      return (original?.get?.call(this) as number | undefined) ?? 0;
    },
  });
}

// The router restores scroll position on navigation, and the account list
// scrolls back to the top when a view opens; jsdom implements neither.
window.scrollTo = () => undefined;
Element.prototype.scrollTo = () => undefined;

afterEach(() => {
  cleanup();
  clearMocks();
  toast.reset();
});
