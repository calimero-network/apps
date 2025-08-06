import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getAppEndpointKey,
  getApplicationId,
  blobClient,
  SubscriptionsClient,
} from '@calimero-network/calimero-client';
import {
  ArrowLeft,
  Plus,
  Search,
  Users,
  Upload,
  FileText,
  Eye,
  X,
  Trash2,
  Download,
  AlertCircle,
  CheckCircle2,
  MoreVertical,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button, Card, CardContent } from '../../components/ui';
import { MobileLayout } from '../../components/MobileLayout';
import PDFViewer from '../../components/PDFViewer';
import { useTheme } from '../../contexts/ThemeContext';
import { DocumentService } from '../../api/documentService';
import {
  ClientApiDataSource,
  getWsSubscriptionsClient,
} from '../../api/dataSource/ClientApiDataSource';
import { ContextApiDataSource } from '../../api/dataSource/nodeApiDataSource';
import { ContextDetails, PermissionLevel } from '../../api/clientApi';
import { useIcpAuth } from '../../contexts/IcpAuthContext';

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
  <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ type: 'spring', stiffness: 300, damping: 25 }}
      className={`relative p-8 rounded-2xl shadow-2xl border w-full max-w-sm text-center ${
        notification.type === 'success'
          ? 'bg-green-100 border-green-300 text-green-900 dark:bg-gray-800 dark:border-green-600 dark:text-green-200'
          : 'bg-red-100 border-red-300 text-red-900 dark:bg-gray-800 dark:border-red-600 dark:text-red-200'
      }`}
    >
      <div className="flex flex-col items-center justify-center">
        {notification.type === 'success' ? (
          <CheckCircle2 className="w-16 h-16 mb-5 text-green-500" />
        ) : (
          <AlertCircle className="w-16 h-16 mb-5 text-red-500" />
        )}
        <p className="text-lg font-medium">{notification.message}</p>
      </div>
    </motion.div>
  </div>
);

const generateInvitePayload = async (
  nodeApiService: ContextApiDataSource,
  contextId: string,
  inviter: string,
  invitee: string,
): Promise<string> => {
  try {
    const response = await nodeApiService.inviteToContext({
      contextId,
      inviter,
      invitee,
    });

    if (response && typeof response === 'object' && 'data' in response) {
      return response.data as string;
    }

    if (typeof response === 'string') {
      return response;
    }

    return JSON.stringify(response, null, 2);
  } catch (error) {
    console.error('Failed to generate invite:', error);
    return `INVITE_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
};

const AgreementPage: React.FC = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { mode } = useTheme();
  const { identity } = useIcpAuth();
  const documentService = useMemo(() => new DocumentService(), []);
  const clientApiService = useMemo(() => new ClientApiDataSource(), []);
  const nodeApiService = useMemo(() => new ContextApiDataSource(), []);

  const [searchQuery, setSearchQuery] = useState('');
  const [showParticipants, setShowParticipants] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteId, setInviteId] = useState('');
  const [invitePermission, setInvitePermission] = useState<PermissionLevel>(
    PermissionLevel.Sign,
  );
  const [generatedPayload, setGeneratedPayload] = useState('');
  const [showPayloadDialog, setShowPayloadDialog] = useState(false);
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
  } | null>(null);

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
    const url = getAppEndpointKey();
    const applicationId = getApplicationId();

    if (!url || !applicationId) {
      navigate('/setup');
      return;
    }

    if (!currentContextId) {
      console.error('No context ID available');
      return;
    }

    loadContextDetails();
    loadDocuments();
  }, [navigate, loadContextDetails, loadDocuments, currentContextId]);

  const handleFileUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (!files || !currentContextId) return;

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
        },
      ]);

      const response = await documentService.uploadDocument(
        currentContextId,
        file.name,
        file,
        agreementContextID || undefined,
        agreementContextUserID || undefined,
        (progress: number) => {
          setUploadFiles((prev) => prev.map((f) => ({ ...f, progress })));
        },
        identity,
      );

      if (response.error) {
        setUploadFiles((prev) =>
          prev.map((f) => ({
            ...f,
            uploading: false,
            error: response.error.message,
          })),
        );
        setUploading(false);
        setError(response.error.message);
        console.error(`Failed to upload ${file.name}:`, response.error);
      } else {
        setUploadFiles((prev) =>
          prev.map((f) => ({
            ...f,
            uploading: false,
            uploaded: true,
            progress: 100,
          })),
        );
        setUploading(false);
        setError(null);
        setShowUploadModal(false);
        setUploadFiles([]);
        if (fileInputRef.current) fileInputRef.current.value = '';
        showNotification('Document uploaded successfully!', 'success');
        await loadDocuments();
      }
    },
    [
      documentService,
      currentContextId,
      loadDocuments,
      showNotification,
      identity,
    ],
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

      try {
        setLoadingPDFPreview(true);

        const blob = await blobClient.downloadBlob(document.pdfBlobId);

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
    [currentContextId, showNotification],
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

      try {
        const blob = await blobClient.downloadBlob(doc.pdfBlobId);
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
    [currentContextId, showNotification],
  );

  const handleGenerateInvite = useCallback(async () => {
    if (!currentContextId || !inviteId.trim()) {
      showNotification('Please enter a valid invitee ID.', 'error');
      return;
    }

    const agreementContextUserID = localStorage.getItem(
      'agreementContextUserID',
    );

    const agreementContextID = localStorage.getItem('agreementContextID');

    if (!agreementContextUserID) {
      showNotification(
        'User ID not found. Please ensure you are logged in.',
        'error',
      );
      return;
    }

    try {
      setGeneratingInvite(true);
      const payload = await generateInvitePayload(
        nodeApiService,
        currentContextId,
        agreementContextUserID,
        inviteId.trim(),
      );
      setGeneratedPayload(payload);
      setShowPayloadDialog(true);
      setShowInviteModal(false);

      const addResp = await clientApiService.addParticipant(
        currentContextId,
        inviteId.trim(),
        invitePermission,
        agreementContextID || undefined,
        agreementContextUserID || undefined,
      );
      if (addResp.error) {
        showNotification(
          'Failed to add participant: ' + addResp.error.message,
          'error',
        );
      }
      setInviteId('');
      setInvitePermission(PermissionLevel.Sign);
    } catch (error) {
      console.error('Failed to generate invite:', error);
      showNotification('Failed to generate invite. Please try again.', 'error');
    } finally {
      setGeneratingInvite(false);
    }
  }, [
    currentContextId,
    inviteId,
    invitePermission,
    nodeApiService,
    clientApiService,
    showNotification,
  ]);

  const handleCopyPayload = useCallback(() => {
    navigator.clipboard.writeText(generatedPayload);
    showNotification('Payload copied to clipboard!', 'success');
    setShowPayloadDialog(false);
  }, [generatedPayload, showNotification]);

  const handleVerifyDocument = useCallback(
    async (doc: UploadedDocument) => {
      setVerifyingDocId(doc.id);
      setVerifyResult(null);
      try {
        const result = await documentService.verifyDocumentWithICP(
          doc.id, // <-- send the document id here
          doc.hash || '',
          identity,
        );
        setVerifyResult(result);
      } catch (error) {
        setVerifyResult({ error: { message: 'Verification failed.' } });
      } finally {
        setVerifyingDocId(null);
      }
    },
    [documentService, identity],
  );

  useEffect(() => {
    let subscriptionsClient: SubscriptionsClient | null = null;

    const observeEvents = async () => {
      if (!currentContextId) return;

      try {
        subscriptionsClient = getWsSubscriptionsClient();
        await subscriptionsClient.connect();
        subscriptionsClient.subscribe([currentContextId]);

        subscriptionsClient?.addCallback(async (data: any) => {
          try {
            if (data.type === 'StateMutation') {
              await Promise.all([loadDocuments(), loadContextDetails()]);
            }
          } catch (err) {
            console.error('Error handling state mutation event:', err);
          }
        });
      } catch (err) {
        console.error('Failed to subscribe to context events:', err);
      }
    };

    observeEvents();

    return () => {
      if (subscriptionsClient) {
        subscriptionsClient.disconnect();
      }
    };
  }, [currentContextId, loadDocuments, loadContextDetails]);

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
          <Card className="border-border/50">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate('/')}
                    className="p-2 h-auto w-auto"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </Button>
                  <div>
                    <h1 className="text-lg font-semibold text-foreground">
                      {contextDetails?.context_name || 'Loading...'}
                    </h1>
                    <p className="text-sm text-muted-foreground">
                      {contextDetails?.participant_count || 0} participants
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowParticipants(!showParticipants)}
                    className="p-2 h-auto w-auto"
                  >
                    <Users className="w-5 h-5" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.section>

        {/* Participants Panel */}
        {showParticipants && (
          <motion.section
            variants={ANIMATION_VARIANTS.item}
            initial="hidden"
            animate="visible"
            className="bg-green-100 dark:bg-green-900/20 border border-green-300 dark:border-green-800 rounded-lg p-4"
          >
            <div className="flex items-center justify-between mb-4">
              <h3
                className={`font-medium ${mode === 'dark' ? 'text-green-300' : 'text-green-900'}`}
              >
                Participants
              </h3>
              <Button
                onClick={() => setShowInviteModal(true)}
                size="sm"
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                <Plus className="w-4 h-4 mr-1" />
                Invite
              </Button>
            </div>
            <div className="space-y-3">
              {contextDetails?.participants?.map((participant) => (
                <div
                  key={participant.user_id}
                  className="flex items-center space-x-3"
                >
                  <div className="w-8 h-8 bg-green-600 rounded-full flex items-center justify-center">
                    <span className="text-white text-sm font-medium">
                      {participant.user_id.slice(0, 2).toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {participant.user_id.slice(0, 6)}...
                      {participant.user_id.slice(-4)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {participant.permission_level}
                    </p>
                  </div>
                </div>
              )) || (
                <div className="text-sm text-muted-foreground">
                  {contextLoading
                    ? 'Loading participants...'
                    : 'No participants found'}
                </div>
              )}
            </div>
          </motion.section>
        )}

        {/* Search Bar */}
        <motion.section variants={ANIMATION_VARIANTS.item} className="px-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search documents..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 sm:py-3 text-sm sm:text-base border border-border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all duration-300"
            />
          </div>
        </motion.section>

        {/* Documents List */}
        <motion.section variants={ANIMATION_VARIANTS.item}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-foreground">
              Uploaded Documents
            </h3>
            <span className="text-sm text-muted-foreground">
              {filteredDocuments.length} documents
            </span>
          </div>

          {loading && (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
              <p className="text-muted-foreground mt-2">Loading documents...</p>
            </div>
          )}

          {error && !loading && (
            <div className="text-center py-8">
              <p className="text-red-500 mb-4">{error}</p>
              <Button onClick={loadDocuments} variant="outline">
                Try Again
              </Button>
            </div>
          )}

          {!loading && !error && filteredDocuments.length === 0 && (
            <Card className="border-border/50">
              <CardContent className="p-8 text-center">
                <FileText className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">
                  No documents uploaded yet. Upload your first PDF to get
                  started.
                </p>
              </CardContent>
            </Card>
          )}

          {!loading && !error && filteredDocuments.length > 0 && (
            <div className="space-y-4">
              {filteredDocuments.map((document) => (
                <motion.div
                  key={document.id}
                  variants={ANIMATION_VARIANTS.item}
                  whileHover={{ y: -2, scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  onClick={() => handleOpenDocument(document)}
                  className="cursor-pointer"
                >
                  <Card className="hover:shadow-lg hover:shadow-primary/5 transition-all duration-300 border-border/50 hover:border-primary/20">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center space-x-3 flex-1">
                          <div className="p-2 bg-red-100 dark:bg-red-900/20 rounded-lg">
                            <FileText className="w-6 h-6 text-red-600" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="font-medium text-foreground mb-1 truncate">
                              {document.name}
                            </h4>
                            <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                              <span>{document.size}</span>
                              <span>•</span>
                              <span>{document.uploadedAt}</span>
                              {document.uploadedBy && (
                                <>
                                  <span>•</span>
                                  <span>
                                    by {document.uploadedBy.slice(0, 8)}...
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                        {/* 3 dots menu */}
                        <div className="relative">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="p-2 h-auto w-auto"
                            onClick={(e) => {
                              e.stopPropagation();
                              setMenuOpenDocId(
                                menuOpenDocId === document.id
                                  ? null
                                  : document.id,
                              );
                            }}
                          >
                            <MoreVertical className="w-5 h-5" />
                          </Button>
                          {menuOpenDocId === document.id && (
                            <div className="absolute right-0 mt-2 w-56 rounded-lg border border-border bg-background/95 p-1 shadow-lg backdrop-blur-sm z-10">
                              <button
                                className="w-full text-center px-3 py-1.5 text-sm text-foreground hover:bg-muted transition rounded-md flex items-center justify-center"
                                onClick={() => {
                                  setMenuOpenDocId(null);
                                  handleVerifyDocument(document);
                                }}
                                disabled={verifyingDocId === document.id}
                              >
                                {verifyingDocId === document.id
                                  ? 'Verifying...'
                                  : 'Verify on ICP'}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Verification result */}
                      {verifyResult && menuOpenDocId === document.id && (
                        <div className="mt-2 p-3 rounded bg-muted text-sm">
                          {verifyResult.error ? (
                            <span className="text-red-600">
                              {verifyResult.error.message}
                            </span>
                          ) : (
                            <span
                              className={
                                verifyResult.verified
                                  ? 'text-green-600'
                                  : 'text-yellow-700'
                              }
                            >
                              {verifyResult.message
                                ? verifyResult.message
                                : `ICP Verification Status: ${verifyResult.status}`}
                            </span>
                          )}
                        </div>
                      )}

                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <div
                            className={`text-sm px-2 py-1 rounded-full ${
                              document.status === 'FullySigned'
                                ? 'bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-300'
                                : document.status === 'PartiallySigned'
                                  ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-300'
                                  : 'bg-gray-100 text-gray-700 dark:bg-gray-900/20 dark:text-gray-300'
                            }`}
                          >
                            {document.status === 'FullySigned'
                              ? 'Fully Signed'
                              : document.status === 'PartiallySigned'
                                ? 'Partially Signed'
                                : 'Pending'}
                          </div>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDownloadDocument(document);
                            }}
                            className="p-2 h-auto w-auto text-blue-600 hover:text-blue-700"
                          >
                            <Download className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveDocument(document.id);
                            }}
                            className="p-2 h-auto w-auto text-red-600 hover:text-red-700"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>
          )}
        </motion.section>

        {/* Floating Action Button */}
        <motion.div
          variants={ANIMATION_VARIANTS.item}
          className="fixed bottom-6 right-6 z-50"
        >
          <Button
            onClick={() => setShowUploadModal(true)}
            className="h-14 w-14 rounded-full shadow-lg hover:shadow-xl transition-all duration-300 aspect-square"
            size="lg"
          >
            <Plus className="w-6 h-6 text-white dark:text-black" />
          </Button>
        </motion.div>
      </motion.div>

      {/* Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className={`rounded-lg p-6 w-full max-w-md border border-border shadow-2xl ${
              mode === 'dark' ? 'bg-gray-900' : 'bg-white'
            }`}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-foreground">
                Manage Members
              </h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowInviteModal(false)}
                disabled={generatingInvite}
                className="p-1 h-auto w-auto"
              >
                <X className="w-5 h-5" />
              </Button>
            </div>

            <div className="space-y-4">
              <div className="bg-muted rounded-lg p-4">
                <h5 className="font-medium text-foreground mb-2">
                  Create Invite
                </h5>
                <input
                  type="text"
                  placeholder="Enter the ID of invitee"
                  value={inviteId}
                  onChange={(e) => setInviteId(e.target.value)}
                  disabled={generatingInvite}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent mb-3 disabled:opacity-50 disabled:cursor-not-allowed"
                />

                {/* Permission Level Selection (Radio Buttons) */}
                <label className="block text-sm font-medium text-foreground mb-2 mt-2">
                  Permission Level
                </label>
                <div className="space-y-2">
                  <label className="flex items-center">
                    <input
                      type="radio"
                      value={PermissionLevel.Sign}
                      checked={invitePermission === PermissionLevel.Sign}
                      onChange={() => setInvitePermission(PermissionLevel.Sign)}
                      className="mr-3 text-primary"
                      disabled={generatingInvite}
                    />
                    <div>
                      <span className="font-medium text-foreground">
                        Signer
                      </span>
                      <p className="text-xs text-muted-foreground">
                        Can view and sign documents
                      </p>
                    </div>
                  </label>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      value={PermissionLevel.Read}
                      checked={invitePermission === PermissionLevel.Read}
                      onChange={() => setInvitePermission(PermissionLevel.Read)}
                      className="mr-3 text-primary"
                      disabled={generatingInvite}
                    />
                    <div>
                      <span className="font-medium text-foreground">
                        Viewer
                      </span>
                      <p className="text-xs text-muted-foreground">
                        Can only view documents
                      </p>
                    </div>
                  </label>
                </div>

                <Button
                  onClick={handleGenerateInvite}
                  disabled={generatingInvite || !inviteId.trim()}
                  className="w-full text-white dark:text-black text-lg mt-4"
                >
                  {generatingInvite ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current mr-2"></div>
                      Generating...
                    </>
                  ) : (
                    'Generate Invite'
                  )}
                </Button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Payload Dialog */}
      {showPayloadDialog && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className={`rounded-lg p-6 w-full max-w-md border border-border shadow-2xl ${
              mode === 'dark' ? 'bg-gray-900' : 'bg-white'
            }`}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-foreground">
                Generated Invite Payload
              </h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowPayloadDialog(false)}
                className="p-1 h-auto w-auto"
              >
                <X className="w-5 h-5" />
              </Button>
            </div>

            <div className="space-y-4">
              <div className="bg-muted rounded-lg p-4">
                <p className="text-sm text-muted-foreground mb-2">
                  Your invite payload:
                </p>
                <div className="bg-background border border-border rounded-lg p-3 break-all text-sm font-mono min-h-[100px] flex items-center">
                  {generatedPayload || 'Loading...'}
                </div>
              </div>

              <div className="flex space-x-2">
                <Button
                  onClick={handleCopyPayload}
                  className="flex-1 text-white dark:text-black"
                >
                  Copy Payload
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowPayloadDialog(false)}
                  className="flex-1"
                >
                  Close
                </Button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className={`rounded-lg p-6 w-full max-w-md border border-border shadow-2xl ${
              mode === 'dark' ? 'bg-gray-900' : 'bg-white'
            }`}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-foreground">
                Upload Document
              </h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowUploadModal(false)}
                className="p-1 h-auto w-auto"
                disabled={uploading}
              >
                <X className="w-5 h-5" />
              </Button>
            </div>

            <div className="space-y-4">
              {uploading && uploadFiles.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-foreground mb-2">
                    Upload Progress
                  </h4>
                  {uploadFiles.map((fileUpload, index) => (
                    <div key={index} className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-foreground truncate flex-1 mr-2">
                          {fileUpload.file.name}
                        </span>
                        <span className="text-muted-foreground">
                          {fileUpload.uploaded
                            ? 'Complete'
                            : fileUpload.error
                              ? 'Error'
                              : `${Math.round(fileUpload.progress)}%`}
                        </span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2">
                        <div
                          className={`h-2 rounded-full transition-all duration-300 ${
                            fileUpload.error
                              ? 'bg-red-500'
                              : fileUpload.uploaded
                                ? 'bg-green-500'
                                : 'bg-primary'
                          }`}
                          style={{
                            width: `${fileUpload.uploaded ? 100 : fileUpload.progress}%`,
                          }}
                        />
                      </div>
                      {fileUpload.error && (
                        <p className="text-xs text-red-500 mt-1">
                          {fileUpload.error}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {uploading && uploadFiles.length === 0 && (
                <div className="text-center py-4">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
                  <p className="text-sm text-muted-foreground">
                    Preparing upload...
                  </p>
                </div>
              )}

              {error && (
                <div className="p-3 bg-red-100 border border-red-300 rounded-lg">
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              {!uploading && (
                <div className="text-center">
                  <Upload className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
                  <h4 className="text-lg font-semibold text-foreground mb-2 ">
                    Upload PDF Document
                  </h4>
                  <p className="text-sm text-muted-foreground mb-4">
                    Select a PDF file to upload for document signing
                  </p>
                  <Button
                    onClick={handleUploadClick}
                    className="w-full mb-3 text-white dark:text-black"
                    disabled={uploading}
                  >
                    <Upload className="w-4 h-4 mr-2 text-white dark:text-black" />
                    Choose PDF File
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <p className="text-xs text-muted-foreground">
                    Supports: PDF files only
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        </div>
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
    </MobileLayout>
  );
};

export default AgreementPage;
