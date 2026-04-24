// Raw-HTTP reparent helper.
//
// core replaced the old `/admin-api/groups/:id/nest` + `/unnest` pair
// with a single atomic `/admin-api/groups/:childId/reparent` endpoint
// (see crates/server/src/admin/handlers/groups/reparent_group.rs).
// mero-js 1.4.x still ships `nestGroup`/`unnestGroup` pointing at the
// removed paths, so every subfolder reparent 404s. Work around by
// calling /reparent directly.
//
// Auth: tokens are persisted by mero-js's LocalStorageTokenStore under
// the `mero-tokens` key. Reading that directly is brittle (tied to
// mero-js's internal storage format) but mero-js doesn't expose the
// valid token any other way. Drop this helper when mero-js either
// surfaces reparent as a first-class admin client method or exposes
// the authenticated httpClient on the public surface.

const TOKEN_STORAGE_KEY = 'mero-tokens';

function readAccessToken(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { access_token?: string };
    return parsed?.access_token ?? null;
  } catch {
    return null;
  }
}

export async function reparentGroup(
  nodeUrl: string,
  childGroupId: string,
  newParentId: string,
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
