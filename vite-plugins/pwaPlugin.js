import { VitePWA } from "vite-plugin-pwa";
import { readConfig } from "./readConfig.js";
import { cacheIdPrefix } from "../src/cacheId.js";

/**
 * Offline support: the app shell, and nothing else.
 *
 * Everything the build emits is precached. Everything fetched at runtime
 * (programme data, people data, info.md) is stored in IndexedDB by the app
 * instead - see src/utils/OfflineStore.js - and excluded from the precache.
 *
 * Keeping runtime data out of the service worker is deliberate: model.js
 * decides whether the data it is showing is fresh or stale, and it can only do
 * that if a failed fetch() genuinely means "offline" rather than "quietly
 * answered from a cache you forgot about". That is why `runtimeCaching` below
 * is empty.
 *
 * The new worker takes over immediately (skipWaiting + clientsClaim) but does
 * NOT reload the page, so a tab held open for the whole convention still
 * updates on its next navigation rather than never. A tab that then requests a
 * lazily-imported chunk (Info, ShareLink) renamed by that deploy will fail to
 * import it; src/reloadOnStaleChunk.js recovers from that.
 *
 * `injectRegister: null` - the app registers the worker itself, in
 * src/registerServiceWorker.js, which also tears down leftover workers in
 * development and skips registration when OFFLINE.ENABLED is false.
 *
 * With OFFLINE.ENABLED false the plugin emits a self-destroying sw.js instead:
 * set the flag to false, redeploy, and every browser that has a worker
 * installed picks this up on its next update check, wipes the caches (all of
 * them on the origin, not just this app's), and unregisters. It has to be
 * *deployed*, not merely absent - a missing sw.js would 404 and the existing
 * registration would survive.
 */

/**
 * Normalise a URL from config.json to a path relative to the build output, or
 * null if it can't refer to a file we emit.
 *
 * Config data URLs come in three shapes: absolute ("https://host/data.json"),
 * root-relative ("/data/schedule.json"), and document-relative ("info.md").
 * Only the last two can collide with build output.
 *
 * @param {string} url
 * @param {string} base Vite's resolved base, e.g. "/".
 * @returns {string|null} Posix path relative to outDir.
 */
function configUrlToBuildPath(url, base) {
  if (typeof url !== "string" || url.length === 0) {
    return null;
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url) || url.startsWith("//")) {
    // Served from somewhere else entirely.
    return null;
  }
  let relative = url.split(/[?#]/)[0];
  if (relative.startsWith(base)) {
    relative = relative.slice(base.length);
  }
  relative = relative.replace(/^\.?\//, "");
  return relative.length > 0 ? relative : null;
}

/**
 * Every build path that must stay out of the precache: the runtime-fetched
 * content named in config.json, plus robots.txt.
 *
 * Derived from config rather than hardcoded so that a convention which moves
 * its data files doesn't silently end up precaching them.
 *
 * @param {object} config Parsed config.json.
 * @param {string} base Vite's resolved base.
 * @returns {string[]} Paths, usable as glob patterns.
 */
function runtimeContentPaths(config, base) {
  const urls = [
    config.DATA_URLS?.COMBINED,
    config.DATA_URLS?.SCHEDULE,
    config.DATA_URLS?.PEOPLE,
    config.PROGRAM_DATA_URL,
    config.PEOPLE_DATA_URL,
    config.INFORMATION?.MARKDOWN_URL,
  ];
  const paths = new Set(["robots.txt"]);
  for (const url of urls) {
    const buildPath = configUrlToBuildPath(url, base);
    if (buildPath) {
      paths.add(buildPath);
    }
  }
  return [...paths];
}

/**
 * Build the web app manifest from config.json.
 *
 * @param {object} config Parsed config.json.
 * @returns {object} A web app manifest.
 */
function manifestFromConfig(config) {
  const manifest = config.MANIFEST ?? {};
  return {
    name: config.APP_TITLE,
    short_name: manifest.SHORT_NAME ?? config.APP_TITLE,
    icons: (manifest.ICONS ?? []).map((icon) => ({
      src: icon.SRC,
      sizes: icon.SIZES,
      type: icon.TYPE,
      ...(icon.PURPOSE ? { purpose: icon.PURPOSE } : {}),
    })),
    start_url: ".",
    display: "standalone",
    theme_color: manifest.THEME_COLOR ?? "#000000",
    background_color: manifest.BACKGROUND_COLOR ?? "#ffffff",
  };
}

/**
 * Offline support, via vite-plugin-pwa.
 *
 * @param {string} configPath Absolute path to config.json.
 * @returns {import("vite").PluginOption[]}
 */
export function pwaPlugin(configPath) {
  const config = readConfig(configPath);

  const globIgnores = ["**/node_modules/**/*"];

  const resolveExclusions = {
    name: "pwa-runtime-content-exclusions",
    apply: "build",
    configResolved(resolved) {
      globIgnores.push(...runtimeContentPaths(config, resolved.base || "/"));
    },
  };

  return [
    resolveExclusions,
    VitePWA({
      strategies: "generateSW",
      filename: "sw.js",
      injectRegister: null,
      devOptions: { enabled: false },
      selfDestroying: config.OFFLINE?.ENABLED !== true,
      manifest: manifestFromConfig(config),
      workbox: {
        cacheId: cacheIdPrefix(config.APP_ID),
        globPatterns: ["**/*"],
        globIgnores,
        navigateFallback: "index.html",
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        runtimeCaching: [],
      },
    }),
  ];
}
