import { format as formatRelativeTime } from "timeago.js";
import configData from "../config.json";

const offlineConfig = configData.OFFLINE || {};

export function formatOfflineTitle(lastFetchTime) {
  if (!lastFetchTime) {
    return (
      offlineConfig.TITLE_UNKNOWN || "Showing the last schedule we downloaded."
    );
  }
  return (offlineConfig.TITLE || "Showing the last schedule we downloaded @relative.").replace(
    "@relative",
    formatRelativeTime(lastFetchTime, undefined, {
      relativeDate: new Date().getTime(),
    })
  );
}
