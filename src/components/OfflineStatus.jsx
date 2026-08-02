import { useStoreState, useStoreActions } from "easy-peasy";
import { MdCloudOff } from "react-icons/md";
import configData from "../config.json";
import Icon from "./Icon";

const offlineConfig = configData.OFFLINE || {};

/**
 * The offline indicator, shown only while the last programme-data fetch has
 * failed. Opening the dialog is handled by the store, so the popup itself is
 * rendered once at app level (see AppRoutes) rather than inside the sidebar -
 * this component is mounted more than once, and nesting a modal inside the
 * mobile navigation drawer would put a dialog inside a dialog.
 *
 * Two placements, because on mobile the navigation is hidden behind the
 * hamburger and an indicator in there would never be seen:
 *   - "nav": a list item in the sidebar navigation (desktop)
 *   - "topbar": a button in the mobile top bar
 *
 * @param {{variant: "nav"|"topbar"}} props
 */
const OfflineStatus = ({ variant }) => {
  const dataFetchFailed = useStoreState((state) => state.dataFetchFailed);
  const setShowOfflineDialog = useStoreActions(
    (actions) => actions.setShowOfflineDialog
  );

  if (!dataFetchFailed) {
    return null;
  }

  const label = offlineConfig.LABEL || "Offline";
  const open = () => setShowOfflineDialog(true);

  if (variant === "topbar") {
    return (
      <button
        className="offline-status-topbar"
        onClick={open}
        aria-label={label}
        title={label}
      >
        <MdCloudOff aria-hidden="true" />
      </button>
    );
  }

  return (
    <li className="nav-offline-status">
      <button onClick={open}>
        <Icon icon={MdCloudOff} />
        {label}
      </button>
    </li>
  );
};

export default OfflineStatus;
