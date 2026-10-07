/**
 * Copying a shown secret by hand (select it, Ctrl+C or Ctrl+X) would go
 * through the webview's own clipboard: recorded in clipboard history, synced
 * to the cloud clipboard, never cleared. This sends it down the same path as
 * the Copy button instead: Rust writes the value, keeps it out of history
 * and clears it.
 *
 * One listener on the document covers every guarded value, so a selection
 * that starts outside a secret and runs into it is caught too.
 */
import { useEffect, useRef, type RefObject } from "react";
import { toast } from "@/features/toast/toast";
import { CLIPBOARD_TOAST_ID } from "./copy";

const guarded = new Map<Element, () => void>();
let listening = false;

/** Whether any part of `element`'s text is inside the selection. */
function touches(selection: Selection, element: Element): boolean {
  const content = document.createRange();
  content.selectNodeContents(element);
  for (let i = 0; i < selection.rangeCount; i += 1) {
    const range = selection.getRangeAt(i);
    // The selection ends after the element starts, and starts before it ends.
    if (
      range.compareBoundaryPoints(Range.START_TO_END, content) > 0 &&
      range.compareBoundaryPoints(Range.END_TO_START, content) < 0
    ) {
      return true;
    }
  }
  return false;
}

function onCopyOrCut(event: ClipboardEvent) {
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed) return;
  const hits = [...guarded].filter(([element]) => touches(selection, element));
  if (hits.length === 0) return;
  // Whatever happens next, the webview's own copy must not.
  event.preventDefault();

  const [hit] = hits;
  const within =
    hits.length === 1 &&
    hit !== undefined &&
    hit[0].contains(selection.anchorNode) &&
    hit[0].contains(selection.focusNode);
  if (within) {
    // The whole value, as the Copy button would: Rust doesn't take a part of one.
    hit[1]();
    return;
  }
  toast.warning("Nothing was copied", {
    id: CLIPBOARD_TOAST_ID,
    description: "The selection includes a secret. Select only that value, or use its Copy button.",
  });
}

/** Dragging selected text out of the window would carry a shown secret with it. */
function onDragStart(event: DragEvent) {
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed) return;
  if ([...guarded.keys()].some((element) => touches(selection, element))) event.preventDefault();
}

/**
 * While `copy` is set, a hand copy or cut of the text in `ref` runs it
 * instead of reaching the clipboard directly, and the text can't be dragged
 * out of the window. Pass `null` while the value is masked: there is nothing
 * to protect, and dots shouldn't copy a secret.
 *
 * A backstop: shown secrets are `user-select: none` (globals.css), so a
 * selection isn't expected to reach one in the app.
 */
export function useProtectedCopy(ref: RefObject<Element | null>, copy: (() => void) | null) {
  const latest = useRef(copy);
  useEffect(() => {
    latest.current = copy;
  });
  const active = copy !== null;
  useEffect(() => {
    const element = ref.current;
    if (!element || !active) return;
    guarded.set(element, () => latest.current?.());
    if (!listening) {
      document.addEventListener("copy", onCopyOrCut, true);
      document.addEventListener("cut", onCopyOrCut, true);
      document.addEventListener("dragstart", onDragStart, true);
      listening = true;
    }
    return () => {
      guarded.delete(element);
    };
  }, [ref, active]);
}
