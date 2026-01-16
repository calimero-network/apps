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
  MessageSquare,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Button,
  Box,
  Flex,
  Text,
  Heading,
  Loader,
  spacing,
  colors,
  radius,
} from '@calimero-network/mero-ui';
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
import { ClientApiDataSource } from '../api/dataSource/ClientApiDataSource';
import { blobClient, useCalimero } from '@calimero-network/calimero-client';
import ConsentModal from './ConsentModal';
import LegalChatbot from './LegalChatbot';
import bs58 from 'bs58';

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
              // Convert blob_id from byte array to base58 string if needed
              const blobId =
                typeof sig.blob_id === 'string'
                  ? sig.blob_id
                  : bs58.encode(new Uint8Array(sig.blob_id));
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

  if (loading) {
    return (
      <Box
        className={`pdf-viewer-container ${className}`}
        style={{
          maxHeight,
          backgroundColor: mode === 'dark' ? '#1a1a1a' : '#ffffff',
          border: `1px solid ${mode === 'dark' ? '#333' : colors.neutral[200].value}`,
          borderRadius: radius.lg.value,
          padding: spacing[6].value,
        }}
      >
        <Flex
          direction="column"
          alignItems="center"
          justifyContent="center"
          style={{ minHeight: '300px' }}
        >
          <Loader size="large" />
          <Text
            style={{
              marginTop: spacing[4].value,
              color: mode === 'dark' ? '#9ca3af' : colors.neutral[600].value,
            }}
          >
            Loading PDF...
          </Text>
        </Flex>
      </Box>
    );
  }

  if (error) {
    return (
      <Box
        className={`pdf-viewer-container ${className}`}
        style={{
          maxHeight,
          backgroundColor: mode === 'dark' ? '#1a1a1a' : '#ffffff',
          border: `1px solid ${mode === 'dark' ? '#333' : colors.neutral[200].value}`,
          borderRadius: radius.lg.value,
          padding: spacing[6].value,
        }}
      >
        <Flex
          direction="column"
          alignItems="center"
          justifyContent="center"
          style={{ minHeight: '300px', gap: spacing[4].value }}
        >
          <AlertCircle
            size={48}
            style={{ color: colors.semantic.error.value }}
          />
          <Text
            style={{
              textAlign: 'center',
              color: mode === 'dark' ? '#9ca3af' : colors.neutral[600].value,
              padding: `0 ${spacing[4].value}`,
            }}
          >
            {error}
          </Text>
          <Button
            variant="secondary"
            onClick={() => file && loadPDF()}
            style={{ marginTop: spacing[4].value }}
          >
            Try Again
          </Button>
        </Flex>
      </Box>
    );
  }

  if (!file || !pdf) {
    return (
      <Box
        className={`pdf-viewer-container ${className}`}
        style={{
          maxHeight,
          backgroundColor: mode === 'dark' ? '#1a1a1a' : '#ffffff',
          border: `1px solid ${mode === 'dark' ? '#333' : colors.neutral[200].value}`,
          borderRadius: radius.lg.value,
          padding: spacing[6].value,
        }}
      >
        <Flex
          direction="column"
          alignItems="center"
          justifyContent="center"
          style={{ minHeight: '300px', gap: spacing[4].value }}
        >
          <FileText
            size={48}
            style={{
              color: mode === 'dark' ? '#9ca3af' : colors.neutral[600].value,
            }}
          />
          <Text
            style={{
              textAlign: 'center',
              color: mode === 'dark' ? '#9ca3af' : colors.neutral[600].value,
              padding: `0 ${spacing[4].value}`,
            }}
          >
            No PDF selected. Please upload a PDF to get started.
          </Text>
        </Flex>
      </Box>
    );
  }

  // Call this when user clicks "Sign Document"
  const handleSignDocument = async () => {
    if (!agreementContextID || !agreementContextUserID) {
      setError('Missing user identity for consent check.');
      return;
    }
    const resp = await api.hasConsented(
      agreementContextUserID || ' ',
      documentId!,
      agreementContextID,
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

  const fabBase = `fixed bottom-12 right-6 w-14 h-14 rounded-full transition-shadow z-40 flex items-center justify-center focus:outline-none`;

  return (
    <>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        style={{ width: '100%' }}
      >
        <Box
          className={`pdf-viewer-container ${className}`}
          style={{
            maxHeight,
            backgroundColor: mode === 'dark' ? '#1a1a1a' : '#ffffff',
            border: `1px solid ${mode === 'dark' ? '#333' : colors.neutral[200].value}`,
            borderRadius: radius.lg.value,
            overflow: 'hidden',
            boxShadow:
              '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
          }}
        >
          {/* Header */}
          <Flex
            alignItems="center"
            justifyContent="space-between"
            style={{
              padding: spacing[4].value,
              justifyContent: 'space-between',
              borderBottom: `1px solid ${mode === 'dark' ? '#333' : colors.neutral[200].value}`,
              backgroundColor: mode === 'dark' ? '#1a1a1a' : '#ffffff',
            }}
          >
            <Flex alignItems="center" gap="md" style={{ minWidth: 0 }}>
              <FileText
                size={20}
                style={{
                  color:
                    mode === 'dark' ? '#9ca3af' : colors.neutral[600].value,
                  flexShrink: 0,
                }}
              />
              <Box style={{ minWidth: 0 }}>
                <Heading
                  size="sm"
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    color: mode === 'dark' ? '#f3f4f6' : 'inherit',
                  }}
                >
                  {title || file.name}
                </Heading>
                <Text
                  size="xs"
                  style={{
                    color:
                      mode === 'dark' ? '#9ca3af' : colors.neutral[600].value,
                  }}
                >
                  {(file.size / 1024 / 1024).toFixed(1)} MB
                </Text>
              </Box>
            </Flex>

            <Flex alignItems="center" gap="sm" style={{ flexShrink: 0 }}>
              {/* Sign Document Button - Desktop Only */}
              <div className="hidden sm:block">
                <Button
                  variant="secondary"
                  onClick={handleSignDocument}
                  style={{
                    padding: `${spacing[2].value} ${spacing[3].value}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: spacing[2].value,
                  }}
                >
                  <PenTool size={16} />
                  Sign Document
                </Button>
              </div>

              {/* Legal Chatbot Button - Desktop Only */}
              <div className="hidden sm:block">
                <Button
                  variant="secondary"
                  onClick={() => setShowChatbot(true)}
                  style={{
                    padding: `${spacing[2].value} ${spacing[3].value}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: spacing[2].value,
                  }}
                >
                  <MessageSquare size={16} />
                  Legal Chat
                </Button>
              </div>

              {/* Download Signed PDF Button - Desktop Only */}
              {documentSignatures.length > 0 && (
                <div className="hidden sm:block">
                  <Button
                    variant="secondary"
                    onClick={handleDownloadSignedPDF}
                    disabled={savingPDF}
                    title="Download signed PDF"
                    style={{
                      padding: `${spacing[2].value} ${spacing[3].value}`,
                      display: 'flex',
                      alignItems: 'center',
                      gap: spacing[2].value,
                    }}
                  >
                    {savingPDF ? (
                      <Loader size="small" />
                    ) : (
                      <Download size={16} />
                    )}
                    Download Signed
                  </Button>
                </div>
              )}

              {/* Save Document to Context Button - Desktop Only */}
              {showSaveToContext &&
                documentSignatures.length > 0 &&
                contextId &&
                documentId && (
                  <div className="hidden sm:block">
                    <Button
                      variant="success"
                      onClick={handleSaveDocumentToContext}
                      disabled={savingToContext}
                      title="Save signed document to context"
                      style={{
                        padding: `${spacing[2].value} ${spacing[3].value}`,
                        display: 'flex',
                        alignItems: 'center',
                        gap: spacing[2].value,
                      }}
                    >
                      {savingToContext ? (
                        <Loader size="small" />
                      ) : (
                        <Upload size={16} />
                      )}
                      Save Document
                    </Button>
                  </div>
                )}

              {/* Download Original Button - Desktop Only */}
              {showDownload && (
                <div className="hidden sm:block">
                  <Button
                    variant="secondary"
                    onClick={handleDownload}
                    style={{
                      padding: spacing[2].value,
                      minWidth: '32px',
                      minHeight: '32px',
                    }}
                  >
                    <Download size={16} />
                  </Button>
                </div>
              )}
              {/* Save Signed PDF Button - Desktop Only */}
              {showSignatureControls && signatures.length > 0 && (
                <div className="hidden sm:block">
                  <Button
                    variant="secondary"
                    onClick={handleSaveSignedPDF}
                    disabled={savingPDF}
                    title="Save signed PDF"
                    style={{
                      padding: spacing[2].value,
                      minWidth: '32px',
                      minHeight: '32px',
                    }}
                  >
                    {savingPDF ? <Loader size="small" /> : <Save size={16} />}
                  </Button>
                </div>
              )}
              {/* Close Button - Always Visible */}
              {showClose && (
                <Button
                  variant="secondary"
                  onClick={onClose}
                  style={{
                    padding: spacing[2].value,
                    minWidth: '32px',
                    minHeight: '32px',
                    zIndex: 50,
                  }}
                >
                  <X size={16} />
                </Button>
              )}
            </Flex>
          </Flex>

          {/* Controls */}
          <Flex
            alignItems="center"
            justifyContent="space-between"
            style={{
              padding: spacing[3].value,
              borderBottom: `1px solid ${mode === 'dark' ? '#333' : colors.neutral[200].value}`,
              backgroundColor: mode === 'dark' ? '#262626' : '#fafafa',
              gap: spacing[4].value,
            }}
          >
            {/* Page controls */}
            <Flex alignItems="center" gap="sm">
              <Button
                variant="secondary"
                onClick={prevPage}
                disabled={currentPage === 1}
                style={{
                  padding: spacing[2].value,
                  minWidth: '32px',
                  minHeight: '32px',
                }}
              >
                <ChevronLeft size={16} />
              </Button>

              <span
                style={{
                  fontSize: '14px',
                  padding: `0 ${spacing[2].value}`,
                  display: 'inline-flex',
                  alignItems: 'center',
                  whiteSpace: 'nowrap',
                }}
              >
                <span
                  style={{
                    fontWeight: 500,
                    color: mode === 'dark' ? '#f3f4f6' : 'inherit',
                  }}
                >
                  {currentPage}
                </span>
                <span
                  style={{
                    color:
                      mode === 'dark' ? '#9ca3af' : colors.neutral[600].value,
                  }}
                >
                  {' '}
                  / {pdf.numPages}
                </span>
                {(signaturesOnCurrentPage.length > 0 ||
                  documentSignatures.filter(
                    (sig) => sig.pageNumber === currentPage,
                  ).length > 0) && (
                  <span
                    style={{
                      color:
                        mode === 'dark' ? '#9ca3af' : colors.neutral[600].value,
                    }}
                  >
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
                variant="secondary"
                onClick={nextPage}
                disabled={currentPage === pdf.numPages}
                style={{
                  padding: spacing[2].value,
                  minWidth: '32px',
                  minHeight: '32px',
                }}
              >
                <ChevronRight size={16} />
              </Button>
            </Flex>

            {/* Zoom controls */}
            <Flex alignItems="center" gap="sm">
              <Button
                variant="secondary"
                onClick={zoomOut}
                disabled={scale <= 0.5}
                style={{
                  padding: spacing[2].value,
                  minWidth: '32px',
                  minHeight: '32px',
                }}
              >
                <ZoomOut size={16} />
              </Button>

              <span
                style={{
                  fontSize: '14px',
                  padding: `0 ${spacing[2].value}`,
                  color:
                    mode === 'dark' ? '#9ca3af' : colors.neutral[600].value,
                  whiteSpace: 'nowrap',
                  display: 'inline-flex',
                  alignItems: 'center',
                }}
              >
                {Math.round(scale * 100)}%
              </span>

              <Button
                variant="secondary"
                onClick={zoomIn}
                disabled={scale >= 3}
                style={{
                  padding: spacing[2].value,
                  minWidth: '32px',
                  minHeight: '32px',
                }}
              >
                <ZoomIn size={16} />
              </Button>
            </Flex>
          </Flex>

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
                          selectedSignature || signingMode
                            ? 'cursor-crosshair'
                            : ''
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
                style={{
                  backgroundColor: mode === 'dark' ? '#1a1a1a' : '#ffffff',
                  color: mode === 'dark' ? '#f3f4f6' : '#1f2937',
                  borderTopLeftRadius: radius.lg.value,
                  borderTopRightRadius: radius.lg.value,
                  padding: spacing[4].value,
                  width: '100%',
                  maxWidth: '28rem',
                  border: `1px solid ${mode === 'dark' ? '#333' : colors.neutral[200].value}`,
                  boxShadow:
                    '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
                  maxHeight: '80vh',
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                {/* Header */}
                <div className="flex items-center justify-between mb-4 pb-2 border-b">
                  <h3 className="text-lg font-semibold">Choose Signature</h3>
                  <Button
                    variant="secondary"
                    onClick={() => setShowSignatureOptions(false)}
                    style={{
                      padding: spacing[2].value,
                      minWidth: '32px',
                      minHeight: '32px',
                    }}
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
                    variant="secondary"
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
                            <Check
                              size={16}
                              className="text-green-600 opacity-0"
                            />
                          </button>
                        ))}
                      </div>
                    </>
                  )}

                  {savedSignatures.length === 0 && (
                    <div className="text-center py-8 text-muted-foreground">
                      <PenTool size={32} className="mx-auto mb-2 opacity-50" />
                      <p className="text-sm">No saved signatures found.</p>
                      <p className="text-xs">
                        Create your first signature above.
                      </p>
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
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setShowMobileActions(true)}
              aria-label="Open document actions"
              className={`${fabBase} ${mode === 'dark' ? 'shadow-[0_6px_20px_rgba(34,197,94,0.12)]' : 'shadow-lg'}`}
              style={{
                backgroundColor: 'hsl(var(--primary))',
                color: 'hsl(var(--primary-foreground))',
                border: mode === 'dark' ? 'none' : '1px solid rgba(0,0,0,0.06)',
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
                    style={{
                      backgroundColor: mode === 'dark' ? '#1a1a1a' : '#ffffff',
                      borderTopLeftRadius: radius.lg.value,
                      borderTopRightRadius: radius.lg.value,
                      padding: spacing[6].value,
                      width: '100%',
                      maxWidth: '28rem',
                      border: `1px solid ${mode === 'dark' ? '#333' : colors.neutral[200].value}`,
                      boxShadow:
                        '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
                      color: mode === 'dark' ? '#f3f4f6' : '#1f2937',
                    }}
                  >
                    {/* Header */}
                    <Flex
                      alignItems="center"
                      justifyContent="space-between"
                      style={{
                        marginBottom: spacing[6].value,
                        justifyContent: 'space-between',
                      }}
                    >
                      <Heading
                        size="md"
                        style={{
                          color: mode === 'dark' ? '#f3f4f6' : 'inherit',
                        }}
                      >
                        Document Actions
                      </Heading>
                      <Button
                        variant="secondary"
                        onClick={() => setShowMobileActions(false)}
                        style={{
                          padding: spacing[2].value,
                          minWidth: '32px',
                          minHeight: '32px',
                        }}
                      >
                        <X size={16} />
                      </Button>
                    </Flex>

                    {/* Actions */}
                    <Flex direction="column" gap="sm">
                      {/* Sign Document */}
                      <Button
                        onClick={() => {
                          setShowMobileActions(false);
                          handleSignDocument();
                        }}
                        variant="secondary"
                        style={{
                          width: '100%',
                          padding: spacing[4].value,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'flex-start',
                          gap: spacing[3].value,
                          textAlign: 'left',
                        }}
                      >
                        <PenTool size={20} style={{ flexShrink: 0 }} />
                        <div style={{ flex: 1, textAlign: 'left' }}>
                          <div style={{ fontWeight: 500, marginBottom: '2px' }}>
                            Sign Document
                          </div>
                          <div style={{ fontSize: '0.875rem', opacity: 0.7 }}>
                            Add your signature to this document
                          </div>
                        </div>
                      </Button>

                      {/* Legal Chatbot */}
                      <Button
                        onClick={() => {
                          setShowMobileActions(false);
                          setShowChatbot(true);
                        }}
                        variant="secondary"
                        style={{
                          width: '100%',
                          padding: spacing[4].value,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'flex-start',
                          gap: spacing[3].value,
                          textAlign: 'left',
                        }}
                      >
                        <MessageSquare size={20} style={{ flexShrink: 0 }} />
                        <div style={{ flex: 1, textAlign: 'left' }}>
                          <div style={{ fontWeight: 500, marginBottom: '2px' }}>
                            Legal Chatbot
                          </div>
                          <div style={{ fontSize: '0.875rem', opacity: 0.7 }}>
                            Ask legal questions about this document
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
                          variant="secondary"
                          style={{
                            width: '100%',
                            padding: spacing[4].value,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'flex-start',
                            gap: spacing[3].value,
                            textAlign: 'left',
                          }}
                        >
                          {savingPDF ? (
                            <Loader size="small" />
                          ) : (
                            <Download size={20} style={{ flexShrink: 0 }} />
                          )}
                          <div style={{ flex: 1, textAlign: 'left' }}>
                            <div
                              style={{ fontWeight: 500, marginBottom: '2px' }}
                            >
                              Download Signed PDF
                            </div>
                            <div style={{ fontSize: '0.875rem', opacity: 0.7 }}>
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
                            variant="success"
                            style={{
                              width: '100%',
                              padding: spacing[4].value,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'flex-start',
                              gap: spacing[3].value,
                              textAlign: 'left',
                            }}
                          >
                            {savingToContext ? (
                              <Loader size="small" />
                            ) : (
                              <Upload size={20} style={{ flexShrink: 0 }} />
                            )}
                            <div style={{ flex: 1, textAlign: 'left' }}>
                              <div
                                style={{ fontWeight: 500, marginBottom: '2px' }}
                              >
                                Save Document
                              </div>
                              <div
                                style={{ fontSize: '0.875rem', opacity: 0.7 }}
                              >
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
                          variant="secondary"
                          style={{
                            width: '100%',
                            padding: spacing[4].value,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'flex-start',
                            gap: spacing[3].value,
                            textAlign: 'left',
                          }}
                        >
                          <Download size={20} style={{ flexShrink: 0 }} />
                          <div style={{ flex: 1, textAlign: 'left' }}>
                            <div
                              style={{ fontWeight: 500, marginBottom: '2px' }}
                            >
                              Download Original
                            </div>
                            <div style={{ fontSize: '0.875rem', opacity: 0.7 }}>
                              Download the original document
                            </div>
                          </div>
                        </Button>
                      )}

                      {/* Document Info */}
                      <Box
                        style={{
                          paddingTop: spacing[4].value,
                          borderTop: `1px solid ${mode === 'dark' ? '#333' : colors.neutral[200].value}`,
                          marginTop: spacing[2].value,
                        }}
                      >
                        <div
                          style={{
                            fontSize: '0.875rem',
                            color:
                              mode === 'dark'
                                ? '#9ca3af'
                                : colors.neutral[600].value,
                          }}
                        >
                          <Flex
                            alignItems="center"
                            gap="sm"
                            style={{ marginBottom: spacing[2].value }}
                          >
                            <FileText size={16} />
                            <span>{file.name}</span>
                          </Flex>
                          <div style={{ marginLeft: spacing[6].value }}>
                            Size: {(file.size / 1024 / 1024).toFixed(1)} MB
                          </div>
                          <div style={{ marginLeft: spacing[6].value }}>
                            Pages: {pdf.numPages}
                          </div>
                          {documentSignatures.length > 0 && (
                            <div style={{ marginLeft: spacing[6].value }}>
                              Signatures: {documentSignatures.length}
                            </div>
                          )}
                        </div>
                      </Box>
                    </Flex>
                  </motion.div>
                </div>
              )}
            </AnimatePresence>
          </div>
        </Box>
      </motion.div>

      <ConsentModal
        open={showConsentModal}
        userId={agreementContextUserID || ''}
        documentId={documentId!}
        agreementContextID={agreementContextID}
        agreementContextUserID={agreementContextUserID}
        onAccept={handleConsentAccept}
        onClose={handleConsentClose}
      />

      <LegalChatbot
        isOpen={showChatbot}
        onClose={() => setShowChatbot(false)}
        documentID={documentId!}
        contextId={contextId}
        agreementContextID={agreementContextID}
        agreementContextUserID={agreementContextUserID}
      />
    </>
  );
};

export default PDFViewer;
