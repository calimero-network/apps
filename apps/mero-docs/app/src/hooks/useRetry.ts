// Backoff for a write the node never answered: `schedule` runs `run` once after
// a delay that doubles per unanswered attempt, `reset` cancels it and starts over.

import { useCallback, useEffect, useRef } from 'react';

const INITIAL_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 10_000;

export function useRetry(run: () => void): {
  schedule: () => void;
  reset: () => void;
} {
  const runRef = useRef(run);
  runRef.current = run;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const delayRef = useRef(INITIAL_RETRY_DELAY_MS);

  const reset = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    delayRef.current = INITIAL_RETRY_DELAY_MS;
  }, []);

  const schedule = useCallback(() => {
    if (timerRef.current) return;
    const delay = delayRef.current;
    delayRef.current = Math.min(delay * 2, MAX_RETRY_DELAY_MS);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      runRef.current();
    }, delay);
  }, []);

  useEffect(() => reset, [reset]);

  return { schedule, reset };
}
