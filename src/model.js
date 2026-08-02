import { action, thunk, computed } from "easy-peasy";
import { ProgramData } from "./ProgramData";
import { ProgramSelection } from "./ProgramSelection";
import { LocalTime } from "./utils/LocalTime";
import { collectBoundaries } from "./utils/ProgramTime";
import * as SyncService from "./SyncService";
import {
  readRecord,
  writeRecord,
  PROGRAMME_KEY,
  INFO_KEY,
  LAST_CHECKED_KEY,
} from "./utils/OfflineStore";
import configData from "./config.json";

function getSelectedIdsFromStore(selectionStore) {
  return Object.keys(selectionStore).filter(
    (id) => selectionStore[id].selected
  );
}

let pushInFlight = null;
let pushNeeded = false;
const SYNC_WARNING_KEY = "sync_warning_dismissed_" + configData.APP_ID;
let syncWarningShown = !!localStorage.getItem(SYNC_WARNING_KEY);

async function coalescedSync(actions) {
  if (pushInFlight) {
    // A push is already running. Flag that another is needed and wait.
    pushNeeded = true;
    await pushInFlight;
    return;
  }

  async function run() {
    do {
      pushNeeded = false;
      await actions.syncSelections();
    } while (pushNeeded);
  }

  pushInFlight = run();
  try {
    await pushInFlight;
  } finally {
    pushInFlight = null;
  }
}

function updateLocalStore(selectionStore, userId) {
  ProgramSelection.setSelectionStore(
    { version: 2, selections: selectionStore },
    userId
  );
}

const model = {
  isLoading: true,
  program: [],
  people: [],
  locations: [],
  tags: [],
  personTags: [],
  info: "",
  loadError: null,
  // Digest of the last successfully-loaded program/people payload, so
  // fetchProgram can tell ProgramData.fetchData whether a new fetch's
  // contents actually differ - letting it skip reprocessing (and reusing
  // the same array references) for a byte-identical background refresh.
  lastFetchFingerprint: null,
  // When we last reached the server successfully. Restored from the offline
  // store on boot, so it survives a reload with no network, and shown to the
  // user in the offline dialog.
  lastFetchTime: null,
  // When we last *tried*, successful or not. Only used to schedule the next
  // poll - keeping it separate from lastFetchTime stops a failed attempt from
  // leaving the timer permanently overdue and retrying every tick.
  lastAttemptTime: null,
  timeSinceLastAttempt: null,
  // Set when a programme-data fetch fails, cleared when one succeeds. This,
  // not navigator.onLine, is what the offline indicator reflects: it's the
  // only signal that's true on a captive portal or a wifi network with no
  // working uplink.
  dataFetchFailed: false,
  showOfflineDialog: false,
  helpTextDismissed: (() => {
    const dismissed = localStorage.getItem("help_text_dismissed_" + configData.APP_ID);
    return (dismissed) ? JSON.parse(dismissed) : {};
  })(),
  showLocalTime: LocalTime.getStoredLocalTime(),
  show12HourTime: LocalTime.getStoredTwelveHourTime(),
  showTimeZone: LocalTime.getStoredShowTimeZone(),
  useTimeZone: LocalTime.getStoredUseTimeZone(),
  selectedTimeZone: LocalTime.getStoredSelectedTimeZone(),
  showPastItems: LocalTime.getStoredPastItems(),
  expandedItems: [],
  // Whether the most recent change to expandedItems was a bulk action
  // (expand/collapse all or selected); bulk changes snap open/shut instead
  // of animating. Read non-reactively (getState) by items, never subscribed
  // to, so flipping it re-renders nothing itself.
  expandedItemsChangedInBulk: false,
  programDisplayLimit: localStorage.getItem("program_display_limit"),
  selectionStore: ProgramSelection.getSelectionStore().selections,
  mySelections: ProgramSelection.getSelectedIds(),
  currentUserId: null,
  userProfile: null,
  programSelectedLocations: [],
  programSelectedTags: {},
  programHideBefore: "",
  programSearch: "",
  peopleSelectedTags: {},
  peopleSearch: "",
  showThumbnails: localStorage.getItem("thumbnails") === "false" ? false : true,
  sortByFullName: localStorage.getItem("sort_people") === "true" ? true : false,
  onLine: window.navigator.onLine,
  darkMode: localStorage.getItem("dark_mode") ? localStorage.getItem("dark_mode") : 'browser',
  showSyncWarning: false,
  // Thunks

  /**
   * Cache-then-network startup.
   *
   * Start with the offline store the moment it's read, then do a network fetch.
   * This means that on hotel wifi we see the cached schedule instantly, rather
   * than a spinner, but we still fetch to get the latest schedule which will
   * show soon after.
   */
  bootProgram: thunk(async (actions, payload, { getState }) => {
    const sources = ProgramData.dataSources();
    const [cached, lastChecked] = await Promise.all([
      readRecord(PROGRAMME_KEY, sources),
      readRecord(LAST_CHECKED_KEY, sources),
    ]);
    if (cached && getState().program.length === 0) {
      try {
        actions.setData(ProgramData.processRawParts(cached.rawParts));
        actions.setLastFetchFingerprint(cached.fingerprint);
        actions.setLastFetchTime(lastChecked?.checkedAt ?? cached.fetchedAt);
        actions.setIsLoadingFalse();
      } catch (e) {
        // Cached bytes we can't decode are no use; the network fetch below
        // will replace them.
        console.warn("Could not use cached programme data:", e);
      }
    }
    await actions.fetchProgram(true);
  }),

  fetchProgram: thunk(async (actions, firstTime, { getState }) => {
    actions.recordFetchAttempt();
    try {
      // data is null when the fetch came back byte-identical to what's
      // already loaded - nothing to commit, but the fetch itself still
      // succeeded.
      const { fingerprint, data, rawParts } = await ProgramData.fetchData(
        firstTime,
        getState().lastFetchFingerprint
      );
      const checkedAt = new Date().getTime();
      const sources = ProgramData.dataSources();
      if (data) {
        actions.setData(data);
        actions.setLastFetchFingerprint(fingerprint);
        // Not awaited: the user has their data, and whether we manage to
        // stash a copy for next time shouldn't hold up the render.
        writeRecord(PROGRAMME_KEY, { rawParts, fingerprint, fetchedAt: checkedAt }, sources);
      }
      writeRecord(LAST_CHECKED_KEY, { checkedAt }, sources);
      actions.setLoadError(null);
      actions.setDataFetchFailed(false);
      actions.setLastFetchTime(checkedAt);
    } catch (e) {
      console.error("Failed to load program data:", e);
      actions.setDataFetchFailed(true);
      // A failed refresh leaves the already-displayed data in place and just
      // raises the offline indicator. Only when there's nothing at all to
      // show does this become a hard error.
      if (getState().program.length === 0) {
        actions.setLoadError(e.message || String(e));
      }
    } finally {
      actions.setIsLoadingFalse();
    }
  }),

  // Info-page markdown, fetched on first visit. Cached in the offline store
  // alongside the programme data - it's runtime content, so the service
  // worker deliberately doesn't handle it.
  fetchInfo: thunk(async (actions, payload, { getState }) => {
    if (getState().info !== "") {
      return;
    }
    // INFORMATION is optional - without a markdown URL there's no info page
    // to fetch or cache.
    const markdownUrl = configData.INFORMATION?.MARKDOWN_URL;
    if (!markdownUrl) {
      return;
    }
    const sources = [markdownUrl];
    const cached = await readRecord(INFO_KEY, sources);
    if (cached) {
      actions.setInfo(cached.text);
    }
    try {
      const text = await ProgramData.fetchInfo(true);
      actions.setInfo(text);
      writeRecord(INFO_KEY, { text, fetchedAt: new Date().getTime() }, sources);
    } catch (e) {
      console.error("Failed to load info page:", e);
    }
  }),

  // Sync thunks
  fetchProfile: thunk(async (actions) => {
    if (!SyncService.isSyncEnabled()) {
      return;
    }
    try {
      const profile = await SyncService.fetchProfile();
      actions.setUserProfile(profile);
      if (profile.authenticated) {
        const userId = profile.id;
        actions.setCurrentUserId(userId);

        // Migrate anonymous selections into the user-specific store.
        // Only carry over true selections — false values from anonymous browsing
        // should not override the user's actual server state.
        const anonStore = ProgramSelection.getSelectionStore().selections;
        const anonSelections = Object.fromEntries(
          Object.entries(anonStore).filter(([, entry]) => entry.selected)
        );
        const userStore = ProgramSelection.getSelectionStore(userId).selections;
        const merged = SyncService.mergeSelections(anonSelections, userStore);
        actions.setSelectionStore(merged);
        ProgramSelection.clearSelectionStore();

        await actions.syncSelections({ fullSync: true });
      } else {
        actions.setCurrentUserId(null);
        const anonStore = ProgramSelection.getSelectionStore().selections;
        actions.setSelectionStore(anonStore);
      }
    } catch (e) {
      console.warn("Profile fetch failed:", e);
      actions.setUserProfile({ error: true });
    }
  }),

  syncSelections: thunk(async (actions, payload, { getState }) => {
    if (!SyncService.isSyncEnabled()) {
      return;
    }
    const state = getState();
    if (!state.userProfile || !state.userProfile.authenticated) {
      return;
    }
    const fullSync = payload && payload.fullSync;
    try {
      // On full sync (page load), GET and merge everything from the server
      // so the user sees other devices' changes.
      if (fullSync) {
        const serverSelections = await SyncService.fetchSelections();
        if (!serverSelections) {
          return;
        }
        // Start from server state, then layer any unsynced local changes on top.
        const localDirty = SyncService.getDirtySelections(getState().selectionStore);
        const merged = { ...serverSelections, ...localDirty };
        actions.setSelectionStore(merged);
      }

      const localStore = getState().selectionStore;
      const dirty = SyncService.getDirtySelections(localStore);
      const pushResult = await SyncService.pushSelections(dirty);
      if (pushResult.unauthorized) {
        return;
      }
      if (pushResult.selections) {
        const current = getState().selectionStore;
        const updated = { ...current };
        for (const [id, entry] of Object.entries(pushResult.selections)) {
          // Only update entries that haven't changed since the push started.
          if (current[id].selected === dirty[id].selected) {
            updated[id] = entry;
          }
        }
        actions.setSelectionStore(updated);
      }
    } catch (e) {
      console.warn("Selection sync failed:", e);
    }
  }),

  // Actions.
  setIsLoadingFalse: action((state) => (state.isLoading = false)),
  setData: action((state, data) => {
    state.program = data.program;
    state.people = data.people;
    state.locations = data.locations;
    state.tags = data.tags;
    state.personTags = data.personTags;
  }),
  setInfo: action((state, info) => {
    state.info = info;
  }),
  setLastFetchFingerprint: action((state, fingerprint) => {
    state.lastFetchFingerprint = fingerprint;
  }),
  setLoadError: action((state, error) => {
    state.loadError = error;
  }),
  setLastFetchTime: action((state, lastFetchTime) => {
    state.lastFetchTime = lastFetchTime;
  }),
  recordFetchAttempt: action((state) => {
    state.lastAttemptTime = new Date().getTime();
    state.timeSinceLastAttempt = 0;
  }),
  updateTimeSinceLastAttempt: action((state) => {
    if (state.lastAttemptTime === null) {
      return;
    }
    const milisecondsPerSec = 1000;
    state.timeSinceLastAttempt = Math.floor(
      (new Date().getTime() - state.lastAttemptTime) / milisecondsPerSec
    );
  }),
  setDataFetchFailed: action((state, failed) => {
    state.dataFetchFailed = failed;
  }),
  setShowOfflineDialog: action((state, show) => {
    state.showOfflineDialog = show;
  }),
  setHelpTextDismissed: action((state, helpTextDismissed) => {
    state.helpTextDismissed = helpTextDismissed;
    localStorage.setItem("help_text_dismissed_" + configData.APP_ID, JSON.stringify(helpTextDismissed));
  }),
  setShowLocalTime: action((state, showLocalTime) => {
    state.showLocalTime = showLocalTime;
    LocalTime.setStoredLocalTime(showLocalTime);
  }),
  setShow12HourTime: action((state, show12HourTime) => {
    state.show12HourTime = show12HourTime;
    LocalTime.setStoredTwelveHourTime(show12HourTime);
  }),
  setShowTimeZone: action((state, showTimeZone) => {
    state.showTimeZone = showTimeZone;
    LocalTime.setStoredShowTimeZone(showTimeZone);
  }),
  setUseTimeZone: action((state, useTimeZone) => {
    state.useTimeZone = useTimeZone;
    LocalTime.setStoredUseTimeZone(useTimeZone);
  }),
  setSelectedTimeZone: action((state, selectedTimeZone) => {
    state.selectedTimeZone = selectedTimeZone;
    LocalTime.setStoredSelectedTimeZone(selectedTimeZone);
  }),
  setShowPastItems: action((state, showPastItems) => {
    state.showPastItems = showPastItems;
    LocalTime.setStoredPastItems(showPastItems);
  }),
  setShowThumbnails: action((state, showThumbnails) => {
    state.showThumbnails = showThumbnails;
    localStorage.setItem("thumbnails", showThumbnails ? "true" : "false");
  }),
  setSortByFullName: action((state, sortByFullName) => {
    state.sortByFullName = sortByFullName;
    localStorage.setItem("sort_people", sortByFullName ? "true" : "false");
  }),
  setOnLine: thunk(async (actions, onLine, { getState }) => {
    const wasOffline = !getState().onLine;
    actions._setOnLine(onLine);
    if (wasOffline && onLine) {
      // Coming back into signal shouldn't mean waiting out the rest of the
      // 30-minute poll to find out the schedule moved.
      await Promise.all([
        actions.syncSelections({ fullSync: true }),
        actions.fetchProgram(false),
      ]);
    }
  }),
  _setOnLine: action((state, onLine) => {
    state.onLine = onLine;
  }),
  setDarkMode: action((state, darkMode) => {
    state.darkMode = darkMode;
    localStorage.setItem("dark_mode", darkMode);
  }),

  // Actions for expanding program items.
  expandItem: action((state, id) => {
    state.expandedItems.push(id);
    state.expandedItemsChangedInBulk = false;
  }),
  collapseItem: action((state, id) => {
    state.expandedItems = state.expandedItems.filter((item) => item !== id);
    state.expandedItemsChangedInBulk = false;
  }),
  expandAll: action((state) => {
    state.expandedItems = state.program.map((item) => item.id);
    state.expandedItemsChangedInBulk = true;
  }),
  collapseAll: action((state) => {
    state.expandedItems = [];
    state.expandedItemsChangedInBulk = true;
  }),
  expandSelected: action((state) => {
    state.expandedItems = [...state.mySelections];
    state.expandedItemsChangedInBulk = true;
  }),
  collapseSelected: action((state) => {
    state.expandedItems = [];
    state.expandedItemsChangedInBulk = true;
  }),

  // Action for number of items displayed.
  setProgramDisplayLimit: action((state, limit) => {
    if (limit === "all" || !isNaN(limit)) {
      localStorage.setItem("program_display_limit", limit);
      state.programDisplayLimit = limit;
    }
  }),

  // Actions for filtering program and people.
  setProgramSelectedLocations: action((state, selectedLocations) => {
    state.programSelectedLocations = selectedLocations;
  }),
  setProgramSelectedTags: action((state, selectedTags) => {
    state.programSelectedTags = selectedTags;
  }),
  setProgramHideBefore: action((state, hideBefore) => {
    state.programHideBefore = hideBefore;
  }),
  setProgramSearch: action((state, search) => {
    state.programSearch = search;
  }),
  resetProgramFilters: action((state) => {
    state.programSelectedLocations = [];
    const newTags = {};
    for (const tag in state.programSelectedTags) {
      newTags[tag] = [];
    }
    state.programSelectedTags = newTags;
    state.programHideBefore = "";
    state.programSearch = "";
  }),
  setPeopleSelectedTags: action((state, selectedTags) => {
    state.peopleSelectedTags = selectedTags;
  }),
  setPeopleSearch: action((state, search) => {
    state.peopleSearch = search;
  }),
  resetPeopleFilters: action((state) => {
    const newTags = {};
    for (const tag in state.peopleSelectedTags) {
      newTags[tag] = [];
    }
    state.peopleSelectedTags = newTags;
    state.peopleSearch = "";
  }),

  // Actions for selected items.
  setSelectionStore: action((state, selections) => {
    state.selectionStore = selections;
    state.mySelections = getSelectedIdsFromStore(selections);
    updateLocalStore(selections, state.currentUserId);
  }),
  setCurrentUserId: action((state, userId) => {
    state.currentUserId = userId;
  }),
  setUserProfile: action((state, profile) => {
    state.userProfile = profile;
  }),
  setSelection: action((state, selection) => {
    state.mySelections = selection;
  }),
  addSelection: action((state, id) => {
    if (!state.mySelections.includes(id)) {
      state.mySelections.push(id);
    }
    state.selectionStore[id] = { selected: true, dirty: true };
    updateLocalStore(state.selectionStore, state.currentUserId);
  }),
  removeSelection: action((state, id) => {
    state.mySelections = state.mySelections.filter(
      (selection) => selection !== id
    );
    state.selectionStore[id] = { selected: false, dirty: true };
    updateLocalStore(state.selectionStore, state.currentUserId);
  }),

  setShowSyncWarning: action((state, show) => {
    state.showSyncWarning = show;
    if (!show) {
      localStorage.setItem(SYNC_WARNING_KEY, "true");
      syncWarningShown = true;
    }
  }),

  // Thunks for sync-aware selection changes.
  addSelectionAndSync: thunk(async (actions, id, { getState }) => {
    actions.addSelection(id);
    if (SyncService.isSyncEnabled() && !syncWarningShown) {
      const state = getState();
      if (state.userProfile && !state.userProfile.authenticated && !state.userProfile.error) {
        syncWarningShown = true;
        actions.setShowSyncWarning(true);
      }
    }
    await coalescedSync(actions);
  }),
  removeSelectionAndSync: thunk(async (actions, id, { getState }) => {
    actions.removeSelection(id);
    if (SyncService.isSyncEnabled() && !syncWarningShown) {
      const state = getState();
      if (state.userProfile && !state.userProfile.authenticated && !state.userProfile.error) {
        syncWarningShown = true;
        actions.setShowSyncWarning(true);
      }
    }
    await coalescedSync(actions);
  }),

  // Computed.
  timeToNextFetch: computed((state) => {
    return (
      configData.TIMER.FETCH_INTERVAL_MINS * 60 - (state.timeSinceLastAttempt ?? 0)
    );
  }),
  timeZoneIsShown: computed((state) => {
    return (
      state.showTimeZone === "always" ||
      (state.showTimeZone === "if_local" &&
        (state.showLocalTime === "always" ||
          (state.showLocalTime === "differs" && LocalTime.timezonesDiffer)))
    );
  }),
  programIsFiltered: computed((state) => {
    if (state.programSelectedLocations.length > 0) return true;
    for (const tag in state.programSelectedTags)
      if (state.programSelectedTags[tag].length > 0) return true;
    if (state.programHideBefore.length > 0) return true;
    if (state.programSearch.length > 0) return true;
    return false;
  }),
  peopleAreFiltered: computed((state) => {
    for (const tag in state.peopleSelectedTags)
      if (state.peopleSelectedTags[tag].length > 0) return true;
    if (state.peopleSearch.length > 0) return true;
    return false;
  }),
  timeBoundaries: computed([(state) => state.program], (program) =>
    collectBoundaries(program)
  ),
  selectedSet: computed(
    [(state) => state.mySelections],
    (mySelections) => new Set(mySelections)
  ),
  expandedSet: computed(
    [(state) => state.expandedItems],
    (expandedItems) => new Set(expandedItems)
  ),
  isSelected: computed([(state) => state.selectedSet], (selectedSet) => {
    return (id) => selectedSet.has(id);
  }),
  isExpanded: computed([(state) => state.expandedSet], (expandedSet) => {
    return (id) => expandedSet.has(id);
  }),
  noneExpanded: computed((state) => state.expandedItems.length === 0),
  allExpanded: computed((state) => {
    for (let item of state.program)
      if (!state.expandedSet.has(item.id)) return false;
    return true;
  }),
  allSelectedExpanded: computed((state) => {
    for (let item of state.mySelections)
      if (!state.expandedSet.has(item)) return false;
    return true;
  }),
  getMySchedule: computed((state) =>
    state.program.filter((item) => state.selectedSet.has(item.id))
  ),
};

export default model;
