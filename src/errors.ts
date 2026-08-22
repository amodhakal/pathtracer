// Issue #39: extracted from main.ts — non-blocking error reporting.
//
// Issue #19: show errors in an on-page overlay (and console.error) instead of
// alert(), which blocks the main thread.
export function reportError(message: string): void {
  console.error(message);
  let overlay = document.getElementById("error-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "error-overlay";
    overlay.setAttribute("role", "alert");
    overlay.style.cssText =
      "position:fixed;top:0;left:0;right:0;z-index:9999;" +
      "background:#c0392b;color:#fff;font:14px/1.4 sans-serif;" +
      "padding:12px 16px;white-space:pre-wrap;";
    document.body.appendChild(overlay);
  }
  overlay.textContent = overlay.textContent ? overlay.textContent + "\n" + message : message;
}
