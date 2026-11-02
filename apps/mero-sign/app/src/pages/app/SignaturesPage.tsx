import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MoreHorizontal, PenLine, Trash2 } from 'lucide-react';
import { useCalimero } from '../../lib/useCalimero';
import { saveSignature, withImages } from '../../lib/signatureLibrary';
import { ClientApiDataSource } from '../../api/dataSource/ClientApiDataSource';
import SignaturePadComponent from '../../components/SignaturePad';
import { AppShell } from '../../components/shell/AppShell';
import styles from './AgreementsPage.module.css';

// ── The signature library ────────────────────────────────────────────────────
//
// mero-design's Teams grid, for the drawings you sign with. They live in your
// personal library, an app instance only your account reaches.

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

      // The images are blobs of the personal library.
      const rows = response.data ?? [];
      setSignatures(await withImages(api, rows));
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
        await saveSignature(api, signatureData, `Signature ${signatures.length + 1}`);
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
    <AppShell back={{ label: 'Agreements', to: '/agreements' }}>
      <main className={styles.main}>
        <header className={styles.pageHead}>
          <span className={styles.eyebrow}>Signature library</span>
          <h1 className={styles.title}>Your signatures</h1>
          <p className={styles.subtitle}>
            The drawings you sign documents with. They are stored in your own
            personal library, which only your account can open.
          </p>
        </header>

        <div className={styles.createRow}>
          <button
            className={styles.btn}
            onClick={() => setPadOpen(true)}
            disabled={saving}
            data-testid="new-signature"
          >
            {saving ? (
              <span className={styles.spinner} />
            ) : (
              <PenLine size={16} />
            )}
            {saving ? 'Saving…' : 'Draw a new signature'}
          </button>
        </div>

        {error && (
          <p className={styles.error} data-testid="signature-error">
            {error}
          </p>
        )}

        {loading ? (
          <div className={styles.skeletonGrid} aria-label="Loading…">
            <span className={styles.skeleton} />
            <span className={styles.skeleton} />
          </div>
        ) : signatures.length === 0 ? (
          <div className={styles.emptyState}>
            <span className={styles.emptyIcon}>
              <PenLine size={24} />
            </span>
            <p className={styles.emptyTitle}>Your library is empty</p>
            <p className={styles.empty} data-testid="signatures-empty">
              No signatures yet. Draw one and it will be offered whenever you
              sign a document.
            </p>
          </div>
        ) : (
          <div className={styles.grid} data-testid="signatures-grid">
            {signatures.map((sig) => (
              <div
                key={sig.id}
                className={styles.cardWrap}
                ref={menuOpenId === sig.id ? menuRef : null}
                data-testid="signature-card"
              >
                <div className={`${styles.card} ${styles.cardStatic}`}>
                  <span className={styles.sigPaper}>
                    {sig.dataURL ? <img src={sig.dataURL} alt={sig.name} /> : null}
                  </span>
                  <span className={styles.cardName}>{sig.name}</span>
                  <span className={styles.cardSub}>{sig.createdAt}</span>
                </div>
                <button
                  className={`${styles.menuBtn} ${
                    menuOpenId === sig.id ? styles.menuBtnOpen : ''
                  }`}
                  title="More options"
                  aria-label="More options"
                  aria-expanded={menuOpenId === sig.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpenId(menuOpenId === sig.id ? null : sig.id);
                  }}
                >
                  <MoreHorizontal size={18} />
                </button>
                {menuOpenId === sig.id && (
                  <div className={styles.dropdown} role="menu">
                    <button
                      className={`${styles.dropdownItem} ${styles.dropdownDanger}`}
                      role="menuitem"
                      onClick={() => {
                        setMenuOpenId(null);
                        setConfirmDelete(sig);
                      }}
                    >
                      <Trash2 size={16} />
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
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-signature-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className={styles.modalTitle} id="delete-signature-title">
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
                className={`${styles.btn} ${styles.btnDanger}`}
                onClick={() => void remove()}
                data-testid="confirm-delete-signature"
              >
                <Trash2 size={16} />
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
