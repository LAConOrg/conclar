import { useEffect, useState } from "react";
import { useStoreState } from "easy-peasy";
import { MdCloudOff } from "react-icons/md";
import configData from "../config.json";
import { formatOfflineTitle } from "../utils/OfflineWording";
import InfoPopup from "./InfoPopup";
import Icon from "./Icon";

const offlineConfig = configData.OFFLINE || {};

/**
 * Explains the offline state: when the schedule being shown was downloaded,
 * and what happens to My Schedule changes made in the meantime.
 *
 * Rendered twice at app level (see AppRoutes): once on demand from either
 * placement of OfflineStatus, and once as a one-time warning right after
 * the first boot fetch fails with cached data to fall back to - that
 * instance sets showDontWarnAgain, adding a checkbox that lets the caller's
 * onDismiss permanently suppress future warnings.
 *
 * @param {{isOpen: boolean, onDismiss: (dontWarnAgain: boolean) => void, showDontWarnAgain?: boolean}} props
 */
const OfflineDialog = ({ isOpen, onDismiss, showDontWarnAgain = false }) => {
  const lastFetchTime = useStoreState((state) => state.lastFetchTime);
  const userProfile = useStoreState((state) => state.userProfile);
  const dataFetchFailed = useStoreState((state) => state.dataFetchFailed);
  const [dontWarnAgain, setDontWarnAgain] = useState(false);

  useEffect(() => {
    // Force-close on reconnect ignores an unsubmitted checkbox tick - this
    // isn't the user dismissing the dialog, so it shouldn't be able to
    // permanently suppress future warnings.
    if (isOpen && !dataFetchFailed) {
      onDismiss(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, dataFetchFailed]);

  useEffect(() => {
    // The dialog stays mounted (AppRoutes just toggles isOpen), so an old
    // tick would otherwise survive into the next time this warning opens.
    if (isOpen) {
      setDontWarnAgain(false);
    }
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  const close = () => onDismiss(dontWarnAgain);
  const selections = userProfile?.authenticated
    ? offlineConfig.SELECTIONS_SYNCED
    : offlineConfig.SELECTIONS_LOCAL;

  return (
    <InfoPopup
      isOpen={true}
      heading={
        <span className="offline-heading">
          <Icon icon={MdCloudOff} className="offline-heading-icon" />
          {offlineConfig.HEADING || "You're offline"}
        </span>
      }
      title={formatOfflineTitle(lastFetchTime)}
      body={
        <>
          <p>
            {offlineConfig.STALE_DATA ||
              "Any changes made since then won't be reflected until you're back online."}
          </p>
          {selections && <p>{selections}</p>}
        </>
      }
      primaryAction={{
        label: offlineConfig.CONTINUE_LABEL || "View the old schedule",
        onClick: close,
      }}
      onDismiss={close}
      extra={
        showDontWarnAgain && (
          <div className="offline-warning-checkbox">
            <input
              id="offline-warning-dont-warn-again"
              type="checkbox"
              checked={dontWarnAgain}
              onChange={(e) => setDontWarnAgain(e.target.checked)}
            />
            <label htmlFor="offline-warning-dont-warn-again">
              {offlineConfig.DONT_WARN_AGAIN_LABEL || "Don't show this again"}
            </label>
          </div>
        )
      }
    />
  );
};

export default OfflineDialog;
