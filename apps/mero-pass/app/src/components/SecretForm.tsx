import { useEffect, useMemo, useRef, useState } from 'react';

import { useDialogOpen } from '../hooks/useDialogOpen';
import { generatePassword, strengthOf } from '../lib/health';
import { FIELDS, KINDS, type Kind } from '../lib/secretKinds';
import { parseTotp } from '../lib/totp';
import type { Secret, VaultSession } from '../lib/vaultSession';
import shell from '../styles/shell.module.css';
import styles from './SecretForm.module.css';

const STRENGTH_LABEL = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'];

/**
 * Add or edit one secret.
 *
 * Everything typed here is sealed in the browser before it is sent (see
 * `VaultSession.add` / `update`); the node receives ciphertext. On save an
 * edit sends only the fields that changed, so a field the user did not touch
 * cannot overwrite a concurrent change to it from another device.
 *
 * On close the draft is dropped, so nothing sensitive stays in state.
 */
export default function SecretForm({
  session,
  secret,
  open,
  onClose,
  onSuccess,
}: {
  session: VaultSession;
  /** Editing an existing secret, rather than adding one. */
  secret?: Secret;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const editing = !!secret;

  const [name, setName] = useState('');
  const [kind, setKind] = useState<Kind>('login');
  const [values, setValues] = useState<Record<string, string>>({});
  const [shown, setShown] = useState<Set<string>>(new Set());
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useDialogOpen(dialogRef, open);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setShown(new Set());
    setName(secret?.name ?? '');
    setKind(((secret?.kind as Kind) || 'login') as Kind);
    setValues(secret ? { ...secret.fields } : {});
    setTags(secret?.tags.join(', ') ?? '');
  }, [open, secret]);

  const fields = useMemo(() => FIELDS[kind] ?? FIELDS.login, [kind]);

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Give the secret a name.');
      return;
    }
    for (const f of fields) {
      const v = values[f.key]?.trim();
      if (f.totp && v && !parseTotp(v)) {
        setError(`${f.label}: not a base32 seed or an otpauth://totp URI.`);
        return;
      }
    }
    setSaving(true);
    setError(null);
    const keep = new Set(fields.map((f) => f.key));
    const draft = {
      kind,
      name: trimmed,
      tags: tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      fields: Object.fromEntries(
        Object.entries(values).filter(([k, v]) => keep.has(k) && v !== ''),
      ),
    };
    try {
      if (secret) await session.update(secret, draft);
      else await session.add(draft);
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
            // A secret's kind is fixed at creation: changing it would orphan
            // fields the new kind does not show.
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
          {fields.map((f) => {
            const value = values[f.key] ?? '';
            const visible = !f.secret || shown.has(f.key);
            const set = (v: string) =>
              setValues((cur) => ({ ...cur, [f.key]: v }));
            return (
              <div
                key={f.key}
                className={styles.field}
                style={f.half ? undefined : { gridColumn: '1 / -1' }}
              >
                <label className={styles.label} htmlFor={`sf-${f.key}`}>
                  {f.label}
                </label>
                {f.multiline ? (
                  <textarea
                    id={`sf-${f.key}`}
                    className={styles.textarea}
                    value={value}
                    onChange={(e) => set(e.target.value)}
                    spellCheck={!f.secret}
                  />
                ) : (
                  <div className={styles.inputRow}>
                    <input
                      id={`sf-${f.key}`}
                      className={styles.input}
                      type={visible ? 'text' : 'password'}
                      autoComplete={f.secret ? 'new-password' : 'off'}
                      spellCheck={false}
                      value={value}
                      onChange={(e) => set(e.target.value)}
                      data-testid={`sf-${f.key}`}
                    />
                    {f.secret && (
                      <button
                        type="button"
                        className={styles.inline}
                        onClick={() =>
                          setShown((s) => {
                            const n = new Set(s);
                            if (n.has(f.key)) n.delete(f.key);
                            else n.add(f.key);
                            return n;
                          })
                        }
                        aria-label={
                          visible ? `Hide ${f.label}` : `Show ${f.label}`
                        }
                      >
                        {visible ? 'Hide' : 'Show'}
                      </button>
                    )}
                    {f.generate && (
                      <button
                        type="button"
                        className={styles.inline}
                        onClick={() => set(generatePassword())}
                        data-testid="sf-generate"
                      >
                        Generate
                      </button>
                    )}
                  </div>
                )}
                {f.generate && value && (
                  <span className={styles.hint}>
                    {STRENGTH_LABEL[strengthOf(value)]}
                  </span>
                )}
              </div>
            );
          })}
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
          Encrypted in this browser before it is saved. Every member of this
          vault who holds its key can read it, and Editors can change it.
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
            {saving ? 'Encrypting…' : editing ? 'Save changes' : 'Add secret'}
          </button>
        </div>
      </div>
    </dialog>
  );
}
