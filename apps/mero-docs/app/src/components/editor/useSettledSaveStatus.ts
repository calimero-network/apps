import { useEffect, useRef, useState } from 'react';
import type { SaveStatus } from './types';

const SHOW_SAVING_AFTER_MS = 700; // a save that lands sooner never shows "Saving…"
const MIN_SAVING_VISIBLE_MS = 500; // once shown, long enough to read rather than flash

const isBusy = (s: SaveStatus) => s === 'saving' || s === 'unsaved';

/** The save status to display: calm while typing, but errors and offline show at once. */
export function useSettledSaveStatus(status: SaveStatus): SaveStatus {
  const [shown, setShown] = useState<SaveStatus>(
    isBusy(status) ? 'saved' : status,
  );
  const savingSince = useRef(0);

  useEffect(() => {
    if (isBusy(status)) {
      if (shown === 'saving') return;
      const timer = setTimeout(() => {
        savingSince.current = Date.now();
        setShown('saving');
      }, SHOW_SAVING_AFTER_MS);
      return () => clearTimeout(timer);
    }
    const remaining =
      MIN_SAVING_VISIBLE_MS - (Date.now() - savingSince.current);
    if (shown !== 'saving' || status !== 'saved' || remaining <= 0) {
      setShown(status);
      return;
    }
    const timer = setTimeout(() => setShown(status), remaining);
    return () => clearTimeout(timer);
  }, [status, shown]);

  return shown;
}
