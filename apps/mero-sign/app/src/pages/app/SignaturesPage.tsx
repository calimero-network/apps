import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { blobClient, useCalimero } from '@calimero-network/calimero-client';
import bs58 from 'bs58';
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

/**
 * Normalize a blob id to base58 for the contract.
 *
 * The blob API returns hex (64 chars) or base58; `create_signature` takes
 * base58. Unchanged from the previous screen — moved, not rewritten.
 */
function normalizeBlobIdToBase58(blobId: string): string {
  const cleanId = blobId.startsWith('0x') ? blobId.slice(2) : blobId;
  if (/^[0-9a-fA-F]{64}$/.test(cleanId)) {
    const bytes = new Uint8Array(
      cleanId.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || [],
    );
    return bs58.encode(bytes);
  }
  return cleanId;
}

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
  const menuRef = useRef<HTMLDivElement>(null);

  const fetchSignatures = useCallback(async () => {
    try {
      setLoading(true);
      const response = await api.listSignatures();

      let rows: unknown[] = [];
      const data = response.data as unknown;
      if (Array.isArray(data)) rows = data;
      else if (data && typeof data === 'object') {
        const obj = data as { output?: unknown; result?: unknown };
        if (Array.isArray(obj.output)) rows = obj.output;
        else if (Array.isArray(obj.result)) rows = obj.result;
      }

      if (rows.length === 0) {
        setSignatures([]);
        return;
      }

      const withImages = await Promise.all(
        rows.map(async (raw) => {
          const sig = raw as {
            id: number | string;
            name: string;
            blob_id: string | number[];
            created_at: number | string;
          };
          let dataURL = '';
          try {
            const blobId =
              typeof sig.blob_id === 'string'
                ? sig.blob_id
                : bs58.encode(new Uint8Array(sig.blob_id));
            const contextId = localStorage.getItem('defaultContextId') || '';
            const blob = await blobClient.downloadBlob(blobId, contextId);
            if (blob) {
              dataURL = await new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.readAsDataURL(blob);
              });
            }
          } catch {
            /* a signature with no image still lists, as a named row */
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
      try {
        const blob = dataURLToBlob(signatureData);
        const file = new File([blob], 'signature.png', { type: blob.type });
        const uploaded = await blobClient.uploadBlob(file, () => {}, '');
        if (uploaded.error || !uploaded.data?.blobId) {
          throw new Error(uploaded.error?.message ?? 'Upload failed');
        }
        await api.createSignature(
          `Signature ${signatures.length + 1}`,
          normalizeBlobIdToBase58(uploaded.data.blobId),
          file.size,
        );
        await fetchSignatures();
      } catch {
        /* the pad stays closed; the list is unchanged */
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
