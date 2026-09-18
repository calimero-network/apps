/**
 * Spend a warrant at a relay, with a key this page cannot read.
 *
 * `RelayClient` from mero-js does this already and better in every respect but
 * one: its config takes `deviceSecret` as 32 hex bytes, so using it requires the
 * secret to exist in script memory. That is the compromise this app is removing,
 * so the four things the client does are reproduced here around a `CryptoKey`:
 *
 * 1. learn the executor from `describe` **before** signing — a warrant minted
 *    against the wrong executor is unspendable, and the nonce is gone either way
 * 2. take the next number from this device's monotonic sequence
 * 3. bound it in wall-clock time
 * 4. POST `{method, argsJson, warrant, authorProof}` to `/intents`
 *
 * The request body is `PerformIntentApiRequest`, which is `deny_unknown_fields`
 * — an extra key is a 422, not a warning.
 */

import { signWarrant } from './warrant';
import type { DeviceHandle, EnrolledDevice } from './device';

/** What `merod` allows a warrant before refusing it; mero-js's default too. */
const DEFAULT_TTL_SECONDS = 300;

export interface RelayDescription {
  /** The relay's own account — what a warrant must name as its executor. */
  executorAccount: string;
  /** Whether that account may author for someone else here. The usual reason a
   *  first write fails, and knowable without signing anything. */
  canAuthorOnBehalf: boolean;
  groupId?: string;
  grantedOnGroupId?: string;
}

export interface IntentResult<T = unknown> {
  /** The context's scope root after the run — did this change anything. */
  rootHash: string | null;
  returns: T | null;
}

export class IntentRefusedError extends Error {
  override name = 'IntentRefusedError';
  constructor(
    readonly reason: string,
    readonly retryable: boolean,
    readonly status: number,
  ) {
    super(`relay refused the intent (HTTP ${status}): ${reason}`);
  }
}

function reasonOf(body: string): string {
  if (!body) return 'no reason given';
  try {
    const parsed = JSON.parse(body) as { error?: string; message?: string };
    return parsed.error || parsed.message || body;
  } catch {
    return body;
  }
}

async function call<T>(url: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    // 400 and 403 are the relay's own refusals and carry a reason worth showing;
    // a nonce complaint is the one worth retrying, with a fresh number.
    if (response.status === 400 || response.status === 403) {
      const reason = reasonOf(text);
      throw new IntentRefusedError(reason, /nonce/i.test(reason), response.status);
    }
    throw new Error(`${method} ${url} answered ${response.status}: ${text.slice(0, 200)}`);
  }
  return (await response.json()) as T;
}

const trimmed = (url: string) => url.replace(/\/+$/, '');

/**
 * Ask what the relay can do here. Signs nothing and spends no nonce, which is
 * what makes it usable as a precondition rather than as a post-mortem.
 */
export async function describeRelay(nodeUrl: string, contextId: string): Promise<RelayDescription> {
  const body = await call<{ data: RelayDescription }>(
    `${trimmed(nodeUrl)}/admin-api/contexts/${encodeURIComponent(contextId)}/intents`,
    'GET',
  );
  return body.data;
}

/**
 * The application this context runs, so a warrant can pin the build it was
 * signed against rather than authorising whatever the relay upgrades to.
 *
 * Nothing verifies `app_version` yet — core landed the field ahead of its
 * enforcement — but a warrant minted with the zero default will be refused once
 * pinning arrives, so it is read here rather than defaulted.
 */
export async function contextApplication(nodeUrl: string, contextId: string): Promise<string | undefined> {
  try {
    const body = await call<{ data?: { applicationId?: string } }>(
      `${trimmed(nodeUrl)}/admin-api/contexts/${encodeURIComponent(contextId)}`,
      'GET',
    );
    return body.data?.applicationId;
  } catch {
    // A node that will not say leaves the warrant unpinned, which is the state
    // every warrant is in today. Failing the write over it would be worse.
    return undefined;
  }
}

/** The monotonic counter a warrant spends, per device. Kept where the demo keeps it. */
export interface NonceSource {
  next(): Promise<bigint>;
}

export function localStorageNonces(devicePublicKey: string): NonceSource {
  const key = `calimero.warrant.nonce.${devicePublicKey}`;
  return {
    next: async () => {
      const current = BigInt(localStorage.getItem(key) ?? '0');
      const next = current + 1n;
      localStorage.setItem(key, next.toString());
      return next;
    },
  };
}

/**
 * Mint a warrant for one intent and hand it to the relay.
 *
 * The author's half is all that travels: the executor's proof and signing key
 * are attached by the node from its own credentials, because the warrant names
 * an operator account and the author has no business naming its processes.
 */
export async function writeContext<T = unknown>(
  nodeUrl: string,
  device: EnrolledDevice,
  handle: DeviceHandle,
  contextId: string,
  method: string,
  argsJson: unknown,
  nonces: NonceSource = localStorageNonces(device.devicePublicKey),
): Promise<IntentResult<T>> {
  const description = await describeRelay(nodeUrl, contextId);
  if (!description.canAuthorOnBehalf) {
    throw new Error(
      `this relay may not author on behalf of others in ${contextId}; its account needs CAN_AUTHOR_ON_BEHALF on the owning group`,
    );
  }

  const appVersion = await contextApplication(nodeUrl, contextId);
  const nonce = await nonces.next();
  const warrant = await signWarrant({
    context: contextId,
    authorAccount: device.accountId,
    executor: description.executorAccount,
    appVersion,
    method,
    argsJson,
    nonce,
    notAfter: BigInt(Math.floor(Date.now() / 1000)) + BigInt(DEFAULT_TTL_SECONDS),
    signingKey: handle.signingKey,
    devicePublicKey: handle.devicePublicKey,
  });

  const body = await call<{ data: { rootHash?: string; returns?: T } }>(
    `${trimmed(nodeUrl)}/admin-api/contexts/${encodeURIComponent(contextId)}/intents`,
    'POST',
    { method, argsJson, warrant, authorProof: device.credential },
  );
  return { rootHash: body.data.rootHash ?? null, returns: body.data.returns ?? null };
}
