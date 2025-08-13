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
  Check,
  Upload,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from './ui/button';
import { LoadingSpinner } from './ui/Loading';
import {
  pdfService,
  type PDFPage,
  type SignaturePosition,
} from '../services/pdfService';
import SignatureOverlay from './SignatureOverlay';
import SignaturePadComponent from './SignaturePad';
import * as pdfjsLib from 'pdfjs-dist';
import './PDFViewer.css';
import { useTheme } from '../contexts/ThemeContext';
import { DocumentService } from '../api/documentService';
import { useIcpAuth } from '../contexts/IcpAuthContext';
import { ClientApiDataSource } from '../api/dataSource/ClientApiDataSource';
import { blobClient, useCalimero } from '@calimero-network/calimero-client';

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
  const { mode } = useTheme();
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

  const documentService = new DocumentService();
  const { identity } = useIcpAuth();

  const loadPDF = useCallback(async () => {
    if (!file) return;

    setLoading(true);
    setError(null);

    try {
      const pdfDoc = await pdfService.loadPDF(file);

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
      const renderedPages = await pdfService.renderAllPages(pdf, scale);

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

        let signaturesArray: any[] = [];

        if (response.data) {
          if (Array.isArray(response.data)) {
            signaturesArray = response.data;
          } else if (
            response.data.output &&
            Array.isArray(response.data.output)
          ) {
            signaturesArray = response.data.output;
          } else if (
            response.data.result &&
            Array.isArray(response.data.result)
          ) {
            signaturesArray = response.data.result;
          }
        }

        if (!signaturesArray || signaturesArray.length === 0) {
          setSavedSignatures([]);
          return;
        }

        const signaturesWithImages = await Promise.all(
          signaturesArray.map(async (sig: any) => {
            let dataURL = '';
            try {
              const blobId =
                typeof sig.blob_id === 'string'
                  ? sig.blob_id
                  : Buffer.from(sig.blob_id).toString('hex');
              const contextId =
                localStorage.getItem('agreementContextID') || '';
              const blob = await blobClient.downloadBlob(blobId, contextId);
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
              createdAt: new Date(sig.created_at).toLocaleDateString(),
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
  }, [api]);

  const handleStartSigning = () => {
    setShowSignatureOptions(true);
  };

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

      const arrayBuffer = await signedPDFBlob.arrayBuffer();
      const updatedPdfData = new Uint8Array(arrayBuffer);
      const newHash = await calculateFileHash(updatedPdfData);

      // Convert signedPDFBlob to File
      const signedFile = new File([signedPDFBlob], file?.name || 'signed.pdf', {
        type: 'application/pdf',
      });
      const signerId = localStorage.getItem('agreementContextUserID') || '';
      const agreementContextID =
        localStorage.getItem('agreementContextID') || undefined;
      const agreementContextUserID =
        localStorage.getItem('agreementContextUserID') || undefined;

      // Use DocumentService for signing
      const response = await documentService.signDocument(
        contextId,
        documentId,
        signedFile,
        signerId,
        agreementContextID,
        agreementContextUserID,
        undefined,
        identity,
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

  const calculateFileHash = async (data: Uint8Array): Promise<string> => {
    const buffer = new Uint8Array(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
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

  if (loading) {
    return (
      <div
        className={`pdf-viewer-container ${className}`}
        style={{
          maxHeight,
          backgroundColor: 'var(--current-surface)',
          border: '1px solid var(--current-border)',
        }}
      >
        <div className="flex flex-col items-center justify-center h-full min-h-[300px] space-y-4">
          <LoadingSpinner size="lg" />
          <p className="text-secondary">Loading PDF...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={`pdf-viewer-container ${className}`}
        style={{
          maxHeight,
          backgroundColor: 'var(--current-surface)',
          border: '1px solid var(--current-border)',
        }}
      >
        <div className="flex flex-col items-center justify-center h-full min-h-[300px] space-y-4">
          <AlertCircle size={48} className="text-red-500" />
          <p className="text-center text-secondary px-4">{error}</p>
          <Button
            variant="outline"
            onClick={() => file && loadPDF()}
            className="mt-4"
          >
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  if (!file || !pdf) {
    return (
      <div
        className={`pdf-viewer-container ${className}`}
        style={{
          maxHeight,
          backgroundColor: 'var(--current-surface)',
          border: '1px solid var(--current-border)',
        }}
      >
        <div className="flex flex-col items-center justify-center h-full min-h-[300px] space-y-4">
          <FileText size={48} className="text-secondary" />
          <p className="text-center text-secondary px-4">
            No PDF selected. Please upload a PDF to get started.
          </p>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`pdf-viewer-container ${className}`}
      style={{
        maxHeight,
        backgroundColor: 'var(--current-surface)',
        border: '1px solid var(--current-border)',
        borderRadius: '12px',
        overflow: 'hidden',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between p-4 border-b"
        style={{
          borderColor: 'var(--current-border)',
          backgroundColor: 'var(--current-surface)',
        }}
      >
        <div className="flex items-center space-x-3">
          <FileText size={20} className="text-primary" />
          <div>
            <h3
              className="font-semibold text-sm"
              style={{ color: 'var(--current-text)' }}
            >
              {title || file.name}
            </h3>
            <p className="text-xs text-secondary">
              {(file.size / 1024 / 1024).toFixed(1)} MB
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {/* Sign Document Button - Desktop Only */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleStartSigning}
            className="hidden sm:flex items-center gap-2"
          >
            <PenTool size={16} />
            Sign Document
          </Button>

          {/* Download Signed PDF Button - Desktop Only */}
          {documentSignatures.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadSignedPDF}
              disabled={savingPDF}
              className="hidden sm:flex items-center gap-2"
              title="Download signed PDF"
            >
              {savingPDF ? (
                <LoadingSpinner size="sm" />
              ) : (
                <Download size={16} />
              )}
              Download Signed
            </Button>
          )}

          {/* Save Document to Context Button - Desktop Only */}
          {showSaveToContext &&
            documentSignatures.length > 0 &&
            contextId &&
            documentId && (
              <Button
                variant="default"
                size="sm"
                onClick={handleSaveDocumentToContext}
                disabled={savingToContext}
                className="hidden sm:flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white"
                title="Save signed document to context"
              >
                {savingToContext ? (
                  <LoadingSpinner size="sm" />
                ) : (
                  <Upload size={16} />
                )}
                Save Document
              </Button>
            )}

          {showDownload && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDownload}
              className="h-8 w-8 p-0"
            >
              <Download size={16} />
            </Button>
          )}
          {showSignatureControls && signatures.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSaveSignedPDF}
              disabled={savingPDF}
              className="h-8 w-8 p-0"
              title="Save signed PDF"
            >
              {savingPDF ? <LoadingSpinner size="sm" /> : <Save size={16} />}
            </Button>
          )}
          {showClose && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-8 w-8 p-0"
            >
              <X size={16} />
            </Button>
          )}
        </div>
      </div>

      {/* Controls */}
      <div
        className="flex items-center justify-between p-3 border-b"
        style={{
          borderColor: 'var(--current-border)',
          backgroundColor: 'var(--current-card)',
        }}
      >
        {/* Page controls */}
        <div className="flex items-center space-x-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={prevPage}
            disabled={currentPage === 1}
            className="h-8 w-8 p-0"
          >
            <ChevronLeft size={16} />
          </Button>

          <span className="text-sm font-medium px-2">
            <span style={{ color: 'var(--current-text)' }}>{currentPage}</span>
            <span className="text-secondary"> / {pdf.numPages}</span>
            {(signaturesOnCurrentPage.length > 0 ||
              documentSignatures.filter((sig) => sig.pageNumber === currentPage)
                .length > 0) && (
              <span className="text-secondary">
                {' '}
                (
                {signaturesOnCurrentPage.length +
                  documentSignatures.filter(
                    (sig) => sig.pageNumber === currentPage,
                  ).length}{' '}
                signature
                {signaturesOnCurrentPage.length +
                  documentSignatures.filter(
                    (sig) => sig.pageNumber === currentPage,
                  ).length !==
                1
                  ? 's'
                  : ''}
                )
              </span>
            )}
          </span>

          <Button
            variant="ghost"
            size="sm"
            onClick={nextPage}
            disabled={currentPage === pdf.numPages}
            className="h-8 w-8 p-0"
          >
            <ChevronRight size={16} />
          </Button>
        </div>

        {/* Zoom controls */}
        <div className="flex items-center space-x-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={zoomOut}
            disabled={scale <= 0.5}
            className="h-8 w-8 p-0"
          >
            <ZoomOut size={16} />
          </Button>

          <span className="text-sm font-medium px-2 text-secondary">
            {Math.round(scale * 100)}%
          </span>

          <Button
            variant="ghost"
            size="sm"
            onClick={zoomIn}
            disabled={scale >= 3}
            className="h-8 w-8 p-0"
          >
            <ZoomIn size={16} />
          </Button>
        </div>
      </div>

      {/* PDF Content - Mobile Optimized */}
      <div
        className="flex-1 overflow-auto p-2 bg-gray-50"
        style={{
          backgroundColor: 'var(--current-bg)',
          maxHeight: `calc(${maxHeight} - 200px)`,
        }}
        ref={containerRef}
      >
        <div className="flex justify-center">
          <div className="relative w-full max-w-full">
            <AnimatePresence mode="wait">
              {currentPageData ? (
                <motion.div
                  key={`page-${currentPage}`}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.2 }}
                  className="relative w-full"
                >
                  <canvas
                    className={`w-full h-auto border border-gray-300 rounded-lg shadow-sm ${
                      selectedSignature || signingMode ? 'cursor-crosshair' : ''
                    }`}
                    onClick={handleCanvasClick}
                    onTouchStart={handleCanvasTouch}
                    style={{
                      backgroundColor: 'white',
                      borderColor: 'var(--current-border)',
                      width: currentPageData.width * scale,
                      height: currentPageData.height * scale,
                      display: 'block',
                      maxWidth: '100%',
                      touchAction: 'pan-x pan-y',
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

                  {/* Signature placement hint */}
                  {(selectedSignature || signingMode) && (
                    <div className="absolute top-2 left-2 bg-blue-500 text-white px-2 py-1 rounded text-xs">
                      {signingMode
                        ? 'Click on the document to place your signature'
                        : 'Click on the document to place your signature'}
                    </div>
                  )}
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Mobile Signature Options Modal */}
      {showSignatureOptions && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 z-[9999] pdf-viewer-modal-overlay">
          <motion.div
            initial={{ opacity: 0, y: 100 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 100 }}
            className={`rounded-t-2xl sm:rounded-lg p-4 w-full max-w-md border border-border shadow-2xl max-h-[80vh] overflow-hidden flex flex-col ${mode === 'dark' ? 'bg-gray-900' : 'bg-white'} ${
              mode === 'dark' ? 'text-gray-200' : 'text-gray-800'
            }`}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-4 pb-2 border-b">
              <h3 className="text-lg font-semibold">Choose Signature</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowSignatureOptions(false)}
                className="p-1 h-8 w-8"
              >
                <X size={16} />
              </Button>
            </div>

            {/* Content */}
            <div className="space-y-3 flex-1 overflow-y-auto">
              {/* Create New Button */}
              <Button
                onClick={handleCreateNewSignature}
                className="w-full flex items-center gap-3 p-4 border border-border rounded-lg hover:bg-muted transition-colors"
                variant="outline"
              >
                <div className="text-left">
                  <div className="font-medium">Draw Signature</div>
                  <div className="text-sm text-muted-foreground">
                    Draw a signature for signing now
                  </div>
                </div>
              </Button>

              {/* Existing Signatures */}
              {savedSignatures.length > 0 && (
                <>
                  <div className="text-sm font-medium text-muted-foreground pt-2">
                    Saved Signatures ({savedSignatures.length}):
                  </div>
                  <div className="space-y-2">
                    {savedSignatures.map((signature) => (
                      <button
                        key={signature.id}
                        onClick={() =>
                          handleSelectExistingSignature(signature.dataURL)
                        }
                        className="w-full p-3 border border-border rounded-lg hover:bg-muted transition-colors flex items-center gap-3 text-left"
                      >
                        <div className="w-16 h-8 bg-background border rounded flex items-center justify-center overflow-hidden flex-shrink-0">
                          <img
                            src={signature.dataURL}
                            alt={signature.name}
                            className="max-w-full max-h-full object-contain"
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm truncate">
                            {signature.name}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Created: {signature.createdAt}
                          </div>
                        </div>
                        <Check size={16} className="text-green-600 opacity-0" />
                      </button>
                    ))}
                  </div>
                </>
              )}

              {savedSignatures.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <PenTool size={32} className="mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No saved signatures found.</p>
                  <p className="text-xs">Create your first signature above.</p>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}

      {/* Signature Pad Modal */}
      <SignaturePadComponent
        isOpen={showSignaturePad}
        onSave={handleSignaturePadSave}
        onCancel={handleSignaturePadCancel}
      />

      {/* Mobile Floating Action Button */}
      <div className="sm:hidden">
        {/* FAB */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setShowMobileActions(true)}
          className="fixed bottom-12 right-6 w-14 h-14 bg-primary text-primary-foreground rounded-full shadow-lg hover:shadow-xl transition-shadow z-40 flex items-center justify-center"
          style={{
            backgroundColor: 'var(--primary)',
            color: 'var(--primary-foreground)',
          }}
        >
          <PenTool size={24} />
        </motion.button>

        {/* Mobile Actions Modal */}
        <AnimatePresence>
          {showMobileActions && (
            <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end justify-center z-[9999] pdf-viewer-modal-overlay">
              <motion.div
                initial={{ opacity: 0, y: 100 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 100 }}
                className={` rounded-t-2xl p-6 w-full max-w-md border border-border shadow-2xl ${mode === 'dark' ? 'bg-gray-900' : 'bg-white'} ${
                  mode === 'dark' ? 'text-gray-200' : 'text-gray-800'
                } `}
              >
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-lg font-semibold">Document Actions</h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowMobileActions(false)}
                    className="p-1 h-8 w-8"
                  >
                    <X size={16} />
                  </Button>
                </div>

                {/* Actions */}
                <div className="space-y-3">
                  {/* Sign Document */}
                  <Button
                    onClick={() => {
                      setShowMobileActions(false);
                      handleStartSigning();
                    }}
                    className="w-full flex items-center gap-3 p-4 text-left justify-start"
                    variant="outline"
                  >
                    <PenTool size={20} />
                    <div>
                      <div className="font-medium">Sign Document</div>
                      <div className="text-sm text-muted-foreground">
                        Add your signature to this document
                      </div>
                    </div>
                  </Button>

                  {/* Download Signed PDF */}
                  {documentSignatures.length > 0 && (
                    <Button
                      onClick={() => {
                        setShowMobileActions(false);
                        handleDownloadSignedPDF();
                      }}
                      disabled={savingPDF}
                      className="w-full flex items-center gap-3 p-4 text-left justify-start"
                      variant="outline"
                    >
                      {savingPDF ? (
                        <LoadingSpinner size="sm" />
                      ) : (
                        <Download size={20} />
                      )}
                      <div>
                        <div className="font-medium">Download Signed PDF</div>
                        <div className="text-sm text-muted-foreground">
                          Save the signed document
                        </div>
                      </div>
                    </Button>
                  )}

                  {/* Save Document to Context */}
                  {showSaveToContext &&
                    documentSignatures.length > 0 &&
                    contextId &&
                    documentId && (
                      <Button
                        onClick={() => {
                          setShowMobileActions(false);
                          handleSaveDocumentToContext();
                        }}
                        disabled={savingToContext}
                        className="w-full flex items-center gap-3 p-4 text-left justify-start bg-green-600 hover:bg-green-700 text-white border-0"
                      >
                        {savingToContext ? (
                          <LoadingSpinner size="sm" />
                        ) : (
                          <Upload size={20} />
                        )}
                        <div>
                          <div className="font-medium">Save Document</div>
                          <div className="text-sm text-white/80">
                            Save signed document to context
                          </div>
                        </div>
                      </Button>
                    )}

                  {/* Download Original */}
                  {showDownload && (
                    <Button
                      onClick={() => {
                        setShowMobileActions(false);
                        handleDownload();
                      }}
                      className="w-full flex items-center gap-3 p-4 text-left justify-start"
                      variant="outline"
                    >
                      <Download size={20} />
                      <div>
                        <div className="font-medium">Download Original</div>
                        <div className="text-sm text-muted-foreground">
                          Download the original document
                        </div>
                      </div>
                    </Button>
                  )}

                  {/* Document Info */}
                  <div className="pt-4 border-t">
                    <div className="text-sm text-muted-foreground">
                      <div className="flex items-center gap-2 mb-1">
                        <FileText size={16} />
                        <span>{file.name}</span>
                      </div>
                      <div className="ml-6">
                        Size: {(file.size / 1024 / 1024).toFixed(1)} MB
                      </div>
                      <div className="ml-6">Pages: {pdf.numPages}</div>
                      {documentSignatures.length > 0 && (
                        <div className="ml-6">
                          Signatures: {documentSignatures.length}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
};

export default PDFViewer;
