import { useEffect } from "react";
import { useStoreState, useStoreActions } from "easy-peasy";

const Timer = ({ tick }) => {
  const timeToNextFetch = useStoreState((state) => state.timeToNextFetch);
  const updateTimeSinceLastAttempt = useStoreActions(
    (action) => action.updateTimeSinceLastAttempt
  );
  const onLine = useStoreState((state) => state.onLine);
  const setOnLine = useStoreActions((action) => action.setOnLine);
  const fetchProgram = useStoreActions((actions) => actions.fetchProgram);

  useEffect(() => {
    const handleOnline = () => setOnLine(true);
    const handleOffline = () => setOnLine(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [setOnLine]);

  useEffect(() => {
    // Create JavaScript interval timer.
    let timer = setInterval(() => {
      updateTimeSinceLastAttempt();
      setOnLine(window.navigator.onLine);

      if (onLine && timeToNextFetch <= 0) {
        fetchProgram(false);
      }
    }, tick * 1000);

    // Clean-up, called when component shuts down.
    return () => {
      clearInterval(timer);
    };
  });

  return <></>;
};

export default Timer;
