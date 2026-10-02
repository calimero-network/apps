/**
 * The report's shape, shared by the page (which writes it) and the Playwright
 * runner (which reads it off `window.__conformance`). Imports nothing, so the
 * runner's project can include it without the browser code around it.
 */

/** Which connection a session holds. */
export type Mode = 'node' | 'account';

/**
 * What a row may come out as. `ok` is a call that resolved and whose result
 * passed the row's check; the two named refusals are mero-react's
 * (`NotForAccountError`: the call has no account form; `NoRelayError`: the
 * account holds no relay yet). Anything else — an HTTP 403, a refused intent,
 * a wrong value read back — is `error` or `mismatch`, and is never expected.
 */
export type Outcome = 'ok' | 'NotForAccountError' | 'NoRelayError' | 'error' | 'mismatch' | 'blocked';

/** What a row expects, per mode of the session running it. */
export type Expected = 'ok' | 'NotForAccountError' | 'NoRelayError';

export interface Row {
  /** e.g. `Namespaces / createNamespace`. */
  readonly name: string;
  readonly area: string;
  /** The run this row belongs to: the PRIMARY session's mode. */
  readonly run: Mode;
  /** The mode of the session that made the call (a second session is always an account). */
  readonly mode: Mode;
  /** `primary` or `second`. */
  readonly session: 'primary' | 'second';
  readonly expected: Expected;
  readonly actual: Outcome;
  readonly pass: boolean;
  /** The error text, for anything but `ok`. */
  readonly error?: string;
  /** What the call returned, abbreviated, for `ok` rows worth showing. */
  readonly detail?: string;
  readonly ms: number;
}

export interface ConformanceApi {
  /** True once a session is connected and its admin is usable. */
  readonly ready: boolean;
  readonly mode: Mode | null;
  readonly rows: readonly Row[];
  /** Run one phase of the matrix; resolves with what later phases need. */
  run(phase: string, input?: unknown): Promise<unknown>;
}

declare global {
  interface Window {
    __conformance?: ConformanceApi;
  }
}
