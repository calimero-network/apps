// Minimal admin-API client. Replaces the deleted `AdminApi.ts` +
// `AbiClient.ts` layer.
//
// The namespace-based v9 app talks to admin-API primarily through
// mero-react hooks (`useNamespacesForApplication`, `useNestGroup`,
// `useAddGroupMember`, etc.). This file only exports thin fetch
// helpers for paths where there's no suitable hook yet (one-shot
// reads, reconciliation, identity resolution).

import { getAppEndpointKey, getAccessToken } from '@calimero-network/calimero-client';

function buildHeaders(extra?: HeadersInit): HeadersInit {
  const token = getAccessToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(extra ?? {}),
  };
}

/** Execute an admin-API call and return the parsed JSON body. */
export async function adminRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const base = getAppEndpointKey();
  if (!base) {
    throw new Error('admin-api: node endpoint not set');
  }
  const res = await fetch(`${base}/admin-api${path}`, {
    ...init,
    headers: buildHeaders(init?.headers),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`admin ${res.status}: ${body || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

/** Same as `adminRequest` but exposes the HTTP status for callers
 *  that need to distinguish 2xx cases (e.g. 200 vs 201). */
export async function adminRequestFull<T>(
  path: string,
  init?: RequestInit,
): Promise<{ data: T; status: number }> {
  const base = getAppEndpointKey();
  if (!base) {
    throw new Error('admin-api: node endpoint not set');
  }
  const res = await fetch(`${base}/admin-api${path}`, {
    ...init,
    headers: buildHeaders(init?.headers),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`admin ${res.status}: ${body || res.statusText}`);
  }
  const data = (await res.json()) as T;
  return { data, status: res.status };
}
