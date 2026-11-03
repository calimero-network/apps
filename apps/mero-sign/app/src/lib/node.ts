/**
 * The signed-in session, for the services and data sources that are not React
 * components (they never receive the client as a prop), plus the blob calls
 * and the `{ data, error }` result shape the call sites branch on.
 *
 * On Calimero 1.0 there is no node to log into: the frontend knows its
 * cluster (merod local in dev, the Cloud cluster in production, see
 * `@calimero-apps/connect`), the account is a passkey, and every agreement and
 * the private signature library is an APP INSTANCE the account reaches. The
 * session is registered once, from `SessionBridge` under the provider.
 */
import {
  AppError,
  CalimeroError,
  type CalimeroClient,
  type PasskeyProvider,
} from '@calimero-network/mero-js';
import { describeError, type AppSource, type Target } from '@calimero-apps/connect';

import { MeroSignApp } from './meroSign';

export type ErrorResponse = { code?: number; message: string };

/**
 * `ApiResponse<T>` is itself a promise, and a discriminated union: `data` is
 * `null` on the error arm. Kept from v1 because the services and screens
 * branch on `result.error`.
 */
export type ResponseData<D> =
  | { data: D; error?: null }
  | { data?: null; error: ErrorResponse };

export type ApiResponse<T> = Promise<ResponseData<T>>;

/** What a signed-in service needs. */
export interface SignSession {
  client: CalimeroClient;
  accountId: string;
  target: Target;
  /** Where instances come from: the dev bundle, or the package in production. */
  source: AppSource;
  passkey: () => PasskeyProvider;
  /** Run after each request: keeps the stored session current. */
  after: () => void;
}

let current: SignSession | null = null;

/** Called by `SessionBridge` whenever the session changes. */
export function setSignSession(session: SignSession | null): void {
  current = session;
}

/** The signed-in session; throws when there is none. */
export function signSession(): SignSession {
  if (!current) throw new Error('Sign in first.');
  return current;
}

export function maybeSignSession(): SignSession | null {
  return current;
}

/** The contract on one app instance (an agreement, or the private library). */
export function meroSignApp(appId: string): MeroSignApp {
  const s = signSession();
  return new MeroSignApp(s.client, appId, s.after);
}

/**
 * The blob routes of a component app answer `409 NOT_SUPPORTED` on core
 * releases before component blobs (core#4815): the contract stores blob ids,
 * but the node will not hold the bytes. Said in words the person can act on.
 */
export const BLOBS_UNSUPPORTED =
  'This cluster cannot store files for Mero Sign yet: its Calimero release ' +
  'predates blobs for component apps (core#4815). Documents and signature ' +
  'images need a cluster on a newer release.';

/** One line for the UI: the contract's own sentence where it gave one. */
export function errorMessage(e: unknown): string {
  if (e instanceof AppError) {
    const message = e.fields?.message;
    if (typeof message === 'string' && message) return message;
    if (e.appCode === 'NotFound') {
      const what = typeof e.fields?.what === 'string' ? e.fields.what : 'item';
      return `That ${what} was not found.`;
    }
  }
  if (e instanceof CalimeroError && e.code === 'NOT_SUPPORTED') {
    return BLOBS_UNSUPPORTED;
  }
  return describeError(e);
}

/** Run a request and answer `{ data, error }` instead of throwing. */
export async function wrap<T>(run: () => Promise<T>): ApiResponse<T> {
  try {
    return { data: await run(), error: null };
  } catch (e) {
    const status = (e as { status?: unknown } | null)?.status;
    return {
      error: {
        message: errorMessage(e),
        ...(typeof status === 'number' ? { code: status } : {}),
      },
    };
  }
}

// ── blobs ────────────────────────────────────────────────────────────────────

export interface BlobApi {
  /**
   * Stores `file` in app instance `appId` (`POST /apps/{app}/blobs`) and
   * answers its id as 64 lowercase hex digits, the form the contract takes.
   */
  uploadBlob(
    file: Blob,
    onProgress: ((pct: number) => void) | undefined,
    appId: string,
  ): ApiResponse<{ blobId: string; size: number }>;
  /** The bytes of blob `blobId` in app instance `appId`. */
  downloadBlob(blobId: string, appId: string): Promise<Blob>;
}

/** The sentence a blob call without an instance fails with. */
export const BLOB_NEEDS_CONTEXT =
  'A file belongs to an agreement or to your signature library, and none ' +
  'was given.';

function requireApp(appId: string | null | undefined): string {
  const id = (appId ?? '').trim();
  if (!id) throw new Error(BLOB_NEEDS_CONTEXT);
  return id;
}

export const blobClient: BlobApi = {
  async uploadBlob(file, onProgress, appId) {
    const res = await wrap(async () => {
      const s = signSession();
      const bytes = new Uint8Array(await file.arrayBuffer());
      try {
        const up = await s.client.uploadBlob(requireApp(appId), bytes);
        return { blobId: up.id.toLowerCase(), size: up.size };
      } finally {
        s.after();
      }
    });
    // mero-js reports no progress events: 100% on completion, nothing invented.
    if (res.data) onProgress?.(100);
    return res;
  },
  async downloadBlob(blobId, appId) {
    const s = signSession();
    try {
      const bytes = await s.client.downloadBlob(requireApp(appId), blobId);
      return new Blob([bytes as BlobPart]);
    } catch (e) {
      throw new Error(errorMessage(e));
    } finally {
      s.after();
    }
  },
};

// ── the open agreement ───────────────────────────────────────────────────────

const AGREEMENT_KEY = 'agreementContextID';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** The agreement (app instance) this browser has open. */
export const getContextId = (): string | null => read(AGREEMENT_KEY);
export const setContextId = (contextId: string): void => {
  try {
    localStorage.setItem(AGREEMENT_KEY, contextId);
  } catch {
    /* remembered for this page only */
  }
};

export { useCalimero } from './useCalimero';
