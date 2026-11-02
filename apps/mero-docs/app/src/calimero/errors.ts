// How the app tells failures apart, on mero-js 28's typed errors.
//
// v1 read mero-js 26's `HTTPError` (status 0 for a fetch that failed),
// `RpcError` (core's typed refusals, `ReadOnlyWriteRefused` among them) and
// `classifyError`. On Calimero 1.0 every refusal the node answers is a
// `CalimeroError` with its `status` and the node's `code`; a call the node never
// answered is an `UnavailableError` (503, reason `network`), a contract's own
// refusal an `AppError` (422, `appCode` + `fields`). This module is the one
// place that maps them onto the questions the screens ask.

import {
  AppError,
  ArgsTooLarge,
  CalimeroError,
  LoginRequired,
  UnavailableError,
} from '@calimero-network/mero-js';

/** Every refusal the node answered: `status` and the node's `code`. Named as
 *  v1's class so `err instanceof HTTPError && err.status === 404` keeps reading. */
export { CalimeroError as HTTPError };

/** A session the node no longer takes (v1's revoked token family). */
export { LoginRequired as AuthRevokedError };

export type ErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'not-found'
  | 'too-large'
  | 'unreachable'
  | 'unavailable'
  | 'server'
  | 'app'
  | 'unknown';

/** What kind of failure `err` is, as v1's `classifyError` answered. */
export function classifyError(err: unknown): { kind: ErrorKind; retryable: boolean } {
  const { kind } = kindOf(err);
  // A refusal that will be the same next time is not worth resending.
  const final = kind === 'unauthorized' || kind === 'forbidden' || kind === 'not-found' || kind === 'too-large';
  return { kind, retryable: !final };
}

function kindOf(err: unknown): { kind: ErrorKind } {
  if (err instanceof UnavailableError) {
    return { kind: err.reason === 'network' ? 'unreachable' : 'unavailable' };
  }
  if (err instanceof LoginRequired) return { kind: 'unauthorized' };
  if (err instanceof ArgsTooLarge) return { kind: 'too-large' };
  if (err instanceof AppError) return { kind: 'app' };
  if (err instanceof CalimeroError) {
    if (err.status === 401) return { kind: 'unauthorized' };
    if (err.status === 403) return { kind: 'forbidden' };
    if (err.status === 404) return { kind: 'not-found' };
    if (err.status === 413) return { kind: 'too-large' };
    if (err.status >= 500) return { kind: 'server' };
    return { kind: 'unknown' };
  }
  if (err instanceof TypeError) return { kind: 'unreachable' };
  return { kind: 'unknown' };
}

/**
 * A write the node refused because the caller's row in the folder's team is
 * read-only (core: "a call that would write anything is refused with 403").
 * v1 answered the same case with `RpcError { type: 'ReadOnlyWriteRefused' }`.
 * Nothing else answers a member's call with 403: someone the app does not
 * reach gets 404.
 */
export function isReadOnlyWrite(err: unknown): boolean {
  return err instanceof CalimeroError && !(err instanceof AppError) && err.status === 403;
}

/** The contract's own refusal: its error code and `fields.message`. */
export function appErrorOf(err: unknown): { code: string; message: string } | null {
  if (!(err instanceof AppError)) return null;
  const message = err.fields?.message;
  return { code: err.appCode, message: typeof message === 'string' ? message : '' };
}
