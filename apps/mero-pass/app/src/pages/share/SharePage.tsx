import { useEffect, useState } from 'react';

import { copySecret } from '../../lib/clipboard';
import {
  type SharedSecret,
  ShareError,
  needsPassphrase,
  openShareFragment,
} from '../../lib/shareLink';
import shell from '../../styles/shell.module.css';
import styles from '../vault/vault.module.css';
import {
  AlertTriangleIcon,
  ClockIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  ShieldIcon,
} from '../../components/icons';

/**
 * Opens a share link. Public — no node, no login — because the whole secret is
 * in the URL fragment, sealed, and this page is the only thing that reads it.
 *
 * The fragment is removed from the address bar as soon as it is read, so a
 * later screenshot, a history sync or an over-the-shoulder glance does not
 * carry the key along with it.
 */
export default function SharePage() {
  const [fragment] = useState(() => window.location.hash.replace(/^#/, ''));
  const [secret, setSecret] = useState<SharedSecret | null>(null);
  const [pass, setPass] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const needsPass = fragment ? needsPassphrase(fragment) : false;

  useEffect(() => {
    if (window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  const open = async () => {
    setError(null);
    try {
      setSecret(
        await openShareFragment(fragment, needsPass ? pass : undefined),
      );
    } catch (e) {
      setError(
        e instanceof ShareError ? e.message : 'This link could not be opened.',
      );
    }
  };

  useEffect(() => {
    if (fragment && !needsPass) void open();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={shell.root}>
      <header className={shell.header}>
        <span className={shell.brand}>
          <span className={shell.brandTile} aria-hidden="true">
            <LockIcon size={15} strokeWidth={2} />
          </span>
          <span className={shell.brandName}>Mero Pass</span>
        </span>
      </header>
      <main className={shell.main} style={{ maxWidth: 640 }}>
        <div className={shell.titleRow}>
          <span className={shell.titleIcon} aria-hidden="true">
            <ShieldIcon size={22} />
          </span>
          <div>
            <h1 className={shell.title}>Shared with you</h1>
            <p className={shell.subtitle}>
              Someone sent you a secret through Mero Pass. It was decrypted in
              this browser; nothing was fetched from a server.
            </p>
          </div>
        </div>
        {!fragment && (
          <p className={shell.error}>
            <AlertTriangleIcon size={16} />
            <span>This link is empty.</span>
          </p>
        )}
        {error && (
          <p className={shell.error}>
            <AlertTriangleIcon size={16} />
            <span>{error}</span>
          </p>
        )}
        {fragment && needsPass && !secret && (
          <div className={shell.createRow}>
            <input
              className={shell.input}
              type="password"
              placeholder="Passphrase they gave you"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void open()}
              autoFocus
            />
            <button
              type="button"
              className={shell.btn}
              onClick={() => void open()}
            >
              Open
            </button>
          </div>
        )}
        {secret && (
          <div className={styles.secret}>
            <div className={styles.secretHead}>
              <span className={styles.secretIcon} aria-hidden="true">
                <LockIcon size={18} />
              </span>
              <div className={styles.secretName}>{secret.name}</div>
            </div>
            <div className={styles.secretBody}>
              {Object.entries(secret.fields).map(([k, v]) => (
                <div key={k} className={styles.field}>
                  <span className={styles.fieldName}>
                    {k.replace(/_/g, ' ')}
                  </span>
                  <span
                    className={`${styles.fieldValue} ${revealed ? '' : styles.fieldMasked}`}
                  >
                    {revealed ? v : '••••••••••••'}
                  </span>
                  <span className={styles.fieldActions}>
                    <button
                      type="button"
                      className={styles.mini}
                      onClick={() => void copySecret(v)}
                    >
                      <CopyIcon size={14} />
                      Copy
                    </button>
                  </span>
                </div>
              ))}
            </div>
            <div className={styles.secretFooter}>
              <span className={styles.secretFooterNote}>
                <ClockIcon size={14} />
                This link stops opening{' '}
                {new Date(secret.expiresAt).toLocaleString()}.
              </span>
              <button
                type="button"
                className={styles.mini}
                onClick={() => setRevealed((r) => !r)}
              >
                {revealed ? <EyeOffIcon size={14} /> : <EyeIcon size={14} />}
                {revealed ? 'Hide' : 'Reveal'}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
