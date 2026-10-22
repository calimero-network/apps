import type { Secret } from '@calimero-network/mero-pass';

/**
 * Services an agent (mero-bot) can reach with keys kept in this vault.
 *
 * A connection is an ordinary `api_key` secret with two marks mero-bot reads:
 * the tag {@link AGENT_TAG}, which says an agent may use it, and the `service`
 * field, which names the plugin that does. {@link ANY_MODEL_TAG} lets the
 * agent use it on a cloud model (Claude) too; without it, only on an attested
 * model or one on the agent's own computer. Field names are the contract with
 * mero-bot: it reads them by key.
 */
export const AGENT_TAG = 'mero-bot';
export const ANY_MODEL_TAG = 'mero-bot:any-model';

interface ServiceField {
  key: string;
  label: string;
  hint: string;
}

export interface Service {
  id: string;
  /** The secret's name and its `service` field: what mero-bot matches its plugin by. */
  label: string;
  /** Where the keys come from. */
  keysAt: string;
  steps: string;
  fields: ServiceField[];
}

export const SERVICES: Service[] = [
  {
    id: 'x',
    label: 'X',
    keysAt: 'https://developer.x.com/en/portal/dashboard',
    steps:
      'In the X developer portal, open your app’s Keys and tokens. Set its user authentication to Read and write, then copy the API key and secret, and generate an access token and secret for your account.',
    fields: [
      { key: 'api_key', label: 'API key', hint: 'Also called consumer key' },
      {
        key: 'api_secret',
        label: 'API key secret',
        hint: 'Also called consumer secret',
      },
      {
        key: 'access_token',
        label: 'Access token',
        hint: 'For your account, Read and write',
      },
      { key: 'access_token_secret', label: 'Access token secret', hint: '' },
    ],
  },
];

/** The secret a connection is saved as. */
export function connectionDraft(
  service: Service,
  values: Record<string, string>,
  anyModel: boolean,
): {
  kind: 'api_key';
  name: string;
  tags: string[];
  fields: Record<string, string>;
} {
  const fields: Record<string, string> = { service: service.label };
  for (const f of service.fields) {
    const v = values[f.key]?.trim();
    if (!v) throw new Error(`${f.label} is missing.`);
    fields[f.key] = v;
  }
  return {
    kind: 'api_key',
    name: service.label,
    tags: anyModel ? [AGENT_TAG, ANY_MODEL_TAG] : [AGENT_TAG],
    fields,
  };
}

/** The connection already saved for `service`, if any. */
export function existingConnection(
  secrets: Secret[],
  service: Service,
): Secret | undefined {
  const wanted = service.label.toLowerCase();
  return secrets.find(
    (s) =>
      !s.trashed &&
      !s.unreadable &&
      s.kind === 'api_key' &&
      s.tags.includes(AGENT_TAG) &&
      (s.fields.service ?? s.name).trim().toLowerCase() === wanted,
  );
}
