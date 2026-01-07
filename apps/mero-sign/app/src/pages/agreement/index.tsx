import React, {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react';
import { useNavigate } from 'react-router-dom';
import {
  blobClient,
  useCalimero,
  apiClient,
  setContextId,
  setExecutorPublicKey,
  getContextId,
  getExecutorPublicKey,
} from '@calimero-network/calimero-client';
import type { ResponseData } from '@calimero-network/calimero-client';
import type { ContextInviteByOpenInvitationResponse } from '@calimero-network/calimero-client/lib/api/nodeApi';
import { generateInvitationUrl } from '../../utils/invitation';
import {
  ArrowLeft,
  Plus,
  Users,
  Upload,
  FileText,
  Trash2,
  Download,
  AlertCircle,
  CheckCircle2,
  MoreVertical,
  Clock,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Button,
  Card,
  Heading,
  Text,
  Box,
  Flex,
  Input,
  SearchInput,
  Modal,
  Loader,
  Alert,
  spacing,
  colors,
  radius,
} from '@calimero-network/mero-ui';
import { MobileLayout } from '../../components/MobileLayout';
import PDFViewer from '../../components/PDFViewer';
import AuditTrail from '../../components/AuditTrail';
import { DocumentService } from '../../api/documentService';
import { ClientApiDataSource } from '../../api/dataSource/ClientApiDataSource';
import { ContextApiDataSource } from '../../api/dataSource/nodeApiDataSource';
import { ContextDetails, PermissionLevel } from '../../api/clientApi';

// Constants

const ANIMATION_VARIANTS = {
  container: {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
        delayChildren: 0.2,
      },
    },
  },
  item: {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
  },
} as const;

interface UploadedDocument {
  id: string;
  name: string;
  size: string;
  file?: File;
  uploadedAt: string;
  status: string;
  uploadedBy?: string;
  hash?: string;
  pdfBlobId?: string;
}

interface FileUpload {
  file: File;
  progress: number;
  uploading: boolean;
  uploaded: boolean;
  error?: string;
  blob_id?: string;
  stage: 'uploading' | 'generating-embeddings' | 'storing' | 'complete';
  stageProgress: number;
}

type NotificationType = 'success' | 'error';
interface NotificationState {
  message: string;
  type: NotificationType;
}

const NotificationPopup: React.FC<{
  notification: NotificationState;
  onClose: () => void;
}> = ({ notification }) => (
  <Box
    style={{
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.4)',
      backdropFilter: 'blur(8px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      padding: spacing[4].value,
    }}
  >
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ type: 'spring', stiffness: 300, damping: 25 }}
    >
      <Card
        style={{
          padding: spacing[6].value,
          borderRadius: radius.lg.value,
          width: '100%',
          maxWidth: '400px',
          textAlign: 'center',
          backgroundColor:
            notification.type === 'success'
              ? colors.semantic.success.value
              : colors.semantic.error.value,
          borderColor:
            notification.type === 'success'
              ? colors.semantic.success.value
              : colors.semantic.error.value,
        }}
      >
        <Flex direction="column" alignItems="center" justifyContent="center">
          {notification.type === 'success' ? (
            <CheckCircle2
              style={{
                width: '64px',
                height: '64px',
                marginBottom: spacing[4].value,
                color: '#16a34a',
              }}
            />
          ) : (
            <AlertCircle
              style={{
                width: '64px',
                height: '64px',
                marginBottom: spacing[4].value,
                color: '#dc2626',
              }}
            />
          )}
          <Text size="lg" weight="medium">
            {notification.message}
          </Text>
        </Flex>
      </Card>
    </motion.div>
  </Box>
);

// Old invitation flow removed - now using open invitation

const getStageDescription = (stage: FileUpload['stage']): string => {
  switch (stage) {
    case 'uploading':
      return 'Uploading file...';
    case 'generating-embeddings':
      return 'Generating embeddings...';
    case 'storing':
      return 'Storing document...';
    case 'complete':
      return 'Complete';
    default:
      return 'Processing...';
  }
};

const calculateFileHash = async (data: Uint8Array): Promise<string> => {
  const buffer = new Uint8Array(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
};

const sanitizeDocumentId = (documentId: string): string => {
  return documentId.replace(/[^a-zA-Z0-9_-]/g, '_');
};

const AgreementPage: React.FC = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { app } = useCalimero();
  const documentService = useMemo(() => new DocumentService(), []);
  const clientApiService = useMemo(() => new ClientApiDataSource(app), [app]);
  const nodeApiService = useMemo(() => new ContextApiDataSource(app), [app]);

  const [searchQuery, setSearchQuery] = useState('');
  const [showParticipants, setShowParticipants] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteMode, setInviteMode] = useState<'url' | 'payload'>('url');
  const [inviteId, setInviteId] = useState('');
  const [invitePermission, setInvitePermission] = useState<PermissionLevel>(
    PermissionLevel.Sign,
  );
  const [invitationUrl, setInvitationUrl] = useState<string | null>(null);
  const [generatedPayload, setGeneratedPayload] = useState('');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [generatingInvite, setGeneratingInvite] = useState(false);
  const [documents, setDocuments] = useState<UploadedDocument[]>([]);
  const [uploadFiles, setUploadFiles] = useState<FileUpload[]>([]);
  const [selectedDocument, setSelectedDocument] =
    useState<UploadedDocument | null>(null);
  const [showPDFViewer, setShowPDFViewer] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [loadingPDFPreview, setLoadingPDFPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contextDetails, setContextDetails] = useState<ContextDetails | null>(
    null,
  );
  const [contextLoading, setContextLoading] = useState(true);
  const [notification, setNotification] = useState<NotificationState | null>(
    null,
  );
  const [menuOpenDocId, setMenuOpenDocId] = useState<string | null>(null);
  const [verifyingDocId, setVerifyingDocId] = useState<string | null>(null);
  const [verifyResult, setVerifyResult] = useState<{
    status?: string;
    error?: any;
    verified?: boolean;
    message?: string;
    documentId?: string; // Track which document this result is for
  } | null>(null);
  const [showAuditTrail, setShowAuditTrail] = useState(false);
  const [selectedDocumentForAudit, setSelectedDocumentForAudit] =
    useState<UploadedDocument | null>(null);
  const [showVerificationModal, setShowVerificationModal] = useState(false);
  const [selectedDocumentForVerification, setSelectedDocumentForVerification] =
    useState<UploadedDocument | null>(null);

  const showNotification = useCallback(
    (message: string, type: NotificationType) => {
      setNotification({ message, type });
      setTimeout(() => {
        setNotification(null);
      }, 1500);
    },
    [],
  );

  const currentContextId = useMemo(() => {
    const storedContextId = localStorage.getItem('agreementContextID');

    if (!storedContextId) {
      console.warn('No agreement context ID found in localStorage');
      navigate('/');
      return null;
    }
    return storedContextId;
  }, [navigate]);

  const loadContextDetails = useCallback(async () => {
    if (!currentContextId) return;

    try {
      setContextLoading(true);
      setError(null);

      const agreementContextID = localStorage.getItem('agreementContextID');
      const agreementContextUserID = localStorage.getItem(
        'agreementContextUserID',
      );

      const response = await clientApiService.getContextDetails(
        currentContextId,
        agreementContextID || undefined,
        agreementContextUserID || undefined,
      );

      if (response.error) {
        setError(response.error.message);
        setContextDetails(null);
      } else {
        setContextDetails(response.data);
      }
    } catch (err) {
      console.error('Failed to load context details:', err);
      setError('Failed to load context details');
      setContextDetails(null);
    } finally {
      setContextLoading(false);
    }
  }, [clientApiService, currentContextId]);

  const loadDocuments = useCallback(async () => {
    if (!currentContextId) return;

    try {
      setLoading(true);
      setError(null);

      const agreementContextID = localStorage.getItem('agreementContextID');
      const agreementContextUserID = localStorage.getItem(
        'agreementContextUserID',
      );

      const response = await documentService.listDocuments(
        currentContextId,
        agreementContextID || undefined,
        agreementContextUserID || undefined,
      );

      if (response.error) {
        setError(response.error.message);
        setDocuments([]);
      } else {
        const uploadedDocs: UploadedDocument[] = (response.data || []).map(
          (doc) => {
            return {
              id: doc.id,
              name: doc.name,
              size: doc.size,
              uploadedAt: doc.uploadedAt,
              status: doc.status,
              uploadedBy: doc.uploadedBy,
              hash: doc.hash,
              pdfBlobId: doc.pdfBlobId,
            };
          },
        );
        setDocuments(uploadedDocs);
      }
    } catch (err) {
      console.error('Failed to load documents:', err);
      setError('Failed to load documents');
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  }, [documentService, currentContextId]);

  const filteredDocuments = useMemo(
    () =>
      documents.filter((doc) =>
        doc.name.toLowerCase().includes(searchQuery.toLowerCase()),
      ),
    [documents, searchQuery],
  );

  useEffect(() => {
    if (!currentContextId) {
      console.error('No context ID available');
      return;
    }

    // Set context ID and executor public key in Calimero client state when page loads
    // This ensures the context is available for all API calls
    const agreementContextUserID = localStorage.getItem(
      'agreementContextUserID',
    );
    if (agreementContextUserID) {
      setContextId(currentContextId);
      setExecutorPublicKey(agreementContextUserID);
    }

    loadContextDetails();
    loadDocuments();
  }, [loadContextDetails, loadDocuments, currentContextId]);

  const handleFileUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (!files || !currentContextId || !app) return;

      setUploading(true);
      setError(null);

      const agreementContextID = localStorage.getItem('agreementContextID');
      const agreementContextUserID = localStorage.getItem(
        'agreementContextUserID',
      );

      const file = files[0];
      if (!file) {
        setUploading(false);
        setError('No file selected');
        return;
      }

      if (file.type !== 'application/pdf') {
        setUploading(false);
        setError(
          `"${file.name}" is not a PDF file. Please upload only PDF files.`,
        );
        return;
      }

      setUploadFiles([
        {
          file,
          progress: 0,
          uploading: true,
          uploaded: false,
          error: undefined,
          blob_id: undefined,
          stage: 'uploading',
          stageProgress: 0,
        },
      ]);

      try {
        const response = await documentService.uploadDocument(
          currentContextId,
          file.name,
          file,
          agreementContextID || undefined,
          agreementContextUserID || undefined,
          (blobProgress: number) => {
            const totalProgress = Math.min(blobProgress * 0.5, 50);
            setUploadFiles((prev) =>
              prev.map((f) =>
                f.file && f.file.name === file.name
                  ? {
                      ...f,
                      progress: totalProgress,
                      stageProgress: blobProgress,
                      stage: 'uploading' as const,
                    }
                  : f,
              ),
            );
          },

          (embeddingProgress: number) => {
            const totalProgress = 50 + Math.min(embeddingProgress * 0.3, 30);
            setUploadFiles((prev) =>
              prev.map((f) =>
                f.file && f.file.name === file.name
                  ? {
                      ...f,
                      progress: totalProgress,
                      stageProgress: embeddingProgress,
                      stage: 'generating-embeddings' as const,
                    }
                  : f,
              ),
            );
          },

          () => {
            setUploadFiles((prev) =>
              prev.map((f) =>
                f.file && f.file.name === file.name
                  ? {
                      ...f,
                      progress: 85,
                      stageProgress: 50,
                      stage: 'storing' as const,
                    }
                  : f,
              ),
            );
          },
        );

        if (response.error) {
          setUploadFiles((prev) =>
            prev.map((f) =>
              f.file && f.file.name === file.name
                ? {
                    ...f,
                    uploading: false,
                    error: response.error.message,
                    stage: 'complete' as const,
                    stageProgress: 0,
                  }
                : f,
            ),
          );
          setUploading(false);
          setError(response.error.message);
          console.error(`Failed to upload ${file.name}:`, response.error);
          return;
        }

        setUploadFiles((prev) =>
          prev.map((f) =>
            f.file && f.file.name === file.name
              ? {
                  ...f,
                  uploading: false,
                  uploaded: true,
                  progress: 100,
                  stage: 'complete' as const,
                  stageProgress: 100,
                }
              : f,
          ),
        );
        setUploading(false);
        setError(null);
        setShowUploadModal(false);
        setUploadFiles([]);
        if (fileInputRef.current) fileInputRef.current.value = '';
        showNotification('Document uploaded successfully!', 'success');
        await loadDocuments();
      } catch (error) {
        console.error(`Upload error for ${file.name}:`, error);
        setUploadFiles((prev) =>
          prev.map((f) => ({
            ...f,
            uploading: false,
            error: `Upload error: ${error}`,
            stage: 'complete' as const,
            stageProgress: 0,
          })),
        );
        setUploading(false);
        setError(`Upload error: ${error}`);
      }
    },
    [app, currentContextId, loadDocuments, showNotification, documentService],
  );

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleRemoveDocument = useCallback(
    async (documentId: string) => {
      const agreementContextID = localStorage.getItem('agreementContextID');
      const agreementContextUserID = localStorage.getItem(
        'agreementContextUserID',
      );

      try {
        setLoading(true);
        setError(null);

        const response = await clientApiService.deleteDocument(
          documentId,
          agreementContextID || undefined,
          agreementContextUserID || undefined,
        );

        if (response.error) {
          setError(response.error.message || 'Failed to delete document');
          setLoading(false);
          return;
        }

        setDocuments((prev) => prev.filter((doc) => doc.id !== documentId));
        setLoading(false);
        showNotification('Document deleted successfully!', 'success');
      } catch (err) {
        console.error('Failed to delete document:', err);
        setError('Failed to delete document');
        setLoading(false);
      }
    },
    [clientApiService, showNotification],
  );

  const handleOpenDocument = useCallback(
    async (document: UploadedDocument) => {
      if (!document.pdfBlobId) {
        showNotification(
          'Document blob ID not available for preview.',
          'error',
        );
        return;
      }
      if (!app) {
        showNotification(
          'Application not initialized. Please try again later.',
          'error',
        );
        return;
      }

      try {
        setLoadingPDFPreview(true);
        const contextID = localStorage.getItem('agreementContextID');
        const blob = await blobClient.downloadBlob(
          document.pdfBlobId,
          contextID || '',
        );
        const file = new File([blob], document.name, {
          type: 'application/pdf',
        });

        setSelectedDocument({
          ...document,
          file: file,
        });
        setShowPDFViewer(true);
      } catch (error) {
        console.error(
          `Failed to load PDF for preview: ${document.name}`,
          error,
        );
        showNotification(`Failed to load PDF: "${document.name}".`, 'error');
      } finally {
        setLoadingPDFPreview(false);
      }
    },
    [showNotification, app],
  );

  const handleClosePDFViewer = useCallback(() => {
    setShowPDFViewer(false);
    setSelectedDocument(null);
  }, []);

  const handleDownloadDocument = useCallback(
    async (doc: UploadedDocument) => {
      if (!doc.pdfBlobId) {
        showNotification(
          'Document blob ID not available for download.',
          'error',
        );
        return;
      }
      if (!app) {
        showNotification(
          'Application not initialized. Please try again later.',
          'error',
        );
        return;
      }

      try {
        const contextID = localStorage.getItem('agreementContextID');
        const blob = await blobClient.downloadBlob(
          doc.pdfBlobId,
          contextID || ' ',
        );

        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = doc.name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } catch (error) {
        console.error(`Failed to download document: ${doc.name}`, error);
        showNotification(`Failed to download "${doc.name}".`, 'error');
      }
    },
    [showNotification, app],
  );

  const handleGenerateOpenInvitation = useCallback(async () => {
    const agreementContextUserID = localStorage.getItem(
      'agreementContextUserID',
    );

    const agreementContextID = localStorage.getItem('agreementContextID');

    if (!agreementContextUserID || !agreementContextID) {
      showNotification(
        'Context information not found. Please ensure you are in an agreement.',
        'error',
      );
      return;
    }

    if (!app) {
      showNotification(
        'Calimero client not initialized. Please wait and try again.',
        'error',
      );
      return;
    }

    try {
      setGeneratingInvite(true);

      // Ensure context ID and executor public key are set in Calimero client state
      // This is required for the API to work properly
      setContextId(agreementContextID);
      setExecutorPublicKey(agreementContextUserID);

      // Verify the context is set (like the reference app does)
      // The reference app uses getContextId() and getExecutorPublicKey() to verify
      const currentContextId = getContextId();
      const currentExecutorPublicKey = getExecutorPublicKey();

      if (!currentContextId || !currentExecutorPublicKey) {
        showNotification(
          'Context not properly initialized. Please try again.',
          'error',
        );
        return;
      }

      // Generate open invitation using the new API
      // Use the values from the client state (like reference app)
      const response: ResponseData<ContextInviteByOpenInvitationResponse> =
        await apiClient.node().contextInviteByOpenInvitation(
          currentContextId,
          currentExecutorPublicKey,
          86400, // 24 hours TTL
        );

      if (response.error) {
        showNotification(
          response.error.message || 'Failed to generate invitation',
          'error',
        );
        return;
      }

      if (!response.data) {
        showNotification('Failed to generate invitation', 'error');
        return;
      }

      // Generate invitation URL
      const invitationPayload = JSON.stringify(response.data);
      const url = generateInvitationUrl(invitationPayload);
      setInvitationUrl(url);

      showNotification(
        'Invitation URL created! Share it with participants.',
        'success',
      );
    } catch (error) {
      console.error('Failed to generate invitation:', error);
      showNotification(
        'Failed to generate invitation. Please try again.',
        'error',
      );
    } finally {
      setGeneratingInvite(false);
    }
  }, [showNotification, app]);

  const handleCopyInvitationUrl = useCallback(() => {
    if (invitationUrl) {
      navigator.clipboard.writeText(invitationUrl);
      showNotification('Invitation URL copied to clipboard!', 'success');
    }
  }, [invitationUrl, showNotification]);

  const handleGeneratePayload = useCallback(async () => {
    if (!inviteId.trim()) {
      showNotification('Please enter an invitee ID', 'error');
      return;
    }

    const agreementContextUserID = localStorage.getItem(
      'agreementContextUserID',
    );
    const agreementContextID = localStorage.getItem('agreementContextID');

    if (!agreementContextUserID || !agreementContextID) {
      showNotification(
        'Context information not found. Please ensure you are in an agreement.',
        'error',
      );
      return;
    }

    try {
      setGeneratingInvite(true);

      const response = await nodeApiService.inviteToContext({
        contextId: agreementContextID,
        inviter: agreementContextUserID,
        invitee: inviteId.trim(),
      });

      if (response.error) {
        showNotification(
          response.error.message || 'Failed to generate payload',
          'error',
        );
        return;
      }

      if (response.data) {
        setGeneratedPayload(response.data);
        showNotification('Payload generated!', 'success');
      }
    } catch (error) {
      console.error('Failed to generate payload:', error);
      showNotification('Failed to generate payload', 'error');
    } finally {
      setGeneratingInvite(false);
    }
  }, [inviteId, nodeApiService, showNotification]);

  const handleCopyPayload = useCallback(() => {
    if (generatedPayload) {
      navigator.clipboard.writeText(generatedPayload);
      showNotification('Payload copied to clipboard!', 'success');
    }
  }, [generatedPayload, showNotification]);

  const handleVerifyDocument = useCallback(async (doc: UploadedDocument) => {
    // TODO: Implement Calimero-based verification
    setSelectedDocumentForVerification(doc);
    setShowVerificationModal(true);
    setVerifyingDocId(doc.id);
    setVerifyResult({
      error: {
        message:
          'Document verification is currently unavailable. This feature will be re-implemented using Calimero.',
      },
      documentId: doc.id,
    });
    setVerifyingDocId(null);
  }, []);

  const handleCloseVerificationModal = useCallback(() => {
    setShowVerificationModal(false);
    setSelectedDocumentForVerification(null);
    setVerifyResult(null);
  }, []);

  const handleShowAuditTrail = useCallback((doc: UploadedDocument) => {
    setSelectedDocumentForAudit(doc);
    setShowAuditTrail(true);
  }, []);

  const handleCloseAuditTrail = useCallback(() => {
    setShowAuditTrail(false);
    setSelectedDocumentForAudit(null);
  }, []);

  const [currentSubscriptionContextId, setCurrentSubscriptionContextId] =
    useState<string | null>(null);

  const eventCallback = useCallback(
    async (event: any) => {
      try {
        if (event.type === 'StateMutation') {
          await Promise.all([loadDocuments(), loadContextDetails()]);
        }
      } catch (err) {
        console.error('Error handling state mutation event:', err);
      }
    },
    [loadDocuments, loadContextDetails],
  );

  useLayoutEffect(() => {
    if (!currentContextId || !app) return;

    let isSubscribed = false;

    const subscribeToContext = (contextId: string) => {
      if (isSubscribed && currentSubscriptionContextId === contextId) {
        return;
      }

      if (
        currentSubscriptionContextId &&
        currentSubscriptionContextId !== contextId
      ) {
        try {
          app.unsubscribeFromEvents([currentSubscriptionContextId]);
        } catch (error) {
          console.error(
            'WebSocket: Failed to unsubscribe from:',
            currentSubscriptionContextId,
            error,
          );
        }
      }

      try {
        app.subscribeToEvents([contextId], eventCallback);
        setCurrentSubscriptionContextId(contextId);
        isSubscribed = true;
      } catch (error) {
        console.error('WebSocket: Failed to subscribe to:', contextId, error);
        setCurrentSubscriptionContextId(null);
        isSubscribed = false;
      }
    };

    // Initial subscription with delay for proper initialization
    const timeoutId = setTimeout(
      () => subscribeToContext(currentContextId),
      100,
    );

    return () => {
      clearTimeout(timeoutId);

      if (isSubscribed && currentSubscriptionContextId) {
        try {
          app.unsubscribeFromEvents([currentSubscriptionContextId]);
        } catch (error) {
          console.warn('WebSocket: Error during cleanup:', error);
        }
      }
    };
  }, [currentContextId, app, eventCallback, currentSubscriptionContextId]);

  return (
    <MobileLayout>
      <AnimatePresence>
        {notification && (
          <NotificationPopup
            notification={notification}
            onClose={() => setNotification(null)}
          />
        )}
      </AnimatePresence>
      <motion.div
        variants={ANIMATION_VARIANTS.container}
        initial="hidden"
        animate="visible"
        className="space-y-6"
      >
        {/* Header */}
        <motion.section variants={ANIMATION_VARIANTS.item}>
          <Card
            style={{ padding: spacing[4].value, borderRadius: radius.md.value }}
          >
            <Flex
              alignItems="center"
              style={{
                padding: '0px',
                margin: '0px',
                backgroundColor: 'transparent',
                borderRadius: '0px',
                border: 'none',
                boxShadow: 'none',
                display: 'flex',
                flexFlow: 'row',
                alignItems: 'center',
                position: 'static',
                overflow: 'visible',
                cursor: 'inherit',
                justifyContent: 'space-between',
                width: '100%',
              }}
            >
              <Flex alignItems="center" gap="md">
                <Button
                  variant="secondary"
                  onClick={() => navigate('/')}
                  style={{ padding: spacing[2].value }}
                >
                  <ArrowLeft style={{ width: '20px', height: '20px' }} />
                </Button>
                <Box>
                  <Heading size="lg">
                    {contextDetails?.context_name || 'Loading...'}
                  </Heading>
                  <Text size="sm" style={{ color: colors.neutral[600].value }}>
                    {contextDetails?.participant_count || 0} participants
                  </Text>
                </Box>
              </Flex>
              <Button
                variant="secondary"
                onClick={() => setShowParticipants(!showParticipants)}
                style={{ padding: spacing[2].value }}
              >
                <Users style={{ width: '20px', height: '20px' }} />
              </Button>
            </Flex>
          </Card>
        </motion.section>

        {/* Participants Panel */}
        {showParticipants && (
          <motion.section
            variants={ANIMATION_VARIANTS.item}
            initial="hidden"
            animate="visible"
          >
            <Card
              style={{
                padding: spacing[4].value,
                borderRadius: radius.md.value,
                backgroundColor: 'rgba(22, 163, 74, 0.1)',
                borderColor: 'rgba(22, 163, 74, 0.2)',
              }}
            >
              <Flex
                alignItems="center"
                style={{
                  marginBottom: spacing[4].value,
                  padding: '0px',
                  margin: '0px 0px 16px 0px',
                  backgroundColor: 'transparent',
                  borderRadius: '0px',
                  border: 'none',
                  boxShadow: 'none',
                  display: 'flex',
                  flexFlow: 'row',
                  position: 'static',
                  overflow: 'visible',
                  cursor: 'inherit',
                  justifyContent: 'space-between',
                  width: '100%',
                }}
              >
                <Heading size="md">Participants</Heading>
                <Button
                  onClick={() => setShowInviteModal(true)}
                  variant="primary"
                >
                  <Plus
                    style={{
                      width: '16px',
                      height: '16px',
                      marginRight: spacing[2].value,
                    }}
                  />
                  Invite
                </Button>
              </Flex>
              <Box
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: spacing[3].value,
                }}
              >
                {contextDetails?.participants?.map((participant) => (
                  <Flex key={participant.user_id} alignItems="center" gap="md">
                    <Box
                      style={{
                        width: '32px',
                        height: '32px',
                        backgroundColor: '#16a34a',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Text
                        size="sm"
                        weight="medium"
                        style={{ color: 'white' }}
                      >
                        {participant.user_id.slice(0, 2).toUpperCase()}
                      </Text>
                    </Box>
                    <Box>
                      <Text size="sm" weight="medium">
                        {participant.user_id.slice(0, 6)}...
                        {participant.user_id.slice(-4)}
                      </Text>
                      <Text
                        size="xs"
                        style={{ color: colors.neutral[600].value }}
                      >
                        {participant.permission_level}
                      </Text>
                    </Box>
                  </Flex>
                )) || (
                  <Text size="sm" style={{ color: colors.neutral[600].value }}>
                    {contextLoading
                      ? 'Loading participants...'
                      : 'No participants found'}
                  </Text>
                )}
              </Box>
            </Card>
          </motion.section>
        )}

        {/* Search Bar */}
        <motion.section
          variants={ANIMATION_VARIANTS.item}
          style={{ padding: spacing[2].value }}
        >
          <SearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search documents..."
            style={{ width: '100%' }}
          />
        </motion.section>

        {/* Documents List */}
        <motion.section variants={ANIMATION_VARIANTS.item}>
          <Flex
            alignItems="center"
            style={{
              marginBottom: spacing[4].value,
              padding: '0px',
              margin: `0px 0px ${spacing[4].value} 0px`,
              backgroundColor: 'transparent',
              borderRadius: '0px',
              border: 'none',
              boxShadow: 'none',
              display: 'flex',
              flexFlow: 'row',
              alignItems: 'center',
              position: 'static',
              overflow: 'visible',
              cursor: 'inherit',
              justifyContent: 'space-between',
              width: '100%',
            }}
          >
            <Heading size="lg">Uploaded Documents</Heading>
            <Text size="sm" style={{ color: colors.neutral[600].value }}>
              {filteredDocuments.length} documents
            </Text>
          </Flex>

          {loading && (
            <Box
              style={{ textAlign: 'center', padding: `${spacing[6].value} 0` }}
            >
              <Loader size="large" />
              <Text
                size="sm"
                style={{
                  color: colors.neutral[600].value,
                  marginTop: spacing[2].value,
                }}
              >
                Loading documents...
              </Text>
            </Box>
          )}

          {error && !loading && (
            <Box
              style={{ textAlign: 'center', padding: `${spacing[6].value} 0` }}
            >
              <Text
                size="sm"
                style={{
                  color: colors.semantic.error.value,
                  marginBottom: spacing[4].value,
                }}
              >
                {error}
              </Text>
              <Button onClick={loadDocuments} variant="secondary">
                Try Again
              </Button>
            </Box>
          )}

          {!loading && !error && filteredDocuments.length === 0 && (
            <Card
              style={{
                padding: spacing[6].value,
                textAlign: 'center',
                borderRadius: radius.md.value,
              }}
            >
              <FileText
                style={{
                  width: '48px',
                  height: '48px',
                  margin: '0 auto',
                  color: colors.neutral[600].value,
                  marginBottom: spacing[4].value,
                }}
              />
              <Text size="sm" style={{ color: colors.neutral[600].value }}>
                No documents uploaded yet. Upload your first PDF to get started.
              </Text>
            </Card>
          )}

          {!loading && !error && filteredDocuments.length > 0 && (
            <Box
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: spacing[4].value,
              }}
            >
              {filteredDocuments.map((document) => (
                <motion.div
                  key={document.id}
                  variants={ANIMATION_VARIANTS.item}
                  whileHover={{ y: -2, scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  onClick={() => handleOpenDocument(document)}
                  style={{ cursor: 'pointer' }}
                >
                  <Card
                    style={{
                      padding: spacing[4].value,
                      borderRadius: radius.md.value,
                    }}
                  >
                    <Flex
                      alignItems="flex-start"
                      style={{
                        marginBottom: spacing[3].value,
                        padding: '0px',
                        margin: `0px 0px ${spacing[3].value} 0px`,
                        backgroundColor: 'transparent',
                        borderRadius: '0px',
                        border: 'none',
                        boxShadow: 'none',
                        display: 'flex',
                        flexFlow: 'row',
                        alignItems: 'flex-start',
                        position: 'static',
                        overflow: 'visible',
                        cursor: 'inherit',
                        justifyContent: 'space-between',
                        width: '100%',
                      }}
                    >
                      <Flex
                        alignItems="center"
                        gap="md"
                        style={{
                          flex: 1,
                          minWidth: 0,
                          paddingRight: spacing[2].value,
                        }}
                      >
                        <Box
                          style={{
                            padding: spacing[2].value,
                            backgroundColor: 'transparent',
                            borderRadius: radius.md.value,
                            flexShrink: 0,
                          }}
                        >
                          <FileText
                            style={{
                              width: '24px',
                              height: '24px',
                              color: colors.neutral[600].value,
                            }}
                          />
                        </Box>
                        <Box style={{ flex: 1, minWidth: 0 }}>
                          <Heading
                            size="sm"
                            style={{ marginBottom: spacing[2].value }}
                          >
                            {document.name}
                          </Heading>
                          <Flex
                            direction="column"
                            gap="xs"
                            style={{ color: colors.neutral[600].value }}
                          >
                            <Flex alignItems="center" gap="sm">
                              <Text size="sm">{document.size}</Text>
                              <Text size="sm" className="hidden sm:inline">
                                •
                              </Text>
                            </Flex>
                            <Flex alignItems="center" gap="sm">
                              <Text size="sm">{document.uploadedAt}</Text>
                              {document.uploadedBy && (
                                <>
                                  <Text size="sm" className="hidden sm:inline">
                                    •
                                  </Text>
                                  <Text
                                    size="sm"
                                    style={{
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      maxWidth: '120px',
                                    }}
                                  >
                                    by{' '}
                                    {document.uploadedBy.length > 9
                                      ? `${document.uploadedBy.slice(0, 4)}...${document.uploadedBy.slice(-4)}`
                                      : document.uploadedBy}
                                  </Text>
                                </>
                              )}
                            </Flex>
                          </Flex>
                        </Box>
                      </Flex>
                      <Box
                        style={{
                          position: 'relative',
                          flexShrink: 0,
                          marginLeft: spacing[2].value,
                        }}
                      >
                        <Button
                          variant="secondary"
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuOpenDocId((prev) =>
                              prev === document.id ? null : document.id,
                            );
                          }}
                          style={{
                            padding: spacing[2].value,
                            borderRadius: '50%',
                            width: '40px',
                            height: '40px',
                          }}
                        >
                          <MoreVertical
                            style={{ width: '20px', height: '20px' }}
                          />
                        </Button>

                        {menuOpenDocId === document.id && (
                          <Box
                            style={{
                              position: 'absolute',
                              right: 0,
                              marginTop: spacing[2].value,
                              width: '256px',
                              borderRadius: radius.md.value,
                              backgroundColor: colors.background.primary.value,
                              padding: spacing[2].value,
                              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                              zIndex: 20,
                            }}
                          >
                            <Button
                              variant="secondary"
                              onClick={(e) => {
                                e.stopPropagation();
                                setMenuOpenDocId(null);
                                handleVerifyDocument(document);
                              }}
                              style={{
                                width: '100%',
                                justifyContent: 'flex-start',
                                gap: spacing[3].value,
                                marginBottom: spacing[2].value,
                              }}
                            >
                              <CheckCircle2
                                style={{ width: '16px', height: '16px' }}
                              />
                              <Text size="sm" weight="medium">
                                {verifyingDocId === document.id
                                  ? 'Verifying...'
                                  : 'Verify Document'}
                              </Text>
                            </Button>

                            <Box
                              style={{
                                margin: `${spacing[2].value} 0`,
                                borderTop: `1px solid ${colors.neutral[300].value}`,
                              }}
                            />

                            <Button
                              variant="secondary"
                              onClick={(e) => {
                                e.stopPropagation();
                                setMenuOpenDocId(null);
                                handleShowAuditTrail(document);
                              }}
                              style={{
                                width: '100%',
                                justifyContent: 'flex-start',
                                gap: spacing[3].value,
                              }}
                            >
                              <Clock
                                style={{
                                  width: '16px',
                                  height: '16px',
                                  color: colors.neutral[600].value,
                                }}
                              />
                              <Text size="sm" weight="medium">
                                View Audit Trail
                              </Text>
                            </Button>
                          </Box>
                        )}
                      </Box>
                    </Flex>

                    <Flex
                      alignItems="center"
                      style={{
                        padding: '0px',
                        margin: '0px',
                        backgroundColor: 'transparent',
                        borderRadius: '0px',
                        border: 'none',
                        boxShadow: 'none',
                        display: 'flex',
                        flexFlow: 'row',
                        alignItems: 'center',
                        position: 'static',
                        overflow: 'visible',
                        cursor: 'inherit',
                        justifyContent: 'space-between',
                        width: '100%',
                      }}
                    >
                      <Box>
                        <Text
                          size="sm"
                          weight="semibold"
                          style={{
                            padding: `${spacing[2].value} ${spacing[3].value}`,
                            borderRadius: radius.lg.value,
                            backgroundColor:
                              document.status === 'FullySigned'
                                ? 'rgba(22, 163, 74, 0.15)'
                                : document.status === 'PartiallySigned'
                                  ? 'rgba(234, 179, 8, 0.15)'
                                  : 'rgba(163, 163, 163, 0.15)',
                            color:
                              document.status === 'FullySigned'
                                ? '#16a34a'
                                : document.status === 'PartiallySigned'
                                  ? '#ca8a04'
                                  : '#737373',
                          }}
                        >
                          {document.status === 'FullySigned'
                            ? 'Fully Signed'
                            : document.status === 'PartiallySigned'
                              ? 'Partially Signed'
                              : 'Pending'}
                        </Text>
                      </Box>
                      <Flex alignItems="center" gap="sm">
                        <Button
                          variant="secondary"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDownloadDocument(document);
                          }}
                          style={{ padding: spacing[2].value }}
                        >
                          <Download
                            style={{
                              width: '16px',
                              height: '16px',
                              color: '#2563eb',
                            }}
                          />
                        </Button>
                        <Button
                          variant="error"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveDocument(document.id);
                          }}
                          style={{ padding: spacing[2].value }}
                        >
                          <Trash2 style={{ width: '16px', height: '16px' }} />
                        </Button>
                      </Flex>
                    </Flex>
                  </Card>
                </motion.div>
              ))}
            </Box>
          )}
        </motion.section>

        {/* Floating Action Button */}
        <Box
          style={{
            position: 'fixed',
            bottom: spacing[6].value,
            right: spacing[6].value,
            zIndex: 50,
          }}
        >
          <Button
            onClick={() => setShowUploadModal(true)}
            variant="primary"
            style={{
              height: '56px',
              width: '56px',
              borderRadius: '50%',
              boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
            }}
          >
            <Plus style={{ width: '24px', height: '24px' }} />
          </Button>
        </Box>
      </motion.div>

      {/* Invite Modal - Both URL and Payload Options */}
      {showInviteModal && (
        <Modal
          open={showInviteModal}
          onClose={() => {
            setShowInviteModal(false);
            setInvitationUrl(null);
            setGeneratedPayload('');
            setInviteId('');
            setInviteMode('url');
          }}
          title="Create Invitation"
        >
          <Box style={{ padding: spacing[6].value }}>
            {/* Mode Selection */}
            <Flex gap="sm" style={{ marginBottom: spacing[4].value }}>
              <Button
                variant={inviteMode === 'url' ? 'primary' : 'secondary'}
                onClick={() => {
                  setInviteMode('url');
                  setInvitationUrl(null);
                  setGeneratedPayload('');
                }}
                style={{ flex: 1 }}
              >
                Invitation URL
              </Button>
              <Button
                variant={inviteMode === 'payload' ? 'primary' : 'secondary'}
                onClick={() => {
                  setInviteMode('payload');
                  setInvitationUrl(null);
                  setGeneratedPayload('');
                }}
                style={{ flex: 1 }}
              >
                Invitation Payload
              </Button>
            </Flex>

            {inviteMode === 'url' ? (
              // URL Mode
              invitationUrl ? (
                <>
                  <Card
                    style={{
                      padding: spacing[4].value,
                      borderRadius: radius.md.value,
                      backgroundColor: colors.background.secondary.value,
                      marginBottom: spacing[4].value,
                    }}
                  >
                    <Text
                      size="sm"
                      weight="semibold"
                      style={{
                        color: colors.semantic.success.value,
                        marginBottom: spacing[2].value,
                      }}
                    >
                      ✓ Invitation Created
                    </Text>
                    <Text
                      size="sm"
                      style={{
                        color: colors.neutral[600].value,
                        marginBottom: spacing[3].value,
                      }}
                    >
                      Share this URL with participants to invite them to this
                      agreement:
                    </Text>
                    <Input
                      type="text"
                      value={invitationUrl}
                      disabled={true}
                      style={{
                        marginBottom: spacing[3].value,
                        fontFamily: 'monospace',
                        fontSize: '12px',
                      }}
                    />
                    <Button
                      onClick={handleCopyInvitationUrl}
                      variant="primary"
                      style={{ width: '100%' }}
                    >
                      Copy Invitation URL
                    </Button>
                  </Card>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setShowInviteModal(false);
                      setInvitationUrl(null);
                      setInviteMode('url');
                    }}
                    style={{ width: '100%' }}
                  >
                    Close
                  </Button>
                </>
              ) : (
                <>
                  <Text
                    size="sm"
                    style={{
                      color: colors.neutral[600].value,
                      marginBottom: spacing[4].value,
                    }}
                  >
                    Generate an invitation URL that participants can use to join
                    this agreement. They will be able to join by clicking the
                    link.
                  </Text>
                  <Button
                    onClick={handleGenerateOpenInvitation}
                    disabled={generatingInvite}
                    variant="primary"
                    style={{ width: '100%' }}
                  >
                    {generatingInvite ? (
                      <Flex alignItems="center" gap="sm">
                        <Loader size="small" />
                        <Text>Creating Invitation...</Text>
                      </Flex>
                    ) : (
                      'Create Invitation URL'
                    )}
                  </Button>
                </>
              )
            ) : // Payload Mode
            generatedPayload ? (
              <>
                <Card
                  style={{
                    padding: spacing[4].value,
                    borderRadius: radius.md.value,
                    backgroundColor: colors.background.secondary.value,
                    marginBottom: spacing[4].value,
                  }}
                >
                  <Text
                    size="sm"
                    weight="semibold"
                    style={{
                      color: colors.semantic.success.value,
                      marginBottom: spacing[2].value,
                    }}
                  >
                    ✓ Payload Generated
                  </Text>
                  <Text
                    size="sm"
                    style={{
                      color: colors.neutral[600].value,
                      marginBottom: spacing[3].value,
                    }}
                  >
                    Share this payload with the invitee to join this agreement:
                  </Text>
                  <Input
                    type="text"
                    value={generatedPayload}
                    disabled={true}
                    style={{
                      marginBottom: spacing[3].value,
                      fontFamily: 'monospace',
                      fontSize: '12px',
                    }}
                  />
                  <Button
                    onClick={handleCopyPayload}
                    variant="primary"
                    style={{ width: '100%' }}
                  >
                    Copy Payload
                  </Button>
                </Card>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setShowInviteModal(false);
                    setGeneratedPayload('');
                    setInviteId('');
                    setInviteMode('payload');
                  }}
                  style={{ width: '100%' }}
                >
                  Close
                </Button>
              </>
            ) : (
              <>
                <Text
                  size="sm"
                  style={{
                    color: colors.neutral[600].value,
                    marginBottom: spacing[4].value,
                  }}
                >
                  Generate an invitation payload for a specific invitee. You
                  need to know their user ID.
                </Text>
                <Input
                  type="text"
                  placeholder="Enter invitee ID"
                  value={inviteId}
                  onChange={(e) => setInviteId(e.target.value)}
                  disabled={generatingInvite}
                  style={{ marginBottom: spacing[4].value }}
                />
                <Button
                  onClick={handleGeneratePayload}
                  disabled={generatingInvite || !inviteId.trim()}
                  variant="primary"
                  style={{ width: '100%' }}
                >
                  {generatingInvite ? (
                    <Flex alignItems="center" gap="sm">
                      <Loader size="small" />
                      <Text>Generating Payload...</Text>
                    </Flex>
                  ) : (
                    'Generate Payload'
                  )}
                </Button>
              </>
            )}
          </Box>
        </Modal>
      )}

      {/* Upload Modal */}
      {showUploadModal && (
        <Modal
          open={showUploadModal}
          onClose={() => setShowUploadModal(false)}
          title="Upload Document"
        >
          <Box style={{ padding: spacing[6].value }}>
            {uploading && uploadFiles.length > 0 && (
              <Box
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: spacing[3].value,
                }}
              >
                <Heading size="sm" style={{ marginBottom: spacing[2].value }}>
                  Upload Progress
                </Heading>
                {uploadFiles.map((fileUpload, index) => (
                  <Box
                    key={index}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: spacing[2].value,
                    }}
                  >
                    <Flex alignItems="center" justifyContent="space-between">
                      <Text
                        size="sm"
                        style={{
                          flex: 1,
                          marginRight: spacing[2].value,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {fileUpload.file.name}
                      </Text>
                      <Text
                        size="sm"
                        style={{ color: colors.neutral[600].value }}
                      >
                        {fileUpload.uploaded
                          ? 'Complete'
                          : fileUpload.error
                            ? 'Error'
                            : `${getStageDescription(fileUpload.stage)} - ${Math.round(fileUpload.progress)}%`}
                      </Text>
                    </Flex>
                    <Box
                      style={{
                        width: '100%',
                        backgroundColor: colors.neutral[300].value,
                        borderRadius: radius.lg.value,
                        height: '8px',
                      }}
                    >
                      <Box
                        style={{
                          height: '8px',
                          borderRadius: radius.lg.value,
                          width: `${fileUpload.uploaded ? 100 : fileUpload.stageProgress ?? fileUpload.progress}%`,
                          backgroundColor: fileUpload.error
                            ? colors.semantic.error.value
                            : fileUpload.uploaded
                              ? colors.semantic.success.value
                              : colors.brand[600].value,
                          transition: 'all 0.3s',
                        }}
                      />
                    </Box>
                    {fileUpload.error && (
                      <Text
                        size="xs"
                        style={{
                          color: colors.semantic.error.value,
                          marginTop: spacing[2].value,
                        }}
                      >
                        {fileUpload.error}
                      </Text>
                    )}
                  </Box>
                ))}
              </Box>
            )}

            {uploading && uploadFiles.length === 0 && (
              <Box style={{ textAlign: 'center', padding: spacing[4].value }}>
                <Loader size="large" />
                <Text
                  size="sm"
                  style={{
                    color: colors.neutral[600].value,
                    marginTop: spacing[2].value,
                  }}
                >
                  Preparing upload...
                </Text>
              </Box>
            )}

            {error && (
              <Alert variant="error" style={{ marginBottom: spacing[4].value }}>
                {error}
              </Alert>
            )}

            {!uploading && (
              <Box style={{ textAlign: 'center' }}>
                <Upload
                  style={{
                    width: '64px',
                    height: '64px',
                    margin: '0 auto',
                    color: colors.neutral[600].value,
                    marginBottom: spacing[4].value,
                  }}
                />
                <Heading size="md" style={{ marginBottom: spacing[2].value }}>
                  Upload PDF Document
                </Heading>
                <Text
                  size="sm"
                  style={{
                    color: colors.neutral[600].value,
                    marginBottom: spacing[4].value,
                  }}
                >
                  Select a PDF file to upload for document signing
                </Text>
                <Button
                  onClick={handleUploadClick}
                  variant="primary"
                  disabled={uploading}
                  style={{ width: '100%', marginBottom: spacing[3].value }}
                >
                  <Upload
                    style={{
                      width: '16px',
                      height: '16px',
                      marginRight: spacing[2].value,
                    }}
                  />
                  Choose PDF File
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf"
                  onChange={handleFileUpload}
                  style={{ display: 'none' }}
                />
                <Text size="xs" style={{ color: colors.neutral[600].value }}>
                  Supports: PDF files only
                </Text>
              </Box>
            )}
          </Box>
        </Modal>
      )}

      {/* PDF Viewer Modal */}
      {showPDFViewer && selectedDocument && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="w-full max-w-4xl h-[90vh] max-h-[90vh] mt-16"
            style={{ marginTop: '4rem' }}
          >
            <PDFViewer
              file={selectedDocument.file || null}
              onClose={handleClosePDFViewer}
              title={selectedDocument.name}
              showDownload={true}
              showClose={true}
              maxHeight="90vh"
              className="w-full h-full"
              contextId={currentContextId || undefined}
              documentId={selectedDocument.id}
              documentHash={selectedDocument.hash}
              showSaveToContext={true}
              onDocumentSaved={() => {
                setShowPDFViewer(false);
                setSelectedDocument(null);
                loadDocuments();
              }}
            />
          </motion.div>
        </div>
      )}

      {/* Audit Trail Modal */}
      {showAuditTrail && selectedDocumentForAudit && currentContextId && (
        <AuditTrail
          contextId={currentContextId}
          documentId={selectedDocumentForAudit.id}
          documentName={selectedDocumentForAudit.name}
          onClose={handleCloseAuditTrail}
          isOpen={showAuditTrail}
        />
      )}

      {/* Verification Result Modal */}
      {showVerificationModal && selectedDocumentForVerification && (
        <Modal
          open={showVerificationModal}
          onClose={handleCloseVerificationModal}
          title="Document Verification"
        >
          <Box style={{ padding: spacing[6].value }}>
            <Card
              style={{
                padding: spacing[4].value,
                borderRadius: radius.md.value,
                backgroundColor: colors.background.secondary.value,
              }}
            >
              <Heading size="sm" style={{ marginBottom: spacing[2].value }}>
                Document: {selectedDocumentForVerification.name}
              </Heading>

              {verifyingDocId === selectedDocumentForVerification.id ? (
                <Flex
                  direction="column"
                  alignItems="center"
                  justifyContent="center"
                  style={{ padding: `${spacing[6].value} 0` }}
                >
                  <Loader size="large" />
                  <Text
                    size="sm"
                    style={{
                      color: colors.neutral[600].value,
                      marginTop: spacing[3].value,
                    }}
                  >
                    Verifying document...
                  </Text>
                </Flex>
              ) : verifyResult &&
                verifyResult.documentId ===
                  selectedDocumentForVerification.id ? (
                <Card
                  style={{
                    padding: spacing[4].value,
                    borderRadius: radius.md.value,
                    backgroundColor: verifyResult.error
                      ? colors.semantic.error.value
                      : verifyResult.verified
                        ? colors.semantic.success.value
                        : colors.semantic.warning.value,
                  }}
                >
                  {verifyResult.error ? (
                    <Box style={{ textAlign: 'center' }}>
                      <AlertCircle
                        style={{
                          width: '48px',
                          height: '48px',
                          margin: '0 auto',
                          color: '#dc2626',
                          marginBottom: spacing[3].value,
                        }}
                      />
                      <Text
                        size="md"
                        weight="medium"
                        style={{ color: '#dc2626' }}
                      >
                        Verification Failed
                      </Text>
                      <Text
                        size="sm"
                        style={{
                          color: '#dc2626',
                          marginTop: spacing[2].value,
                        }}
                      >
                        {verifyResult.error.message ||
                          'Unable to verify document'}
                      </Text>
                    </Box>
                  ) : verifyResult.verified ? (
                    <Box style={{ textAlign: 'center' }}>
                      <CheckCircle2
                        style={{
                          width: '48px',
                          height: '48px',
                          margin: '0 auto',
                          color: '#16a34a',
                          marginBottom: spacing[3].value,
                        }}
                      />
                      <Text
                        size="lg"
                        weight="medium"
                        style={{ color: '#16a34a' }}
                      >
                        VERIFIED
                      </Text>
                      <Text
                        size="sm"
                        style={{
                          color: '#16a34a',
                          marginTop: spacing[2].value,
                        }}
                      >
                        {verifyResult.message ||
                          'Document verification unavailable'}
                      </Text>
                    </Box>
                  ) : (
                    <Box style={{ textAlign: 'center' }}>
                      <AlertCircle
                        style={{
                          width: '48px',
                          height: '48px',
                          margin: '0 auto',
                          color: '#ca8a04',
                          marginBottom: spacing[3].value,
                        }}
                      />
                      <Text
                        size="md"
                        weight="medium"
                        style={{ color: '#ca8a04' }}
                      >
                        Not Verified
                      </Text>
                      <Text
                        size="sm"
                        style={{
                          color: '#ca8a04',
                          marginTop: spacing[2].value,
                        }}
                      >
                        {verifyResult.message ||
                          `Status: ${verifyResult.status || 'Unknown'}`}
                      </Text>
                    </Box>
                  )}
                </Card>
              ) : null}
            </Card>

            <Button
              onClick={handleCloseVerificationModal}
              variant="primary"
              style={{ width: '100%', marginTop: spacing[4].value }}
            >
              Close
            </Button>
          </Box>
        </Modal>
      )}
    </MobileLayout>
  );
};

export default AgreementPage;
