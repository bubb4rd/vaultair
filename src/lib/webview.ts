/**
 * Reloads the webview. Used on lock: a reload throws away the whole JS heap,
 * including any value that was on screen or in a query cache.
 * In its own module so tests can replace it (jsdom can't reload).
 */
export function reloadWebview(): void {
  window.location.reload();
}
