// Minimal admin-API client for admin endpoints that don't have a
// mero-react hook (one-shot reads, reconciliation, identity resolution).
//
// Reads node URL + access token from mero-react's own localStorage
// keys (`mero:node_url`, `mero:access_token`) since we're
// mero-react-only now (calimero-client removed in the Phase-10
// follow-up). MeroProvider writes to these keys on connect and
// refresh; adminRequest reads them on every call.

import { getNodeUrl, localStorageTokenStorage } from '@calimero-network/mero-react';

async function buildHeaders(extra?: HeadersInit): Promise<HeadersInit> {
  const token = await localStorageTokenStorage.get();
  return {
    'Content-Type': 'application/json',
    ...(token?.access_token ? { Authorization: `Bearer ${token.access_token}` } : {}),
    ...(extra ?? {}),
  };
}

/** Execute an admin-API call and return the parsed JSON body. */
export async function adminRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const base = getNodeUrl();
  if (!base) {
    throw new Error('admin-api: node URL not set (connect to a node first)');
  }
  const res = await fetch(`${base}/admin-api${path}`, {
    ...init,
    headers: await buildHeaders(init?.headers),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`admin ${res.status}: ${body || res.statusText}`);
  }
  return res.json() as Promise<T>;
}
