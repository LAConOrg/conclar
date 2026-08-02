import { useEffect, useState } from "react";
import { useStoreState, useStoreActions } from "easy-peasy";
import { format as formatRelativeTime } from "timeago.js";
import configData from "../config.json";
import { Format } from "../utils/Format";
import InfoPopup from "./InfoPopup";

const offlineConfig = configData.OFFLINE || {};

/**
 * Explains the offline state: when we last managed to check for schedule
 * updates, and what happens to My Schedule changes made in the meantime.
 *
 * Rendered once, at app level, and opened from either placement of
 * OfflineStatus.
 */
const OfflineDialog = () => {
  const showOfflineDialog = useStoreState((state) => state.showOfflineDialog);
  const lastFetchTime = useStoreState((state) => state.lastFetchTime);
  const show12HourTime = useStoreState((state) => state.show12HourTime);
  const userProfile = useStoreState((state) => state.userProfile);
  useStoreState((state) => state.timeSinceLastAttempt);
  const dataFetchFailed = useStoreState((state) => state.dataFetchFailed);
  const setShowOfflineDialog = useStoreActions(
    (actions) => actions.setShowOfflineDialog
  );
  const fetchProgram = useStoreActions((actions) => actions.fetchProgram);
  const [rechecking, setRechecking] = useState(false);

  useEffect(() => {
    if (showOfflineDialog && !dataFetchFailed) {
      setShowOfflineDialog(false);
    }
  }, [showOfflineDialog, dataFetchFailed, setShowOfflineDialog]);

  if (!showOfflineDialog) {
    return null;
  }

  const recheck = async () => {
    setRechecking(true);
    try {
      await fetchProgram(false);
    } finally {
      setRechecking(false);
    }
  };

  const now = new Date().getTime();
  const lastChecked = lastFetchTime
    ? (offlineConfig.LAST_CHECKED || "Last checked @relative (@absolute).")
        .replace(
          "@relative",
          formatRelativeTime(lastFetchTime, undefined, { relativeDate: now })
        )
        .replace(
          "@absolute",
          Format.formatClockTime(lastFetchTime, now, show12HourTime)
        )
    : offlineConfig.LAST_CHECKED_UNKNOWN ||
      "We haven't managed to check for updates yet.";

  const selections = userProfile?.authenticated
    ? offlineConfig.SELECTIONS_SYNCED
    : offlineConfig.SELECTIONS_LOCAL;

  return (
    <InfoPopup
      isOpen={true}
      heading={offlineConfig.HEADING}
      title={offlineConfig.TITLE}
      body={
        <>
          <p>{lastChecked}</p>
          {selections && <p>{selections}</p>}
        </>
      }
      primaryAction={{
        label: rechecking
          ? offlineConfig.RECHECKING_LABEL || "Checking…"
          : offlineConfig.RECHECK_LABEL || "Check again",
        onClick: recheck,
        disabled: rechecking,
      }}
      dismissLabel={offlineConfig.DISMISS_LABEL || "Close"}
      onDismiss={() => setShowOfflineDialog(false)}
    />
  );
};

export default OfflineDialog;
