/**
 * The report's shape, shared by the page (which shows it) and the cluster run
 * (which writes it to `test-results/conformance-report.json`). Imports nothing.
 */

/** Who made the call: account A (the run's subject), account B (a second member), or another caller. */
export type Who = "A" | "B" | "outsider" | "anonymous" | "apiKey";

/**
 * What a row may come out as. `ok` is a call that resolved and whose result
 * passed the row's check. A named refusal is the node's API code
 * (`NOT_FOUND`, `CONFIRM_REQUIRED`, `FORBIDDEN`, `UNAUTHENTICATED`,
 * `NO_REGISTRY`, …) or, for an app's own refusal, `APP_ERROR:<appCode>`; a
 * trap is `TRAP`. Anything else — an unexpected status, a wrong value read
 * back, a timeout — is `error` or `mismatch`, and is never expected.
 */
export type Outcome = string;

export interface Row {
  /** e.g. `Orgs / createOrg`. */
  readonly name: string;
  readonly area: string;
  readonly who: Who;
  readonly expected: Outcome;
  readonly actual: Outcome;
  readonly pass: boolean;
  /** The error text, for anything but `ok`. */
  readonly error?: string;
  /** What the call returned, abbreviated, for `ok` rows worth showing. */
  readonly detail?: string;
  readonly ms: number;
}

export interface Report {
  readonly summary: { rows: number; passed: number; failed: number };
  readonly rows: readonly Row[];
}

export function report(rows: readonly Row[]): Report {
  const passed = rows.filter((r) => r.pass).length;
  return { summary: { rows: rows.length, passed, failed: rows.length - passed }, rows };
}
