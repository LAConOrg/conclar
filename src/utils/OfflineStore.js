import configData from "../config.json";
import { cacheIdPrefix } from "../cacheId.js";

/**
 * Persistence for content fetched at runtime: the programme/people payload
 * and the info page markdown.
 *
 * This is deliberately the *only* place runtime content is cached. The
 * service worker handles the app shell and never touches these URLs, so a
 * failed fetch() still means "we genuinely could not reach the server" -
 * which is what lets the app show an honest offline state and an honest
 * "last checked" time. See vite-plugins/pwaPlugin.js.
 *
 * IndexedDB rather than localStorage because the payload is several
 * megabytes, well past localStorage's ~5 MB synchronous budget. Records store
 * the raw response text exactly as the server sent it; the Temporal objects
 * produced by processing it aren't structured-cloneable, and rebuilding them
 * is the expensive part either way.
 *
 * Every operation degrades to null / no-op rather than throwing. If IndexedDB
 * is unavailable (private browsing, quota exhaustion, a browser we've never
 * heard of), the app simply behaves as it did before offline support existed.
 */

const DB_NAME = cacheIdPrefix(configData.APP_ID);
const STORE_NAME = "runtime-content";

export const PROGRAMME_KEY = "programme";
export const INFO_KEY = "info";
// When we last successfully reached the server, kept apart from the payload
// so a check that finds nothing changed doesn't mean rewriting megabytes.
export const LAST_CHECKED_KEY = "last-checked";

// Memoised, including on failure: if the open rejects we keep the rejected
// promise so we don't retry on every call once we know it isn't going to work.
let dbPromise = null;

function openDatabase() {
  if (dbPromise) {
    return dbPromise;
  }
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable"));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("IndexedDB open was blocked"));
  });
  return dbPromise;
}

function runTransaction(mode, operation) {
  return openDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, mode);
        const request = operation(transaction.objectStore(STORE_NAME));
        transaction.onabort = () => reject(transaction.error);
        transaction.oncomplete = () => resolve(request ? request.result : undefined);
        transaction.onerror = () => reject(transaction.error);
      })
  );
}

/**
 * Read a stored record, or null if there isn't a usable one.
 *
 * @param {string} key
 * @param {string[]} sources The URLs the record would have been fetched from.
 *   A record fetched from different URLs (because config.json changed) is
 *   treated as absent rather than misinterpreted.
 * @returns {Promise<object|null>}
 */
export async function readRecord(key, sources) {
  try {
    const record = await runTransaction("readonly", (store) => store.get(key));
    if (!record) {
      return null;
    }
    if (JSON.stringify(record.sources) !== JSON.stringify(sources)) {
      return null;
    }
    return record;
  } catch (error) {
    console.warn("Could not read offline store:", error);
    return null;
  }
}

/**
 * Write a record. Failures are logged and swallowed - not being able to cache
 * for next time is not a reason to fail the fetch that just succeeded.
 *
 * @param {string} key
 * @param {object} record Fields to store alongside the bookkeeping ones.
 * @param {string[]} sources The URLs the content was fetched from.
 * @returns {Promise<void>}
 */
export async function writeRecord(key, record, sources) {
  try {
    await runTransaction("readwrite", (store) => store.put({ ...record, sources }, key));
  } catch (error) {
    console.warn("Could not write to offline store:", error);
  }
}
