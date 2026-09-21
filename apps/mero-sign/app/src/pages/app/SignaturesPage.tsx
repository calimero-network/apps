import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { blobClient } from '../../lib/node';
import { useCalimero } from '../../lib/useCalimero';
import { toBlobIdHex } from '../../lib/blobIds';
import { ClientApiDataSource } from '../../api/dataSource/ClientApiDataSource';
import SignaturePadComponent from '../../components/SignaturePad';
import { AppHeader } from '../../components/AppHeader';
import styles from './AgreementsPage.module.css';

// ── The signature library ────────────────────────────────────────────────────
//
// mero-design's Teams grid, for the drawings you sign with. They live in your
// PRIVATE context and never leave it — which is the one thing this screen has
// to make obvious, and previously said nowhere.
//
// The data flow is unchanged from the screen this replaces; only the markup is.

function dataURLToBlob(dataURL: string): Blob {
  const arr = dataURL.split(',');
  const mimeMatch = arr[0].match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/png';
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) u8arr[n] = bstr.charCodeAt(n);
  return new Blob([u8arr], { type: mime });
}

interface SavedSignature {
  id: string;
  name: string;
  dataURL: string;
  createdAt: string;
}

export default function SignaturesPage() {
  const { app } = useCalimero();
  const api = useMemo(() => new ClientApiDataSource(app), [app]);

  const [signatures, setSignatures] = useState<SavedSignature[]>([]);
  const [loading, setLoading] = useState(true);
  const [padOpen, setPadOpen] = useState(false);
  // Kept because `save` is async and the pad closes on completion; surfaced as
  // the disabled state on the draw button so a slow blob upload is visible.
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<SavedSignature | null>(
    null,
  );
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  // A failed save used to be swallowed whole: the pad closed, the list was
  // unchanged, and that is indistinguishable from a save that worked and
  // produced nothing.
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const fetchSignatures = useCallback(async () => {
    try {
      setLoading(true);
      const response = await api.listSignatures();
      if (response.error) {
        // ⚠️ REPORTED, not swallowed into an empty list. "No signatures yet"
        // under a failed read tells somebody their signatures are gone.
        setError(response.error.message);
        setSignatures([]);
        return;
      }

      // ⚠️ NO ENVELOPE, NO CASTS. This used to probe `.output` then `.result`
      // and then re-declare the row shape by hand — including
      // `blob_id: string | number[]`, which is how the encoding bug got in.
      // The generated client returns `SignatureRecord[]` straight from the
      // ABI, so the shape is the contract's, not this file's guess.
      const rows = response.data ?? [];
      if (rows.length === 0) {
        setSignatures([]);
        return;
      }

      const withImages = await Promise.all(
        rows.map(async (sig) => {
          let dataURL = '';
          // ⚠️ HEX. This was `bs58.encode`, and the node answers a base58
          // blob id with "Failed to decode blob ID (expected hex) … Odd
          // number of digits" — which the empty catch below then swallowed.
          // That is the whole of "my signature saved but is never displayed":
          // the row listed, the image 500'd, and nothing said so.
          // `blob_id` is BYTES per the ABI — `CalimeroBytes`, not a string.
          // That divergence was the bug; the type carries it now.
          const blobId = toBlobIdHex(
            typeof sig.blob_id === 'string'
              ? sig.blob_id
              : sig.blob_id.toArray(),
          );
          try {
            const contextId = localStorage.getItem('defaultContextId') || '';
            const blob = blobId
              ? await blobClient.downloadBlob(blobId, contextId)
              : null;
            if (blob) {
              dataURL = await new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.readAsDataURL(blob);
              });
            }
          } catch (e) {
            // Still lists as a named row — a library that hides a signature
            // because its image would not load is worse. But it is REPORTED
            // now: silence here is what let the encoding bug live.
            console.error(`Could not load signature image ${blobId}:`, e);
          }
          return {
            id: String(sig.id),
            name: sig.name,
            dataURL,
            createdAt: new Date(
              Number(sig.created_at) / 1_000_000,
            ).toLocaleDateString(),
          };
        }),
      );
      setSignatures(withImages);
    } catch {
      setSignatures([]);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void fetchSignatures();
  }, [fetchSignatures]);

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  const save = useCallback(
    async (signatureData: string) => {
      setSaving(true);
      setError(null);
      try {
        const blob = dataURLToBlob(signatureData);
        const file = new File([blob], 'signature.png', { type: blob.type });
        // The PRIVATE context: a signature is yours and is announced
        // nowhere else. `''` would store it on this node with no context at
        // all, which is a different thing from "my own context".
        const contextId = localStorage.getItem('defaultContextId') || '';
        const uploaded = await blobClient.uploadBlob(file, () => {}, contextId);
        if (uploaded.error || !uploaded.data?.blobId) {
          throw new Error(uploaded.error?.message ?? 'Upload failed');
        }
        // ⚠️ HEX, verbatim. This was converted to base58, which is what made
        // every saved signature unreadable on the way back out.
        const blobId = toBlobIdHex(uploaded.data.blobId);
        if (!blobId) {
          throw new Error(
            `The node returned a blob id this app cannot use: ${uploaded.data.blobId}`,
          );
        }
        await api.createSignature(
          `Signature ${signatures.length + 1}`,
          blobId,
          file.size,
        );
        await fetchSignatures();
      } catch (e) {
        // Was swallowed entirely: a failed save closed the pad and left the
        // list unchanged, which is indistinguishable from a save that worked
        // and produced nothing.
        setError(
          e instanceof Error ? e.message : 'Could not save that signature.',
        );
      } finally {
        setSaving(false);
        setPadOpen(false);
      }
    },
    [api, signatures.length, fetchSignatures],
  );

  const remove = useCallback(async () => {
    if (!confirmDelete) return;
    try {
      await api.deleteSignature(Number(confirmDelete.id));
      await fetchSignatures();
    } finally {
      setConfirmDelete(null);
    }
  }, [api, confirmDelete, fetchSignatures]);

  return (
    <div className={styles.root}>
      <AppHeader back={{ label: 'Agreements', to: '/agreements' }} />

      <main className={styles.main}>
        <h1 className={styles.title}>Your signatures</h1>
        <p className={styles.subtitle}>
          The drawings you sign documents with. They are stored in your own
          private context and never leave your node.
        </p>

        <div className={styles.createRow}>
          <button
            className={styles.btn}
            onClick={() => setPadOpen(true)}
            disabled={saving}
            data-testid="new-signature"
          >
            {saving ? <span className={styles.spinner} /> : null}
            {saving ? 'Saving…' : 'Draw a new signature'}
          </button>
        </div>

        {error && (
          <p className={styles.error} data-testid="signature-error">
            {error}
          </p>
        )}

        {loading ? (
          <p className={styles.empty}>Loading…</p>
        ) : signatures.length === 0 ? (
          <p className={styles.empty} data-testid="signatures-empty">
            No signatures yet. Draw one and it will be offered whenever you sign
            a document.
          </p>
        ) : (
          <div className={styles.grid} data-testid="signatures-grid">
            {signatures.map((sig) => (
              <div
                key={sig.id}
                className={styles.cardWrap}
                ref={menuOpenId === sig.id ? menuRef : null}
                data-testid="signature-card"
              >
                <div className={styles.card} style={{ cursor: 'default' }}>
                  {sig.dataURL ? (
                    <img
                      src={sig.dataURL}
                      alt={sig.name}
                      style={{
                        width: '100%',
                        height: 56,
                        objectFit: 'contain',
                        marginBottom: 10,
                      }}
                    />
                  ) : (
                    <span
                      style={{
                        width: '100%',
                        height: 56,
                        marginBottom: 10,
                        background:
                          'linear-gradient(135deg, #f5f5f5 0%, #ececec 100%)',
                        borderRadius: 4,
                      }}
                    />
                  )}
                  <span className={styles.cardName}>{sig.name}</span>
                  <span className={styles.cardSub}>{sig.createdAt}</span>
                </div>
                <button
                  className={styles.menuBtn}
                  title="More options"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpenId(menuOpenId === sig.id ? null : sig.id);
                  }}
                >
                  ⋯
                </button>
                {menuOpenId === sig.id && (
                  <div className={styles.dropdown}>
                    <button
                      className={`${styles.dropdownItem} ${styles.dropdownDanger}`}
                      onClick={() => {
                        setMenuOpenId(null);
                        setConfirmDelete(sig);
                      }}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>

      <SignaturePadComponent
        isOpen={padOpen}
        onSave={(data: string) => void save(data)}
        onCancel={() => setPadOpen(false)}
      />

      {confirmDelete && (
        <div
          className={styles.modalBackdrop}
          onClick={() => setConfirmDelete(null)}
        >
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>
              Delete “{confirmDelete.name}”?
            </h2>
            <p className={styles.modalDesc}>
              Documents you already signed with it keep their signature. This
              only removes it from your library.
            </p>
            <div className={styles.modalRow}>
              <button
                className={styles.btnGhost}
                onClick={() => setConfirmDelete(null)}
              >
                Cancel
              </button>
              <button
                className={styles.btn}
                style={{ background: '#c0392b' }}
                onClick={() => void remove()}
                data-testid="confirm-delete-signature"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
