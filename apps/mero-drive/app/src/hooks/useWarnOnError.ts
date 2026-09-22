import { useEffect } from 'react';

/** Log a best-effort feature's error when it changes; it never reaches the UI. */
export function useWarnOnError(message: string, error: Error | null): void {
  useEffect(() => {
    if (error) console.warn(message, error);
  }, [message, error]);
}
