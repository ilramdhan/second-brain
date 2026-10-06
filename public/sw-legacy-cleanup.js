// Loaded by the Workbox service worker (importScripts). Removes the caches of the hand-written
// worker that shipped before Workbox (`second-brain-shell-v1..v3`); Workbox's own
// cleanupOutdatedCaches only knows about its precache.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("second-brain-shell-"))
            .map((key) => caches.delete(key)),
        ),
      ),
  );
});
