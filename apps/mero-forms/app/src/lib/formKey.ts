import type { CalimeroClient, PasskeyProvider } from "@calimero-network/mero-js";

/**
 * A website form's key: a core API key of the admin's account, limited to
 * this workspace (app instance) and to the two methods a website needs.
 *
 * v1 minted an account with a certified device and no node, made it a member
 * of the namespace, and the website signed a warrant a relay executed. On
 * Calimero 1.0 there are no relays and no warrants: delegation is a scoped
 * API key, approved with the admin's passkey. The contract registers the key
 * by its id (`registerFormKey`), which binds it to one form and keeps it off
 * the team, so the key can answer that form and nothing else.
 */

/** The contract methods a form key may call. */
export const FORM_KEY_METHODS = ["submitResponse", "getForm"] as const;

/** The longest an API key lives (core's `MAX_API_KEY_TTL`). */
export const MAX_KEY_SECS = 365 * 24 * 3600;

export interface IssuedKey {
  /** The API key's id: what the contract registers. */
  keyId: string;
  /** The key itself, shown once. */
  key: string;
}

/** Create the key: a passkey step-up. */
export async function createFormKey(
  client: Pick<CalimeroClient, "createApiKey">,
  appId: string,
  label: string,
  passkey: PasskeyProvider,
): Promise<IssuedKey> {
  const created = await client.createApiKey(
    {
      label: `Mero Forms key: ${label}`.slice(0, 128),
      apps: [appId],
      methods: [...FORM_KEY_METHODS],
      ttlSecs: MAX_KEY_SECS,
    },
    passkey,
  );
  return { keyId: created.keyId, key: created.key };
}

/** Revoke a key; one already gone is fine. */
export async function revokeKey(client: Pick<CalimeroClient, "revokeApiKey">, keyId: string): Promise<void> {
  await client.revokeApiKey(keyId).catch((err: { status?: number }) => {
    if (err?.status !== 404) throw err;
  });
}

/**
 * The environment variables the website's backend reads, as one block to
 * paste. The backend makes a mero-js `CalimeroClient` for the same cluster,
 * calls `useApiKey(CALIMERO_API_KEY)`, and calls `submitResponse` on
 * `CALIMERO_APP_ID`.
 */
export function envBlock(issued: IssuedKey, appId: string, formId: string): string {
  return [`CALIMERO_APP_ID=${appId}`, `CALIMERO_FORM_ID=${formId}`, `CALIMERO_API_KEY=${issued.key}`].join("\n");
}
