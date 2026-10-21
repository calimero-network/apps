import { useEffect, useMemo, useRef, useState } from 'react';

import { useDialogOpen } from '../hooks/useDialogOpen';
import { generatePassword, strengthOf } from '../lib/health';
import { FIELDS, KINDS, type Kind } from '../lib/secretKinds';
import { parseTotp } from '../lib/totp';
import type { Secret, VaultSession } from '@calimero-network/mero-pass';
import shell from '../styles/shell.module.css';
import { CloseIcon, RefreshIcon } from './icons';
import styles from './SecretForm.module.css';
import { describeError } from '../lib/errors';

const STRENGTH = [
  ['Very weak', 'var(--danger)'],
  ['Weak', 'var(--danger)'],
  ['Fair', 'var(--warning)'],
  ['Strong', 'var(--success)'],
  ['Very strong', 'var(--success)'],
] as const;

/** The generator's length range; 20 is `generatePassword`'s own default. */
const GEN_MIN = 12;
const GEN_MAX = 64;
const GEN_DEFAULT = 20;

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
  initialKind,
  open,
  onClose,
  onSuccess,
}: {
  session: VaultSession;
  /** Editing an existing secret, rather than adding one. */
  secret?: Secret;
  /** The kind a new secret starts as, e.g. the category being browsed. */
  initialKind?: Kind;
  open: boolean;
  onClose: () => void;
  /** Called with the saved secret's id. */
  onSuccess: (id: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const editing = !!secret;

  const [name, setName] = useState('');
  const [kind, setKind] = useState<Kind>('login');
  const [values, setValues] = useState<Record<string, string>>({});
  const [shown, setShown] = useState<Set<string>>(new Set());
  const [tags, setTags] = useState('');
  const [genLength, setGenLength] = useState(GEN_DEFAULT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useDialogOpen(dialogRef, open);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setShown(new Set());
    setName(secret?.name ?? '');
    setKind(((secret?.kind as Kind) || initialKind || 'login') as Kind);
    setValues(secret ? { ...secret.fields } : {});
    setTags(secret?.tags.join(', ') ?? '');
  }, [open, secret, initialKind]);

  const fields = useMemo(() => FIELDS[kind] ?? FIELDS.login, [kind]);
  // Which fields share a row. A field asks for half a row; it gets one only
  // when a neighbour does too, so no field sits alone at half width. A field
  // with a generator always takes the full row, for the generator under it.
  const halves = useMemo(() => {
    const half = fields.map((f) => !!f.half && !f.generate);
    const out = half.map(() => false);
    for (let i = 0; i < half.length; i++) {
      if (half[i] && half[i + 1]) {
        out[i] = out[i + 1] = true;
        i++;
      }
    }
    return out;
  }, [fields]);

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
      let id = secret?.id ?? '';
      if (secret) await session.update(secret, draft);
      else id = await session.add(draft);
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
            <CloseIcon size={18} />
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
          {fields.map((f, i) => {
            const value = values[f.key] ?? '';
            const visible = !f.secret || shown.has(f.key);
            const set = (v: string) =>
              setValues((cur) => ({ ...cur, [f.key]: v }));
            return (
              <div
                key={f.key}
                className={styles.field}
                style={halves[i] ? undefined : { gridColumn: '1 / -1' }}
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
                  </div>
                )}
                {f.generate && (
                  <div className={styles.generator}>
                    <div className={styles.strength}>
                      <span className={styles.meterBar}>
                        <span
                          className={styles.meterFill}
                          style={
                            value
                              ? {
                                  width: `${((strengthOf(value) + 1) / 5) * 100}%`,
                                  background: STRENGTH[strengthOf(value)][1],
                                }
                              : { width: 0 }
                          }
                        />
                      </span>
                      <span className={styles.strengthLabel}>
                        {value
                          ? STRENGTH[strengthOf(value)][0]
                          : `No ${f.label.toLowerCase()} yet`}
                      </span>
                    </div>
                    <label className={styles.length}>
                      <span>Length</span>
                      <input
                        type="range"
                        min={GEN_MIN}
                        max={GEN_MAX}
                        value={genLength}
                        onChange={(e) => setGenLength(Number(e.target.value))}
                        aria-label="Generated length"
                      />
                      <span className={styles.lengthValue}>{genLength}</span>
                    </label>
                    <button
                      type="button"
                      className={styles.inline}
                      onClick={() => set(generatePassword(genLength))}
                      data-testid="sf-generate"
                    >
                      <RefreshIcon size={14} /> Generate
                    </button>
                  </div>
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
