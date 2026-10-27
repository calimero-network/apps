/**
 * A website form's key on Calimero Cloud: an API key that may call exactly
 * `submit_response` on this workspace's app, and nothing else.
 *
 * v1 minted an account with a certified device for each website and the site
 * wrote through a relay with delegated-execution warrants. Calimero Cloud has
 * neither relays nor warrants; its machine credential is an API key scoped to
 * apps and methods (`POST /auth/apikeys`). The key acts as the account that
 * issued it, so a response it sends is attributed to that admin: the cluster
 * has no keys with an identity of their own yet.
 *
 * The secret is returned once by the cluster and never stored by this app.
 */
import type { CloudMero } from "@calimero-apps/cloud";

/** Labels this app gives its keys, so its key list shows only form keys. */
const PREFIX = "mero-forms:";

export interface FormKey {
  keyId: string;
  formId: string;
  label: string;
  expiresAt: number;
}

export interface IssuedFormKey extends FormKey {
  /** The API key itself: shown once. */
  secret: string;
}

function labelFor(formId: string, label: string): string {
  return `${PREFIX}${formId}:${label}`;
}

function parseLabel(label: string): { formId: string; label: string } | null {
  if (!label.startsWith(PREFIX)) return null;
  const rest = label.slice(PREFIX.length);
  const cut = rest.indexOf(":");
  return cut < 0 ? null : { formId: rest.slice(0, cut), label: rest.slice(cut + 1) };
}

/** Issue a key that may only call `submit_response` on `contextId`'s app. */
export async function issueFormKey(
  mero: CloudMero,
  contextId: string,
  formId: string,
  label: string,
): Promise<IssuedFormKey> {
  const { keyId, key } = await mero.post<{ keyId: string; key: string }>("auth/apikeys", {
    label: labelFor(formId, label),
    apps: [contextId],
    methods: ["submit_response"],
  });
  return { keyId, secret: key, formId, label, expiresAt: 0 };
}

/** This account's form keys, all forms. */
export async function listFormKeys(mero: CloudMero): Promise<FormKey[]> {
  const { keys } = await mero.get<{ keys: Array<{ keyId: string; label: string; expiresAt: number }> }>("auth/apikeys");
  return keys.flatMap((k) => {
    const parsed = parseLabel(k.label);
    return parsed ? [{ keyId: k.keyId, formId: parsed.formId, label: parsed.label, expiresAt: k.expiresAt }] : [];
  });
}

/** Revoke a key: the cluster refuses it from then on. */
export async function revokeFormKey(mero: CloudMero, keyId: string): Promise<void> {
  await mero.delete(`auth/apikeys/${encodeURIComponent(keyId)}`);
}

/**
 * The environment variables the website's backend reads, as one block to
 * paste. The backend calls `submit_response` with them through
 * `CalimeroClient` (`useApiKey`, then `call`).
 */
export function envBlock(clusterUrl: string, contextId: string, issued: IssuedFormKey): string {
  return [
    `CALIMERO_URL=${clusterUrl}`,
    `CALIMERO_APP_ID=${contextId}`,
    `CALIMERO_FORM_ID=${issued.formId}`,
    `CALIMERO_API_KEY=${issued.secret}`,
  ].join("\n");
}
