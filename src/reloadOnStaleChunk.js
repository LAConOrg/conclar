const GUARD_KEY = "conclar-stale-chunk-reload";
const GUARD_WINDOW_MS = 10_000;

/**
 * Recover from a lazily-imported chunk that no longer exists.
 *
 * The Information and Share Link pages are code-split, so they are fetched the
 * first time someone navigates to them - which may be long after the page was
 * loaded. If a deploy has happened in between, that chunk has been renamed:
 * it's gone from the server, and gone from the service worker's cache, which
 * only ever holds the build it was installed with. The import rejects and the
 * route is dead until the user manually refreshes.
 *
 * Vite raises `vite:preloadError` for exactly this case (it wraps both the
 * preload and the import itself), and reloading fixes it - the fresh document
 * is the current build, whose chunks are precached. The cost is losing
 * in-memory state; selections and filters live in localStorage, so in practice
 * that's the scroll position.
 *
 * Guarded against a reload loop. If a reload doesn't fix it - a half-finished
 * deploy, say, where index.html references files that aren't uploaded yet -
 * looping would be far worse than the broken route. One attempt per ten
 * seconds; a genuine second deploy, hours later, still gets its own attempt.
 */
export function reloadOnStaleChunk() {
  if (!import.meta.env.PROD) {
    // In development a failed import means the code is broken, and reloading
    // would just hide the error.
    return;
  }

  window.addEventListener("vite:preloadError", (event) => {
    if (recentlyReloaded()) {
      console.error(
        "Chunk failed to load again after reloading; leaving it alone.",
        event.payload
      );
      return;
    }
    markReloaded();
    window.location.reload();
  });
}

function recentlyReloaded() {
  try {
    const last = Number(window.sessionStorage.getItem(GUARD_KEY));
    return Number.isFinite(last) && Date.now() - last < GUARD_WINDOW_MS;
  } catch {
    // Storage unavailable (some private modes). Reloading once is still the
    // right call; we just can't tell whether we've already tried.
    return false;
  }
}

function markReloaded() {
  try {
    window.sessionStorage.setItem(GUARD_KEY, String(Date.now()));
  } catch {
    // Ignored - see above.
  }
}
