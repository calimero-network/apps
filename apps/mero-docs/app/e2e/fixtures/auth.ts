// Writes the mero-react v2 storage keys directly so tests skip the
// ConnectButton → auth-frontend → callback flow.
//
// The crucial key is `mero-tokens`: mero-js's LocalStorageTokenStore
// reads only that JSON blob for bearer tokens. The namespaced
// `mero:access_token` / `mero:refresh_token` keys exported by
// mero-react/storage are unused for the token itself, so writing only
// those leaves MeroProvider's first admin-api call unauthed.

import type { BrowserContext, Page } from '@playwright/test';

export interface InjectAuthOptions {
  nodeUrl: string;
  accessToken: string;
  refreshToken: string;
  applicationId: string;
}

// Both Page and BrowserContext expose addInitScript; tests that open
// multiple pages per node share auth at the context level.
type InitScriptTarget =
  | Pick<Page, 'addInitScript'>
  | Pick<BrowserContext, 'addInitScript'>;

export async function injectMeroAuth(
  target: InitScriptTarget,
  opts: InjectAuthOptions,
): Promise<void> {
  await target.addInitScript((data) => {
    const expiresAt = Date.now() + 3_600_000;
    localStorage.setItem(
      'mero-tokens',
      JSON.stringify({
        access_token: data.accessToken,
        refresh_token: data.refreshToken,
        expires_at: expiresAt,
      }),
    );
    localStorage.setItem('mero:expires_at', String(expiresAt));
    localStorage.setItem('mero:node_url', data.nodeUrl);
    localStorage.setItem('mero:application_id', data.applicationId);
  }, opts);
}
