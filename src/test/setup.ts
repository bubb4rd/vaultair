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

// The router restores scroll position on navigation; jsdom does not implement it.
window.scrollTo = () => undefined;

afterEach(() => {
  cleanup();
  clearMocks();
  toast.reset();
});
