import { useEffect, useRef, useState } from 'react';

import { useDialogOpen } from '../hooks/useDialogOpen';
import { copySecret } from '../lib/clipboard';
import { createShareFragment, shareUrl } from '../lib/shareLink';
import type { Secret } from '../lib/vaultSession';
import shell from '../styles/shell.module.css';
import styles from './SecretForm.module.css';

const EXPIRY = [
  { ms: 60 * 60 * 1000, label: '1 hour' },
  { ms: 24 * 60 * 60 * 1000, label: '1 day' },
  { ms: 7 * 24 * 60 * 60 * 1000, label: '7 days' },
];

/**
 * Share ONE secret with someone outside the team, as a self-contained,
 * encrypted link. See `lib/shareLink` for what the expiry can and cannot do —
 * the dialog repeats it, because a sender who believes a link is revocable
 * will send it more carelessly than one who knows it is not.
 */
export default function ShareModal({
  secret,
  onClose,
}: {
  secret: Secret | null;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [expiry, setExpiry] = useState(EXPIRY[1].ms);
  const [usePass, setUsePass] = useState(true);
  const [pass, setPass] = useState('');
  const [fields, setFields] = useState<Set<string>>(new Set());
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useDialogOpen(dialogRef, !!secret);

  useEffect(() => {
    setLink(null);
    setError(null);
    setPass('');
    setFields(
      new Set(
        secret ? Object.keys(secret.fields).filter((f) => f !== 'notes') : [],
      ),
    );
  }, [secret]);

  if (!secret) return null;

  const create = async () => {
    setError(null);
    if (usePass && pass.length < 6) {
      setError(
        'Use a passphrase of at least 6 characters, and tell it to them another way.',
      );
      return;
    }
    const chosen = Object.fromEntries(
      Object.entries(secret.fields).filter(([k]) => fields.has(k)),
    );
    const frag = await createShareFragment(
      {
        name: secret.name,
        kind: secret.kind,
        fields: chosen,
        expiresAt: Date.now() + expiry,
      },
      usePass ? pass : undefined,
    );
    setLink(shareUrl(frag));
  };

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
      data-testid="share-modal"
    >
      <div className={styles.body}>
        <header className={styles.head}>
          <h2 className={styles.title}>Share “{secret.name}”</h2>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        <p className={styles.hint}>
          The link carries the secret itself, encrypted, after the{' '}
          <code>#</code> — the part a browser never sends to any server. It
          needs no account and no invitation. It{' '}
          <strong>cannot be revoked</strong> once sent: if it reaches the wrong
          person, change the password.
        </p>

        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.field}>
          <span className={styles.label}>Include</span>
          {Object.keys(secret.fields).map((f) => (
            <label key={f} className={styles.hint}>
              <input
                type="checkbox"
                checked={fields.has(f)}
                onChange={(e) =>
                  setFields((s) => {
                    const n = new Set(s);
                    if (e.target.checked) n.add(f);
                    else n.delete(f);
                    return n;
                  })
                }
              />{' '}
              {f.replace(/_/g, ' ')}
            </label>
          ))}
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="share-expiry">
            Stops opening after
          </label>
          <select
            id="share-expiry"
            className={styles.select}
            value={expiry}
            onChange={(e) => setExpiry(Number(e.target.value))}
          >
            {EXPIRY.map((x) => (
              <option key={x.ms} value={x.ms}>
                {x.label}
              </option>
            ))}
          </select>
        </div>

        <label className={styles.hint}>
          <input
            type="checkbox"
            checked={usePass}
            onChange={(e) => setUsePass(e.target.checked)}
          />{' '}
          Require a passphrase (recommended — then the link alone is useless)
        </label>
        {usePass && (
          <input
            className={styles.input}
            type="password"
            placeholder="Passphrase you will tell them separately"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            data-testid="share-pass"
          />
        )}

        {link && (
          <div className={styles.field}>
            <span className={styles.label}>Link</span>
            <input
              className={styles.input}
              readOnly
              value={link}
              data-testid="share-link"
            />
          </div>
        )}

        <div className={styles.actions}>
          <button type="button" className={shell.btnGhost} onClick={onClose}>
            Close
          </button>
          {link ? (
            <button
              type="button"
              className={shell.btn}
              onClick={() => void copySecret(link, 5 * 60_000)}
            >
              Copy link
            </button>
          ) : (
            <button
              type="button"
              className={shell.btn}
              onClick={() => void create()}
              disabled={fields.size === 0}
              data-testid="share-create"
            >
              Create link
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
