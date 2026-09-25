import { useMemo, useState } from 'react';

import { analyse, breachedIds } from '../lib/health';
import type { Secret } from '../lib/vaultSession';
import shell from '../styles/shell.module.css';
import styles from '../pages/vault/vault.module.css';

const ISSUE_TEXT: Record<string, string> = {
  weak: 'weak',
  reused: 'reused',
  old: 'older than a year',
  breached: 'found in a breach',
};

/** Weak, reused, old and (on request) breached passwords in this vault. */
export default function HealthPanel({
  secrets,
  onOpen,
}: {
  secrets: Secret[];
  onOpen: (id: string) => void;
}) {
  const [breached, setBreached] = useState<Set<string>>(new Set());
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rows = useMemo(() => analyse(secrets, breached), [secrets, breached]);
  const flagged = rows.filter((r) => r.issues.length > 0);

  const check = async () => {
    setChecking(true);
    setError(null);
    try {
      setBreached(await breachedIds(secrets));
      setChecked(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  };

  return (
    <section data-testid="health-panel">
      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.statValue}>{rows.length}</span>
          <span className={styles.statLabel}>Passwords</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{flagged.length}</span>
          <span className={styles.statLabel}>Need attention</span>
        </div>
      </div>
      <div className={styles.toolbar}>
        <button
          type="button"
          className={shell.btnGhost}
          onClick={() => void check()}
          disabled={checking}
          data-testid="breach-check"
        >
          {checking
            ? 'Checking…'
            : checked
              ? 'Check breaches again'
              : 'Check for breaches'}
        </button>
        <span className={shell.rowSub}>
          Sends only the first 5 characters of each password’s SHA-1 to Have I
          Been Pwned; the match happens here.
        </span>
      </div>
      {error && <p className={shell.error}>{error}</p>}
      {flagged.length === 0 ? (
        <p className={shell.empty}>
          {rows.length ? 'Nothing to fix.' : 'No passwords in this vault yet.'}
        </p>
      ) : (
        flagged.map((r) => (
          <div key={r.id} className={shell.row}>
            <div className={shell.rowMain}>
              <div className={shell.rowName}>{r.name}</div>
              <div>
                {r.issues.map((i) => (
                  <span
                    key={i}
                    className={`${styles.healthIssue} ${i === 'breached' || i === 'weak' ? styles.healthBad : ''}`}
                  >
                    {ISSUE_TEXT[i]}
                  </span>
                ))}
              </div>
            </div>
            <div className={shell.rowActions}>
              <button
                type="button"
                className={shell.btnGhost}
                onClick={() => onOpen(r.id)}
              >
                Open
              </button>
            </div>
          </div>
        ))
      )}
    </section>
  );
}
