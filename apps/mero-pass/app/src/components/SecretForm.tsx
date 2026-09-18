import { useEffect, useMemo, useRef, useState } from 'react';

import type { MeroPassClient, SecretItem } from '../generated/MeroPassClient';
import { useDialogOpen } from '../hooks/useDialogOpen';
import shell from '../styles/shell.module.css';
import styles from './SecretForm.module.css';

/** The kinds a secret can be, and the fields each one carries. */
const KINDS = [
  { id: 'login', label: 'Login' },
  { id: 'secure_note', label: 'Secure note' },
  { id: 'totp', label: 'Authenticator (TOTP)' },
  { id: 'ssh_key', label: 'SSH key' },
  { id: 'payment_card', label: 'Payment card' },
] as const;

type Kind = (typeof KINDS)[number]['id'];

interface FieldSpec {
  key: string;
  label: string;
  /** A long value gets a textarea; everything else a single line. */
  multiline?: boolean;
  /** Concealed while typing, and never pre-filled into a shared surface. */
  secret?: boolean;
  half?: boolean;
}

const FIELDS: Record<Kind, FieldSpec[]> = {
  login: [
    { key: 'username', label: 'Username', half: true },
    { key: 'password', label: 'Password', secret: true, half: true },
    { key: 'url', label: 'Website' },
    { key: 'notes', label: 'Notes', multiline: true },
  ],
  secure_note: [{ key: 'content', label: 'Note', multiline: true }],
  totp: [
    { key: 'secret', label: 'Shared secret', secret: true },
    { key: 'issuer', label: 'Issuer', half: true },
    { key: 'account', label: 'Account', half: true },
  ],
  ssh_key: [
    { key: 'private_key', label: 'Private key', multiline: true, secret: true },
    { key: 'public_key', label: 'Public key', multiline: true },
    { key: 'passphrase', label: 'Passphrase', secret: true },
  ],
  payment_card: [
    { key: 'cardholder_name', label: 'Cardholder', half: true },
    { key: 'card_number', label: 'Card number', secret: true, half: true },
    { key: 'expiry_date', label: 'Expires', half: true },
    { key: 'cvv', label: 'CVV', secret: true, half: true },
    { key: 'notes', label: 'Notes', multiline: true },
  ],
};

function readData(raw: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [
        k,
        String(v ?? ''),
      ]),
    );
  } catch {
    return {};
  }
}

/**
 * Add or edit one secret.
 *
 * ── Rewritten, not restyled ─────────────────────────────────────────────────
 *
 * The previous version was ~600 lines: five hand-written field groups, five
 * `useState` records that had to be kept in step with the selected type, and
 * mero-ui `Modal`/`Input`/`Select`/`Textarea` bringing their own surface into a
 * light app. The shape of a secret is DATA, so it is data here — one `FIELDS`
 * table — and the form is derived from it. Adding a kind is one entry.
 *
 * Two behaviours worth naming:
 *
 *   * It is a CONTROLLED dialog now (`open` + `onClose`). It used to render its
 *     own trigger button and own its open state, and it accepted a `trigger`
 *     prop that it rendered WITHOUT wiring to that state — so passing one
 *     produced a button that did nothing. The caller owns the state instead.
 *   * A secret field is typed into `type="password"` and is never written to a
 *     `title`, a `value` on a disabled control, or anywhere it would survive
 *     the dialog closing. On close the draft is dropped.
 */
export default function SecretForm({
  api,
  secret,
  open,
  onClose,
  onSuccess,
}: {
  api: MeroPassClient;
  /** Editing an existing secret, rather than adding one. */
  secret?: SecretItem;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const editing = !!secret;

  const [name, setName] = useState('');
  const [kind, setKind] = useState<Kind>('login');
  const [values, setValues] = useState<Record<string, string>>({});
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useDialogOpen(dialogRef, open);

  // Seed from the secret being edited, and reset to empty when adding. Keyed on
  // `open` too, so re-opening Add after an edit does not show the edit's draft.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setName(secret?.name ?? '');
    setKind(((secret?.secret_type as Kind) || 'login') as Kind);
    setValues(secret ? readData(secret.data) : {});
    setTags(secret?.tags.join(', ') ?? '');
  }, [open, secret]);

  const fields = useMemo(() => FIELDS[kind] ?? FIELDS.login, [kind]);

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Give the secret a name.');
      return;
    }
    setSaving(true);
    setError(null);
    const data = JSON.stringify(
      Object.fromEntries(
        fields.map((f) => [f.key, values[f.key] ?? '']).filter(([, v]) => v),
      ),
    );
    const tagList = tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    try {
      if (secret) {
        await api.updateSecret({
          secret_id: secret.id,
          name: trimmed,
          data,
          tags: tagList,
        });
      } else {
        await api.addSecret({
          name: trimmed,
          secret_type: kind,
          data,
          tags: tagList,
        });
      }
      // Drop the draft before handing back, so nothing sensitive stays in this
      // component's state after the dialog closes.
      setValues({});
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the secret.');
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
      data-testid="secret-form"
    >
      <div className={styles.body}>
        <header className={styles.head}>
          <h2 className={styles.title}>
            {editing ? 'Edit secret' : 'New secret'}
          </h2>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.field}>
          <label className={styles.label} htmlFor="sf-name">
            Name
          </label>
          <input
            id="sf-name"
            className={styles.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="GitHub, Stripe, the office wifi…"
            data-testid="sf-name"
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="sf-kind">
            Kind
          </label>
          <select
            id="sf-kind"
            className={styles.select}
            value={kind}
            onChange={(e) => setKind(e.target.value as Kind)}
            // Changing kind on an existing secret would orphan its fields, and
            // the contract has no way to change `secret_type` after creation.
            disabled={editing}
            data-testid="sf-kind"
          >
            {KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.grid}>
          {fields.map((f) => (
            <div
              key={f.key}
              className={styles.field}
              style={
                f.half ? undefined : { gridColumn: '1 / -1' }
              }
            >
              <label className={styles.label} htmlFor={`sf-${f.key}`}>
                {f.label}
              </label>
              {f.multiline ? (
                <textarea
                  id={`sf-${f.key}`}
                  className={styles.textarea}
                  value={values[f.key] ?? ''}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [f.key]: e.target.value }))
                  }
                />
              ) : (
                <input
                  id={`sf-${f.key}`}
                  className={styles.input}
                  // Concealed while typing. Not cosmetic: this is the field a
                  // shoulder-surfer and a screen-share both read.
                  type={f.secret ? 'password' : 'text'}
                  autoComplete={f.secret ? 'new-password' : 'off'}
                  value={values[f.key] ?? ''}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [f.key]: e.target.value }))
                  }
                />
              )}
            </div>
          ))}
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="sf-tags">
            Tags
          </label>
          <input
            id="sf-tags"
            className={styles.input}
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="work, infra — comma separated"
          />
        </div>

        <p className={styles.hint}>
          Everyone in this vault can read and change this secret. It is
          replicated to their nodes as soon as you save.
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
            disabled={saving || !name.trim()}
            data-testid="sf-save"
          >
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Add secret'}
          </button>
        </div>
      </div>
    </dialog>
  );
}
