import type { AppTransport } from "../generated/client";

/**
 * The calendar the data layer talks to, for the code that cannot use hooks:
 * the redux thunks (`store/events/actions.ts`) build their data source once at
 * module load. The calendar page binds the signed-in client and the open app
 * instance here (v1 did the same with `setContextId()` and the node session).
 */
export interface Binding {
  client: AppTransport | null;
  /** The open calendar: an app instance id. */
  app: string;
  /** Runs after every request: keeps a refreshed session stored. */
  after: () => void;
}

const empty: Binding = { client: null, app: "", after: () => {} };
let current: Binding = empty;

export function bindCalendar(next: Partial<Binding>): void {
  current = { ...current, ...next };
}

export function getBinding(): Binding {
  return current;
}

/** Test seam. */
export function resetBinding(): void {
  current = empty;
}
