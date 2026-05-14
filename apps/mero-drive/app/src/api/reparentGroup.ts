// Raw-HTTP reparent helper.
//
// core replaced the old `/admin-api/groups/:id/nest` + `/unnest` pair
// with a single atomic `/admin-api/groups/:childId/reparent` endpoint
// (see crates/server/src/admin/handlers/groups/reparent_group.rs).
// mero-js 2.x still ships `nestGroup`/`unnestGroup` pointing at the
// removed paths, so every subfolder reparent 404s. Work around by
// calling /reparent directly.
//
// Auth: read the token via mero-js's public `LocalStorageTokenStore`
// rather than parsing the storage key by hand. If mero-js ever
// changes the on-disk format the public class moves with it; we
// don't have to chase the change. We also check `expires_at` so an
// expired token isn't sent — the server would reject it anyway, but
// failing fast gives the caller a useful error.
//
// Drop this helper when mero-js surfaces reparent as a first-class
// admin client method.

import { LocalStorageTokenStore } from '@calimero-network/mero-js';

function readAccessToken(): string | null {
  try {
    const tokens = new LocalStorageTokenStore().getTokens();
    if (!tokens?.access_token) return null;
    if (
      typeof tokens.expires_at === 'number' &&
      tokens.expires_at > 0 &&
      tokens.expires_at < Date.now()
    ) {
      return null;
    }
    return tokens.access_token;
  } catch {
    return null;
  }
}

export async function reparentGroup(
  nodeUrl: string,
  childGroupId: string,
  newParentId: string,
  _currentParentId?: string,
): Promise<void> {
  const token = readAccessToken();
  if (!token) {
    throw new Error('Not authenticated — missing access token');
  }
  // Trailing slash on nodeUrl can cause double-slash URL — strip once.
  const base = nodeUrl.replace(/\/+$/, '');
  const res = await fetch(
    `${base}/admin-api/groups/${childGroupId}/reparent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ newParentId }),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `reparent failed: ${res.status} ${res.statusText}${body ? ` — ${body}` : ''}`,
    );
  }
}
