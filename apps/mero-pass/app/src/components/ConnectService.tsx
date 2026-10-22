import { useEffect, useRef, useState } from 'react';

import type { Secret, VaultSession } from '@calimero-network/mero-pass';
import { useDialogOpen } from '../hooks/useDialogOpen';
import {
  AGENT_TAG,
  ANY_MODEL_TAG,
  connectionDraft,
  existingConnection,
  SERVICES,
} from '../lib/connections';
import { describeError } from '../lib/errors';
import shell from '../styles/shell.module.css';
import { CloseIcon } from './icons';
import styles from './SecretForm.module.css';

/**
 * Connect a service (X) for this vault's agent: its keys, saved as one
 * `api_key` secret mero-bot picks up on its own (see `lib/connections.ts`).
 * Connecting again replaces the keys in the same secret.
 *
 * Like every secret, the keys are encrypted in this browser before they are
 * saved, and the draft is dropped on close.
 */
export default function ConnectService({
  session,
  secrets,
  open,
  onClose,
  onSuccess,
}: {
  session: VaultSession;
  secrets: Secret[];
  open: boolean;
  onClose: () => void;
  onSuccess: (id: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const service = SERVICES[0]!;
  const existing = existingConnection(secrets, service);
  const [values, setValues] = useState<Record<string, string>>({});
  const [anyModel, setAnyModel] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useDialogOpen(dialogRef, open);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setValues({});
    setAnyModel(!!existing?.tags.includes(ANY_MODEL_TAG));
    // Only when it opens: a reload while it is open keeps what is typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const complete = service.fields.every((f) => values[f.key]?.trim());

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const draft = connectionDraft(service, values, anyModel);
      let id = existing?.id ?? '';
      if (existing) {
        // Its other tags stay; the agent marks follow the checkbox.
        const tags = [
          ...existing.tags.filter(
            (t) => t !== AGENT_TAG && t !== ANY_MODEL_TAG,
          ),
          ...draft.tags,
        ];
        await session.update(existing, {
          kind: existing.kind,
          name: existing.name,
          tags,
          fields: { ...existing.fields, ...draft.fields },
        });
      } else {
        id = await session.add(draft);
      }
      setValues({});
      onSuccess(id);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
      data-testid="connect-service"
    >
      <div className={styles.body}>
        <header className={styles.head}>
          <h2 className={styles.title}>
            {existing
              ? `Replace ${service.label} keys`
              : `Connect ${service.label} for your agent`}
          </h2>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="Close"
          >
            <CloseIcon size={18} />
          </button>
        </header>

        {error && <p className={styles.error}>{error}</p>}

        <p className={styles.hint}>
          {service.steps}{' '}
          <a href={service.keysAt} target="_blank" rel="noreferrer">
            Open the developer portal
          </a>
        </p>

        <div className={styles.grid}>
          {service.fields.map((f) => (
            <div
              key={f.key}
              className={styles.field}
              style={{ gridColumn: '1 / -1' }}
            >
              <label className={styles.label} htmlFor={`cs-${f.key}`}>
                {f.label}
                {f.hint && <span className={styles.hint}> · {f.hint}</span>}
              </label>
              <input
                id={`cs-${f.key}`}
                className={styles.input}
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                value={values[f.key] ?? ''}
                onChange={(e) =>
                  setValues((cur) => ({ ...cur, [f.key]: e.target.value }))
                }
                data-testid={`cs-${f.key}`}
              />
            </div>
          ))}
        </div>

        <label
          className={styles.field}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
        >
          <input
            type="checkbox"
            checked={anyModel}
            onChange={(e) => setAnyModel(e.target.checked)}
            data-testid="cs-any-model"
          />
          <span>
            Let cloud models (Claude) use it too. Off: only a private agent (an
            attested model, or one on the agent’s own computer) gets{' '}
            {service.label}.
          </span>
        </label>

        <p className={styles.hint}>
          Encrypted in this browser before it is saved, as the secret “
          {service.label}”, tagged {AGENT_TAG}. mero-bot finds it once a vault
          Admin has approved mero-bot under People &amp; devices. Each post
          still follows your rules in Hyperfeed.
        </p>

        <div className={styles.actions}>
          <button
            type="button"
            className={shell.btnGhost}
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className={shell.btn}
            onClick={() => void save()}
            disabled={saving || !complete}
            data-testid="cs-save"
          >
            {saving
              ? 'Encrypting…'
              : existing
                ? 'Replace keys'
                : `Connect ${service.label}`}
          </button>
        </div>
      </div>
    </dialog>
  );
}
