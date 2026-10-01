import { useRef, useState } from 'react';

import { decryptExport, encryptExport, importCsv } from '../lib/portability';
import type { Secret, SecretDraft, VaultSession } from '../lib/vaultSession';
import shell from '../styles/shell.module.css';
import styles from '../pages/vault/vault.module.css';
import { describeError } from '../lib/errors';

/**
 * Bring secrets in from Bitwarden, 1Password or a browser, move them between
 * vaults with an encrypted file, and take an encrypted backup.
 *
 * Files are read in the browser. Nothing leaves it until each draft is sealed
 * and added like any other secret.
 */
export default function ImportExport({
  session,
  secrets,
  vaultName,
  onDone,
}: {
  session: VaultSession;
  secrets: Secret[];
  vaultName: string;
  onDone: () => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [drafts, setDrafts] = useState<SecretDraft[] | null>(null);
  const [source, setSource] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [pass, setPass] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const read = async (file: File) => {
    setError(null);
    setDrafts(null);
    const text = await file.text();
    if (text.trimStart().startsWith('{')) {
      setPending(text);
      setSource('Mero Pass export');
      return;
    }
    const res = importCsv(text);
    if (res.source === 'unknown' || res.drafts.length === 0) {
      setError(
        'Could not recognise this file. Export CSV from Bitwarden, 1Password or your browser.',
      );
      return;
    }
    setSource(res.source);
    setDrafts(res.drafts);
  };

  const openExport = async () => {
    if (!pending) return;
    try {
      setDrafts(await decryptExport(pending, pass));
      setPending(null);
      setPass('');
    } catch (e) {
      setError(describeError(e));
    }
  };

  const add = async () => {
    if (!drafts) return;
    let n = 0;
    for (const d of drafts) {
      setStatus(`Encrypting and adding ${n + 1} of ${drafts.length}…`);
      await session.add(d);
      n += 1;
    }
    setStatus(`Added ${n} secrets.`);
    setDrafts(null);
    onDone();
  };

  const backup = async () => {
    setError(null);
    try {
      const file = await encryptExport(
        secrets.filter((s) => !s.trashed),
        pass,
      );
      const url = URL.createObjectURL(
        new Blob([file], { type: 'application/json' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = `${vaultName.replace(/[^\w-]+/g, '-') || 'vault'}.meropass.json`;
      a.click();
      URL.revokeObjectURL(url);
      setPass('');
      setStatus('Encrypted backup downloaded.');
    } catch (e) {
      setError(describeError(e));
    }
  };

  return (
    <section data-testid="import-export">
      {error && <p className={shell.error}>{error}</p>}
      {status && <p className={shell.status}>{status}</p>}

      <h3 className={shell.sectionLabel}>Import</h3>
      <div className={styles.toolbar}>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.json,text/csv,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void read(f);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          className={shell.btnGhost}
          onClick={() => fileRef.current?.click()}
          disabled={!session.canWrite}
        >
          Choose a file…
        </button>
        <span className={shell.rowSub}>
          Bitwarden, 1Password or Chrome/Edge CSV, or a Mero Pass encrypted
          export.
        </span>
      </div>
      {pending && (
        <div className={shell.createRow}>
          <input
            className={shell.input}
            type="password"
            placeholder="Export passphrase"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
          />
          <button
            type="button"
            className={shell.btn}
            onClick={() => void openExport()}
          >
            Open
          </button>
        </div>
      )}
      {drafts && (
        <div className={styles.banner}>
          Found {drafts.length} items in a {source} file.{' '}
          <button
            type="button"
            className={shell.btn}
            onClick={() => void add()}
          >
            Encrypt and add all
          </button>{' '}
          <button
            type="button"
            className={shell.btnGhost}
            onClick={() => setDrafts(null)}
          >
            Cancel
          </button>
          <p className={shell.rowSub}>
            Delete the CSV afterwards — it holds every password in plain text.
          </p>
        </div>
      )}

      <h3 className={shell.sectionLabel}>Encrypted backup</h3>
      <p className={shell.sectionHint}>
        A file sealed under a passphrase you choose. There is no plain-text
        export: a readable copy of a password manager outlives every protection
        this app has.
      </p>
      {!pending && (
        <div className={shell.createRow}>
          <input
            className={shell.input}
            type="password"
            placeholder="Backup passphrase (8+ characters)"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            data-testid="backup-pass"
          />
          <button
            type="button"
            className={shell.btnGhost}
            onClick={() => void backup()}
            disabled={pass.length < 8 || secrets.length === 0}
          >
            Download
          </button>
        </div>
      )}
    </section>
  );
}
