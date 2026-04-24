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

