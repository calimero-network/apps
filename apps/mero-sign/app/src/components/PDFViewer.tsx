import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react';
import {
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  Download,
  X,
  FileText,
  AlertCircle,
  Save,
  PenTool,
  Upload,
  MessageSquare,
  MousePointerClick,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  pdfService,
  type PDFPage,
  type SignaturePosition,
} from '../services/pdfService';
import SignatureOverlay from './SignatureOverlay';
import SignaturePadComponent from './SignaturePad';
import { pdfjsLib } from '../services/pdfjs';
import GlassDialog from './ui/GlassDialog';
import ui from './ui/controls.module.css';
import v from './PDFViewer.module.css';
import { DocumentService } from '../api/documentService';
import { ClientApiDataSource } from '../api/dataSource/ClientApiDataSource';
import { blobClient } from '../lib/node';
import { useCalimero } from '../lib/useCalimero';
import { defaultContextIdFor } from '../api/defaultContextService';
import ConsentModal from './ConsentModal';
import LegalChatbot, { LEGAL_ASSISTANT_ENABLED } from './LegalChatbot';
import { toBlobIdHex } from '../lib/blobIds';

interface SavedSignature {
  id: string;
  name: string;
  dataURL: string;
  createdAt: string;
}

interface PDFViewerProps {
  file: File | null;
  onClose?: () => void;
  className?: string;
  title?: string;
  showDownload?: boolean;
  showClose?: boolean;
  maxHeight?: string;

  signatures?: SignaturePosition[];
  onSignaturePlace?: (signature: SignaturePosition) => void;
  onSignatureUpdate?: (signature: SignaturePosition) => void;
  onSignatureDelete?: (signatureId: string) => void;
  selectedSignature?: string | null;
  showSignatureControls?: boolean;
  onSaveSignedPDF?: (blob: Blob) => void;
  contextId?: string;
  documentId?: string;
  documentHash?: string;
  showSaveToContext?: boolean;
  onDocumentSaved?: () => void;
}

const PDFViewer: React.FC<PDFViewerProps> = ({
  file,
  onClose,
  className = '',
  title,
  showDownload = true,
  showClose = true,
  maxHeight = '70vh',
  signatures = [],
  onSignaturePlace,
  onSignatureUpdate,
  onSignatureDelete,
  selectedSignature,
  showSignatureControls = false,
  onSaveSignedPDF,
  contextId,
  documentId,
  documentHash,
  showSaveToContext = false,
  onDocumentSaved,
}) => {
  const { app } = useCalimero();
  const api = useMemo(() => new ClientApiDataSource(app), [app]);
  const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pages, setPages] = useState<PDFPage[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1.2);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSignatureId, setSelectedSignatureId] = useState<string | null>(
    null,
  );
  const [savingPDF, setSavingPDF] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const [documentSignatures, setDocumentSignatures] = useState<
    SignaturePosition[]
  >([]);
  const [showSignatureOptions, setShowSignatureOptions] = useState(false);
  const [showSignaturePad, setShowSignaturePad] = useState(false);
  const [savedSignatures, setSavedSignatures] = useState<SavedSignature[]>([]);
  const [selectedSavedSignature, setSelectedSavedSignature] = useState<
    string | null
  >(null);
  const [signingMode, setSigningMode] = useState(false);
  const [showMobileActions, setShowMobileActions] = useState(false);
  const [savingToContext, setSavingToContext] = useState(false);
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [showChatbot, setShowChatbot] = useState(false);

  const documentService = new DocumentService();

  const agreementContextID =
    localStorage.getItem('agreementContextID') || undefined;
  const agreementContextUserID =
    localStorage.getItem('agreementContextUserID') || undefined;

  const loadPDF = useCallback(async () => {
    if (!file) return;

    setLoading(true);
    setError(null);

    try {
      const pdfDoc = await pdfService.loadPDF(file);

      // ⚠️ FIT A NARROW SCREEN BY ZOOM, NEVER BY SQUEEZING. The page is
      // shown at `width * scale` CSS pixels, and signature placement and
      // dragging assume exactly that size. A phone used to clamp it with
      // `max-width: 100%`, which squashed the page sideways and put every
      // placed signature somewhere other than where it was tapped. So pick a
      // scale the screen can hold; the stage scrolls if you zoom past it.
      try {
        const first = await pdfDoc.getPage(1);
        const pageWidth = first.getViewport({ scale: 1 }).width;
        const room = window.innerWidth - 32;
        // Shown width is pageWidth * scale², see the canvas style below.
        if (pageWidth * 1.2 * 1.2 > room) {
          const fit = Math.floor(Math.sqrt(room / pageWidth) * 20) / 20;
          setScale(Math.max(0.5, Math.min(1.2, fit)));
        }
      } catch {
        /* the default scale still works; the page just scrolls */
      }

      setPdf(pdfDoc);
      setCurrentPage(1);
    } catch (err) {
      console.error('Error loading PDF:', err);
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to load PDF. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  }, [file]);

  const renderPages = useCallback(async () => {
    if (!pdf) return;

    try {
      // The page is shown at `width * scale` CSS pixels (see the canvas
      // below), so it needs `scale * devicePixelRatio` times its logical
      // pixels to stay sharp.
      const pixelRatio = scale * (window.devicePixelRatio || 1);
      const renderedPages = await pdfService.renderAllPages(
        pdf,
        scale,
        pixelRatio,
      );

      setPages(renderedPages);
    } catch (err) {
      console.error('Error rendering pages:', err);
      setError('Failed to render PDF pages.');
    }
  }, [pdf, scale]);

  const handleSignatureSelect = useCallback((signatureId: string) => {
    setSelectedSignatureId(signatureId);
  }, []);

  const handleSignatureUpdate = useCallback(
    (updatedSignature: SignaturePosition) => {
      setDocumentSignatures((prev) =>
        prev.map((sig) =>
          sig.id === updatedSignature.id ? updatedSignature : sig,
        ),
      );
      if (onSignatureUpdate) {
        onSignatureUpdate(updatedSignature);
      }
    },
    [onSignatureUpdate],
  );

  const handleSignatureDelete = useCallback(
    (signatureId: string) => {
      setDocumentSignatures((prev) =>
        prev.filter((sig) => sig.id !== signatureId),
      );
      setSelectedSignatureId(null);
      if (onSignatureDelete) {
        onSignatureDelete(signatureId);
      }
    },
    [onSignatureDelete],
  );

  const handleSignaturePlace = useCallback((signature: SignaturePosition) => {
    setDocumentSignatures((prev) => [...prev, signature]);
    setSigningMode(false);
    setSelectedSavedSignature(null);
  }, []);

  const handleCanvasClick = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      if (selectedSignatureId) {
        setSelectedSignatureId(null);
      }

      if (signingMode && selectedSavedSignature) {
        const target = event.target as HTMLElement;
        if (target.closest('.signature-overlay')) {
          return;
        }

        const canvas = event.currentTarget;
        const rect = canvas.getBoundingClientRect();
        const clickX = event.clientX - rect.left;
        const clickY = event.clientY - rect.top;

        const canvasX = (clickX / rect.width) * canvas.width;
        const canvasY = (clickY / rect.height) * canvas.height;

        const signaturePosition: SignaturePosition = {
          id: Date.now().toString(),
          x: canvasX - 50,
          y: canvasY - 25,
          width: 100,
          height: 50,
          pageNumber: currentPage,
          signatureData: selectedSavedSignature,
          timestamp: Date.now(),
        };

        handleSignaturePlace(signaturePosition);
        return;
      }

      if (!selectedSignature || !onSignaturePlace) return;

      const target = event.target as HTMLElement;
      if (target.closest('.signature-overlay')) {
        return;
      }

      const canvas = event.currentTarget;
      const rect = canvas.getBoundingClientRect();
      const clickX = event.clientX - rect.left;
      const clickY = event.clientY - rect.top;

      const canvasX = (clickX / rect.width) * canvas.width;
      const canvasY = (clickY / rect.height) * canvas.height;

      const signaturePosition: SignaturePosition = {
        id: Date.now().toString(),
        x: canvasX - 50,
        y: canvasY - 25,
        width: 100,
        height: 50,
        pageNumber: currentPage,
        signatureData: selectedSignature,
        timestamp: Date.now(),
      };

      onSignaturePlace(signaturePosition);
    },
    [
      selectedSignature,
      selectedSignatureId,
      currentPage,
      onSignaturePlace,
      signingMode,
      selectedSavedSignature,
      handleSignaturePlace,
    ],
  );

  const handleCanvasTouch = useCallback(
    (event: React.TouchEvent<HTMLCanvasElement>) => {
      if (selectedSignatureId) {
        setSelectedSignatureId(null);
      }

      if (signingMode && selectedSavedSignature) {
        const target = event.target as HTMLElement;
        if (target.closest('.signature-overlay')) {
          return;
        }

        const canvas = event.currentTarget;
        const rect = canvas.getBoundingClientRect();
        const touch = event.touches[0];
        const touchX = touch.clientX - rect.left;
        const touchY = touch.clientY - rect.top;

        const canvasX = (touchX / rect.width) * canvas.width;
        const canvasY = (touchY / rect.height) * canvas.height;

        const signaturePosition: SignaturePosition = {
          id: Date.now().toString(),
          x: canvasX - 50,
          y: canvasY - 25,
          width: 100,
          height: 50,
          pageNumber: currentPage,
          signatureData: selectedSavedSignature,
          timestamp: Date.now(),
        };

        handleSignaturePlace(signaturePosition);
        return;
      }
    },
    [
      selectedSignatureId,
      signingMode,
      selectedSavedSignature,
      currentPage,
      handleSignaturePlace,
    ],
  );

  const handleSaveSignedPDF = useCallback(async () => {
    if (!file || !onSaveSignedPDF || signatures.length === 0) return;

    setSavingPDF(true);
    try {
      const signedPDFBlob = await pdfService.generateSignedPDF(
        file,
        signatures,
        scale,
      );
      onSaveSignedPDF(signedPDFBlob);
    } catch (err) {
      console.error('Error saving signed PDF:', err);
      setError('Failed to save signed PDF.');
    } finally {
      setSavingPDF(false);
    }
  }, [file, signatures, scale, onSaveSignedPDF]);

  useEffect(() => {
    async function fetchSignatures() {
      try {
        const response = await api.listSignatures();

        // ⚠️ A FAILED READ IS NOT AN EMPTY LIBRARY. `response.data ?? []`
        // alone turns a refusal into "no saved signatures", which is the
        // silence this whole change exists to remove — and it would have hidden
        // the very bug that started it.
        if (response.error) {
          setError(response.error.message);
          setSavedSignatures([]);
          return;
        }

        // ⚠️ NO ENVELOPE TO UNWRAP any more. This used to probe `.output` and
        // `.result` because the hand-written RPC shim returned whichever the
        // node of the day produced. The generated client returns the typed
        // array, so the three-way guess is gone — and it was the kind of
        // guess that silently yields [] when a shape changes.
        const signaturesArray = response.data ?? [];

        if (!signaturesArray || signaturesArray.length === 0) {
          setSavedSignatures([]);
          return;
        }

        // ⚠️ THE LIBRARY'S OWN CONTEXT, not the agreement's. These rows came
        // out of the PRIVATE context (`listSignatures` runs there) and so
        // did their blobs. This used to send `agreementContextID || ''` —
        // the wrong context on a node, and on a relay `''` is a 400 for an
        // account. Ensured once, before the per-row fetches.
        const libraryContextId = await defaultContextIdFor(app);

        const signaturesWithImages = await Promise.all(
          signaturesArray.map(async (sig: any) => {
            let dataURL = '';
            try {
              // ⚠️ `blob_id` IS BYTES, per the ABI — the generated client
              // hands over a `CalimeroBytes`, not a string. `bs58.encode`
              // here produced an id the node refuses with "Failed to decode
              // blob ID (expected hex)", so the picker showed named rows with
              // no images. `toBlobIdHex` takes the byte array; legacy base58
              // strings still resolve, for signatures saved before the fix.
              const blobId = toBlobIdHex(
                typeof sig.blob_id === 'string'
                  ? sig.blob_id
                  : sig.blob_id.toArray(),
              );
              const blob = await blobClient.downloadBlob(
                blobId,
                libraryContextId,
              );
              if (blob) {
                dataURL = await new Promise<string>((resolve) => {
                  const reader = new FileReader();
                  reader.onloadend = () => resolve(reader.result as string);
                  reader.readAsDataURL(blob);
                });
              }
            } catch (e) {
              console.error(
                `Failed to fetch signature PNG for blobId ${sig.blob_id}:`,
                e,
              );
            }
            return {
              id: sig.id.toString(),
              name: sig.name,
              dataURL,
              // Nanoseconds from the contract (`env::time_now`), as the
              // signature library reads them; `new Date(ns)` printed
              // "Invalid Date" in this picker.
              createdAt: new Date(
                Number(sig.created_at) / 1_000_000,
              ).toLocaleDateString(),
            };
          }),
        );
        setSavedSignatures(signaturesWithImages);
      } catch (error) {
        console.error('Failed to list signatures:', error);
        setSavedSignatures([]);
      }
    }

    fetchSignatures();
  }, [api, app]);

  const handleCreateNewSignature = () => {
    setShowSignatureOptions(false);
    setShowSignaturePad(true);
  };

  const handleSelectExistingSignature = (signatureData: string) => {
    setSelectedSavedSignature(signatureData);
    setSigningMode(true);
    setShowSignatureOptions(false);
  };

  const handleSignaturePadSave = (signatureData: string) => {
    setSelectedSavedSignature(signatureData);
    setSigningMode(true);
    setShowSignaturePad(false);
  };

  const handleSignaturePadCancel = () => {
    setShowSignaturePad(false);
  };

  const handleDownloadSignedPDF = async () => {
    if (!file || documentSignatures.length === 0) return;

    setSavingPDF(true);
    try {
      const signedPDFBlob = await pdfService.generateSignedPDF(
        file,
        documentSignatures,
        scale,
      );

      const url = URL.createObjectURL(signedPDFBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `signed-${file.name}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      if (onSaveSignedPDF) {
        onSaveSignedPDF(signedPDFBlob);
      }
    } catch (err) {
      console.error('Error saving signed PDF:', err);
      setError('Failed to save signed PDF.');
    } finally {
      setSavingPDF(false);
    }
  };

  const handleSaveDocumentToContext = async () => {
    if (
      !file ||
      !contextId ||
      !documentId ||
      !documentHash ||
      documentSignatures.length === 0
    ) {
      setError('Missing required information to save document to context');
      return;
    }

    setSavingToContext(true);
    try {
      const signedPDFBlob = await pdfService.generateSignedPDF(
        file,
        documentSignatures,
        scale,
      );

      // Convert signedPDFBlob to File
      const signedFile = new File([signedPDFBlob], file?.name || 'signed.pdf', {
        type: 'application/pdf',
      });
      const agreementContextID =
        localStorage.getItem('agreementContextID') || undefined;
      const agreementContextUserID =
        localStorage.getItem('agreementContextUserID') || undefined;

      // Use DocumentService for signing
      // `documentHash` is what this viewer opened. The contract refuses the
      // write if the document has moved on since — somebody else signed while
      // this signature was being placed, and saving would erase their mark.
      const response = await documentService.signDocument(
        contextId,
        documentId,
        documentHash,
        signedFile,
        agreementContextID,
        agreementContextUserID,
        undefined,
      );

      if (response.error) {
        console.error('Error saving document to context:', response.error);
        setError(`Failed to save document: ${response.error.message}`);
        return;
      }

      if (onDocumentSaved) {
        onDocumentSaved();
      }

      setError(null);
    } catch (err) {
      console.error('Error saving document to context:', err);
      setError('Failed to save signed document to context.');
    } finally {
      setSavingToContext(false);
    }
  };

  useEffect(() => {
    if (file) {
      loadPDF();
    }
  }, [file, loadPDF]);

  useEffect(() => {
    if (pdf) {
      renderPages();
    }
  }, [pdf, scale, renderPages]);

  const nextPage = () => {
    if (pdf && currentPage < pdf.numPages) {
      setCurrentPage((prev) => prev + 1);
    }
  };

  const prevPage = () => {
    if (currentPage > 1) {
      setCurrentPage((prev) => prev - 1);
    }
  };

  const zoomIn = () => {
    setScale((prev) => {
      const newScale = Math.min(prev + 0.2, 3);
      return newScale;
    });
  };

  const zoomOut = () => {
    setScale((prev) => {
      const newScale = Math.max(prev - 0.2, 0.5);
      return newScale;
    });
  };

  const handleDownload = () => {
    if (!file) return;

    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const currentPageData = pages.find((p) => p.pageNumber === currentPage);
  const signaturesOnCurrentPage = signatures.filter(
    (sig) => sig.pageNumber === currentPage,
  );

  // ⚠️ EVERY EARLY RETURN NEEDS A WAY OUT. The close button lives in the main
  // render path, which is reached only once a PDF has loaded — so the
  // loading, error and no-file branches had NO close control at all. A
  // document that failed to load (which, with the worker-version mismatch,
  // was every document) opened a modal that could not be dismissed.
  // Reported as "when we open up a pdf the popup cant be closed".
  const escapeHatch = showClose && onClose && (
    <button
      type="button"
      className={ui.ghost}
      onClick={onClose}
      data-testid="pdf-close"
    >
      <X size={16} /> Close
    </button>
  );

  if (loading) {
    return (
      <div className={`${v.viewer} ${className}`} style={{ maxHeight }}>
        <div className={v.state}>
          <span className={v.stateSpinner} />
          <p className={v.stateText}>Loading PDF…</p>
          {escapeHatch}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`${v.viewer} ${className}`} style={{ maxHeight }}>
        <div className={v.state}>
          <span className={`${v.stateIcon} ${v.stateIconBad}`}>
            <AlertCircle size={26} />
          </span>
          <p className={v.stateText}>{error}</p>
          <div className={v.stateActions}>
            <button
              type="button"
              className={ui.btn}
              onClick={() => file && loadPDF()}
            >
              Try again
            </button>
            {escapeHatch}
          </div>
        </div>
      </div>
    );
  }

  if (!file || !pdf) {
    return (
      <div className={`${v.viewer} ${className}`} style={{ maxHeight }}>
        <div className={v.state}>
          <span className={v.stateIcon}>
            <FileText size={26} />
          </span>
          <p className={v.stateText}>
            No PDF selected. Please upload a PDF to get started.
          </p>
          {escapeHatch}
        </div>
      </div>
    );
  }

  // Call this when user clicks "Sign Document"
  const handleSignDocument = async () => {
    if (!agreementContextID || !agreementContextUserID) {
      setError('Missing user identity for consent check.');
      return;
    }
    // ⚠️ The ACCOUNT, asked of the contract. This used to pass
    // `agreementContextUserID` — the context member DEVICE key — while consent
    // is stored against the account, and since core rc.27 both are 64 hex
    // characters, so the lookup type-checked and always missed. The consent
    // modal therefore reappeared for someone who had already consented.
    const me = await api.whoami(agreementContextID, agreementContextUserID);
    if (me.error || !me.data) {
      setError('Could not confirm your identity with the agreement.');
      return;
    }

    const resp = await api.hasConsented(
      me.data,
      documentId!,
      agreementContextID,
      agreementContextUserID,
    );

    if (resp.data) {
      setShowSignatureOptions(true);
    } else {
      setShowConsentModal(true);
    }
  };

  // When consent is accepted in modal
  const handleConsentAccept = () => {
    setShowConsentModal(false);
    setShowSignatureOptions(true); // or your signing logic
  };

  // When consent modal is closed without accepting
  const handleConsentClose = () => {
    setShowConsentModal(false);
  };

  const signaturesHere =
    signaturesOnCurrentPage.length +
    documentSignatures.filter((sig) => sig.pageNumber === currentPage).length;
  const canSaveToContext =
    showSaveToContext &&
    documentSignatures.length > 0 &&
    !!contextId &&
    !!documentId;
  const sizeMb =
    file.size !== undefined ? (file.size / 1024 / 1024).toFixed(1) : null;

  return (
    <>
      <div className={`${v.viewer} ${className}`} style={{ maxHeight }}>
        {/* Header: the document, and what can be done with it */}
        <header className={v.head}>
          <span className={v.fileIcon} aria-hidden="true">
            <FileText size={20} />
          </span>
          <div className={v.fileText}>
            <h2 className={v.fileName}>{title || file.name}</h2>
            <p className={v.fileMeta}>
              {pdf.numPages} {pdf.numPages === 1 ? 'page' : 'pages'}
              {sizeMb !== null && <> · {sizeMb} MB</>}
              {documentSignatures.length > 0 && (
                <span className={v.metaChip}>
                  <PenTool size={12} />
                  {documentSignatures.length} placed
                </span>
              )}
            </p>
          </div>

          <div className={v.headActions}>
            {/* Desktop: every action in the bar. A phone gets them from the
                floating button instead, in a sheet. */}
            <div className={v.desktopOnly}>
              <button
                type="button"
                className={canSaveToContext ? ui.ghost : ui.btn}
                onClick={handleSignDocument}
                data-testid="sign-document"
              >
                <PenTool size={16} />
                Sign document
              </button>

              {/* Hidden while the assistant cannot answer — see
                  LEGAL_ASSISTANT_ENABLED. */}
              {LEGAL_ASSISTANT_ENABLED && (
                <button
                  type="button"
                  className={ui.ghost}
                  onClick={() => setShowChatbot(true)}
                >
                  <MessageSquare size={16} />
                  Legal chat
                </button>
              )}

              {documentSignatures.length > 0 && (
                <button
                  type="button"
                  className={ui.ghost}
                  onClick={handleDownloadSignedPDF}
                  disabled={savingPDF}
                  title="Download signed PDF"
                >
                  {savingPDF ? (
                    <span className={ui.spinner} />
                  ) : (
                    <Download size={16} />
                  )}
                  Download signed
                </button>
              )}

              {canSaveToContext && (
                <button
                  type="button"
                  className={ui.success}
                  onClick={handleSaveDocumentToContext}
                  disabled={savingToContext}
                  title="Save signed document to context"
                  data-testid="save-signed-document"
                >
                  {savingToContext ? (
                    <span className={ui.spinner} />
                  ) : (
                    <Upload size={16} />
                  )}
                  Save document
                </button>
              )}

              {showDownload && (
                <button
                  type="button"
                  className={ui.icon}
                  onClick={handleDownload}
                  title="Download original"
                  aria-label="Download original"
                >
                  <Download size={18} />
                </button>
              )}
              {showSignatureControls && signatures.length > 0 && (
                <button
                  type="button"
                  className={ui.icon}
                  onClick={handleSaveSignedPDF}
                  disabled={savingPDF}
                  title="Save signed PDF"
                  aria-label="Save signed PDF"
                >
                  {savingPDF ? (
                    <span className={ui.spinner} />
                  ) : (
                    <Save size={18} />
                  )}
                </button>
              )}
            </div>

            {/* Close: always visible */}
            {showClose && (
              <button
                type="button"
                className={`${ui.icon} ${v.close}`}
                onClick={onClose}
                title="Close document"
                aria-label="Close document"
              >
                <X size={18} />
              </button>
            )}
          </div>
        </header>

        {/* Page and zoom controls */}
        <div className={v.controls}>
          <div className={v.group}>
            <button
              type="button"
              className={ui.icon}
              onClick={prevPage}
              disabled={currentPage === 1}
              aria-label="Previous page"
            >
              <ChevronLeft size={18} />
            </button>
            <span className={v.readout}>
              <strong>{currentPage}</strong>
              <span className={v.readoutMuted}> / {pdf.numPages}</span>
            </span>
            <button
              type="button"
              className={ui.icon}
              onClick={nextPage}
              disabled={currentPage === pdf.numPages}
              aria-label="Next page"
            >
              <ChevronRight size={18} />
            </button>
          </div>

          {signaturesHere > 0 && (
            <span className={v.pageNote}>
              {signaturesHere} signature{signaturesHere !== 1 ? 's' : ''} on
              this page
            </span>
          )}

          <div className={v.group}>
            <button
              type="button"
              className={ui.icon}
              onClick={zoomOut}
              disabled={scale <= 0.5}
              aria-label="Zoom out"
            >
              <ZoomOut size={18} />
            </button>
            <span className={`${v.readout} ${v.readoutMuted}`}>
              {Math.round(scale * 100)}%
            </span>
            <button
              type="button"
              className={ui.icon}
              onClick={zoomIn}
              disabled={scale >= 3}
              aria-label="Zoom in"
            >
              <ZoomIn size={18} />
            </button>
          </div>
        </div>

        {/* Placing a signature: say what a click on the page will do */}
        {(selectedSignature || signingMode) && (
          <div className={v.hint} role="status">
            <MousePointerClick size={16} />
            Click on the document to place your signature
          </div>
        )}

        {/* The page itself: paper-white on a soft desk, in both themes */}
        <div className={v.stage} ref={containerRef}>
          <div className={v.pageWrap}>
            <AnimatePresence mode="wait">
              {currentPageData ? (
                <motion.div
                  key={`page-${currentPage}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className={v.page}
                >
                  <canvas
                    data-testid="pdf-page"
                    className={`${v.canvas} ${
                      selectedSignature || signingMode ? v.placing : ''
                    }`}
                    onClick={handleCanvasClick}
                    onTouchStart={handleCanvasTouch}
                    style={{
                      width: currentPageData.width * scale,
                      height: currentPageData.height * scale,
                    }}
                    ref={(canvas) => {
                      if (canvas && currentPageData) {
                        canvas.width = currentPageData.width;
                        canvas.height = currentPageData.height;
                        const ctx = canvas.getContext('2d');
                        if (ctx) {
                          ctx.clearRect(0, 0, canvas.width, canvas.height);
                          ctx.drawImage(currentPageData.canvas, 0, 0);
                        }
                      }
                    }}
                  />
                  {/* The sharp copy, laid exactly over the canvas above and
                      transparent to the pointer. The one above stays first
                      in the DOM and at logical size, because placement and
                      SignatureOverlay measure the first canvas they find. */}
                  {currentPageData.displayCanvas !== currentPageData.canvas && (
                    <canvas
                      aria-hidden="true"
                      className={v.sharp}
                      ref={(canvas) => {
                        const src = currentPageData.displayCanvas;
                        if (canvas && src) {
                          canvas.width = src.width;
                          canvas.height = src.height;
                          canvas.getContext('2d')?.drawImage(src, 0, 0);
                        }
                      }}
                    />
                  )}

                  {/* External Signature Overlays */}
                  {signatures
                    .filter((sig) => sig.pageNumber === currentPage)
                    .map((signature) => (
                      <SignatureOverlay
                        key={signature.id}
                        signature={signature}
                        scale={scale}
                        onUpdate={handleSignatureUpdate}
                        onDelete={handleSignatureDelete}
                        isSelected={selectedSignatureId === signature.id}
                        onSelect={handleSignatureSelect}
                      />
                    ))}

                  {/* Document Signature Overlays */}
                  {documentSignatures
                    .filter((sig) => sig.pageNumber === currentPage)
                    .map((signature) => (
                      <SignatureOverlay
                        key={signature.id}
                        signature={signature}
                        scale={scale}
                        onUpdate={handleSignatureUpdate}
                        onDelete={handleSignatureDelete}
                        isSelected={selectedSignatureId === signature.id}
                        onSelect={handleSignatureSelect}
                      />
                    ))}
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </div>

        {/* Phone: one floating button for every document action */}
        <button
          type="button"
          className={v.fab}
          onClick={() => setShowMobileActions(true)}
          aria-label="Open document actions"
        >
          <PenTool size={22} />
        </button>
      </div>

      {/* Choosing what to sign with. Portalled (see GlassDialog), so it is
          never clipped by the viewer it opens from. */}
      <GlassDialog
        open={showSignatureOptions}
        onClose={() => setShowSignatureOptions(false)}
        title="Choose a signature"
        description="Draw a new one, or use one from your signature library."
        size="sm"
        testId="signature-picker"
      >
        <div className={v.options}>
          <button
            type="button"
            className={`${v.option} ${v.optionPrimary}`}
            onClick={handleCreateNewSignature}
            data-testid="draw-signature"
          >
            <span className={v.optionIcon}>
              <PenTool size={20} />
            </span>
            <span className={v.optionText}>
              <span className={v.optionTitle}>Draw a signature</span>
              <span className={v.optionSub}>
                Draw one now and place it on the page
              </span>
            </span>
            <ChevronRight size={18} className={v.optionChevron} />
          </button>

          {savedSignatures.length > 0 ? (
            <>
              <p className={v.optionsLabel}>
                Saved signatures ({savedSignatures.length})
              </p>
              {savedSignatures.map((signature) => (
                <button
                  type="button"
                  key={signature.id}
                  className={v.option}
                  onClick={() =>
                    handleSelectExistingSignature(signature.dataURL)
                  }
                  data-testid="saved-signature"
                >
                  <span className={v.optionPaper}>
                    {signature.dataURL ? (
                      <img src={signature.dataURL} alt={signature.name} />
                    ) : null}
                  </span>
                  <span className={v.optionText}>
                    <span className={v.optionTitle}>{signature.name}</span>
                    <span className={v.optionSub}>
                      Created {signature.createdAt}
                    </span>
                  </span>
                  <ChevronRight size={18} className={v.optionChevron} />
                </button>
              ))}
            </>
          ) : (
            <div className={v.optionsEmpty}>
              <PenTool size={22} />
              <p>No saved signatures yet.</p>
              <p className={v.optionSub}>Draw your first one above.</p>
            </div>
          )}
        </div>
      </GlassDialog>

      {/* Signature Pad */}
      <SignaturePadComponent
        isOpen={showSignaturePad}
        onSave={handleSignaturePadSave}
        onCancel={handleSignaturePadCancel}
      />

      {/* The phone's document actions */}
      <GlassDialog
        open={showMobileActions}
        onClose={() => setShowMobileActions(false)}
        title="Document actions"
        description={
          <>
            {file.name} · {pdf.numPages}{' '}
            {pdf.numPages === 1 ? 'page' : 'pages'}
            {sizeMb !== null && <> · {sizeMb} MB</>}
            {documentSignatures.length > 0 && (
              <> · {documentSignatures.length} signatures placed</>
            )}
          </>
        }
        size="sm"
        testId="document-actions"
      >
        <div className={v.options}>
          <button
            type="button"
            className={`${v.option} ${v.optionPrimary}`}
            onClick={() => {
              setShowMobileActions(false);
              handleSignDocument();
            }}
            data-testid="sign-document-mobile"
          >
            <span className={v.optionIcon}>
              <PenTool size={20} />
            </span>
            <span className={v.optionText}>
              <span className={v.optionTitle}>Sign document</span>
              <span className={v.optionSub}>
                Add your signature to this document
              </span>
            </span>
          </button>

          {/* Hidden while the assistant cannot answer; see
              LEGAL_ASSISTANT_ENABLED. */}
          {LEGAL_ASSISTANT_ENABLED && (
            <button
              type="button"
              className={v.option}
              onClick={() => {
                setShowMobileActions(false);
                setShowChatbot(true);
              }}
            >
              <span className={v.optionIcon}>
                <MessageSquare size={20} />
              </span>
              <span className={v.optionText}>
                <span className={v.optionTitle}>Legal chat</span>
                <span className={v.optionSub}>
                  Ask legal questions about this document
                </span>
              </span>
            </button>
          )}

          {canSaveToContext && (
            <button
              type="button"
              className={v.option}
              onClick={() => {
                setShowMobileActions(false);
                handleSaveDocumentToContext();
              }}
              disabled={savingToContext}
            >
              <span className={`${v.optionIcon} ${v.optionIconGood}`}>
                {savingToContext ? (
                  <span className={ui.spinner} />
                ) : (
                  <Upload size={20} />
                )}
              </span>
              <span className={v.optionText}>
                <span className={v.optionTitle}>Save document</span>
                <span className={v.optionSub}>
                  Save the signed document to the agreement
                </span>
              </span>
            </button>
          )}

          {documentSignatures.length > 0 && (
            <button
              type="button"
              className={v.option}
              onClick={() => {
                setShowMobileActions(false);
                handleDownloadSignedPDF();
              }}
              disabled={savingPDF}
            >
              <span className={v.optionIcon}>
                {savingPDF ? (
                  <span className={ui.spinner} />
                ) : (
                  <Download size={20} />
                )}
              </span>
              <span className={v.optionText}>
                <span className={v.optionTitle}>Download signed PDF</span>
                <span className={v.optionSub}>Save the signed document</span>
              </span>
            </button>
          )}

          {showDownload && (
            <button
              type="button"
              className={v.option}
              onClick={() => {
                setShowMobileActions(false);
                handleDownload();
              }}
            >
              <span className={v.optionIcon}>
                <Download size={20} />
              </span>
              <span className={v.optionText}>
                <span className={v.optionTitle}>Download original</span>
                <span className={v.optionSub}>
                  Download the original document
                </span>
              </span>
            </button>
          )}
        </div>
      </GlassDialog>

      <ConsentModal
        open={showConsentModal}
        documentId={documentId!}
        agreementContextID={agreementContextID}
        agreementContextUserID={agreementContextUserID}
        onAccept={handleConsentAccept}
        onClose={handleConsentClose}
      />

      {LEGAL_ASSISTANT_ENABLED && (
        <LegalChatbot
          isOpen={showChatbot}
          onClose={() => setShowChatbot(false)}
          documentID={documentId!}
          contextId={contextId}
          agreementContextID={agreementContextID}
          agreementContextUserID={agreementContextUserID}
        />
      )}
    </>
  );
};

export default PDFViewer;
