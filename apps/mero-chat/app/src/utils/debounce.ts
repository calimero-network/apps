/**
 * Debounce utility function
 * Delays execution of a function until after a specified wait time has passed
 * since the last time it was invoked
 *
 * Returns a debounced function with a cancel method to clear pending invocations
 */
export function debounce<TArgs extends unknown[]>(
  func: (...args: TArgs) => unknown,
  wait: number,
): ((...args: TArgs) => void) & { cancel: () => void } {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const debouncedFn = (...args: TArgs) => {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => {
      timeout = undefined;
      func(...args);
    }, wait);
  };

  // Add cancel method to clear pending timeouts
  debouncedFn.cancel = () => {
    if (timeout !== undefined) {
      clearTimeout(timeout);
      timeout = undefined;
    }
  };

  return debouncedFn;
}
