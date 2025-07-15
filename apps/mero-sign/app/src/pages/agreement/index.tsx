import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getAccessToken,
  getAppEndpointKey,
  getApplicationId,
  getRefreshToken,
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
} from 'lucide-react';
import { motion } from 'framer-motion';
import { Button, Card, CardContent } from '../../components/ui';
import { MobileLayout } from '../../components/MobileLayout';
import PDFViewer from '../../components/PDFViewer';
import { useTheme } from '../../contexts/ThemeContext';

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

// Types
interface UploadedDocument {
  id: string;
  name: string;
  size: string;
  file: File;
  uploadedAt: string;
}

interface AgreementData {
  id: string;
  name: string;
  description: string;
  participants: number;
  status: string;
  owner: string;
  created: string;
}

// Utility functions
const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const generateInvitePayload = (): string => {
  return `INVITE_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

const AgreementPage: React.FC = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { mode } = useTheme();

  // State management
  const [searchQuery, setSearchQuery] = useState('');
  const [showParticipants, setShowParticipants] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteId, setInviteId] = useState('');
  const [generatedPayload, setGeneratedPayload] = useState('');
  const [showPayloadDialog, setShowPayloadDialog] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [documents, setDocuments] = useState<UploadedDocument[]>([]);
  const [selectedDocument, setSelectedDocument] =
    useState<UploadedDocument | null>(null);
  const [showPDFViewer, setShowPDFViewer] = useState(false);

  // Mock data
  const currentAgreement: AgreementData = useMemo(
    () => ({
      id: '1',
      name: 'Legal Team Workspace',
      description: 'Contract management and legal document collaboration',
      participants: 4,
      status: 'active',
      owner: 'Sarah Johnson',
      created: '2 weeks ago',
    }),
    [],
  );

  // Memoized filtered documents
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
    const accessToken = getAccessToken();
    const refreshToken = getRefreshToken();

    if (!url || !applicationId) {
      navigate('/setup');
      return;
    }

    if (!accessToken || !refreshToken) {
      navigate('/auth');
    }
  }, [navigate]);

  const handleFileUpload = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (!files) return;

      let uploadedCount = 0;
      Array.from(files).forEach((file) => {
        if (file.type === 'application/pdf') {
          const newDocument: UploadedDocument = {
            id: Math.random().toString(36).substring(2),
            name: file.name,
            size: formatFileSize(file.size),
            file: file,
            uploadedAt: new Date().toLocaleString(),
          };
          setDocuments((prev) => [...prev, newDocument]);
          uploadedCount++;
        } else {
          alert(
            `"${file.name}" is not a PDF file. Please upload only PDF files.`,
          );
        }
      });

      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      setShowUploadModal(false);
      if (uploadedCount > 0) {
        const message =
          uploadedCount === 1
            ? '1 document uploaded successfully!'
            : `${uploadedCount} documents uploaded successfully!`;
        alert(message);
      }
    },
    [],
  );

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleRemoveDocument = useCallback((documentId: string) => {
    setDocuments((prev) => prev.filter((doc) => doc.id !== documentId));
  }, []);

  const handleOpenDocument = useCallback((document: UploadedDocument) => {
    setSelectedDocument(document);
    setShowPDFViewer(true);
  }, []);

  const handleClosePDFViewer = useCallback(() => {
    setShowPDFViewer(false);
    setSelectedDocument(null);
  }, []);

  const handleGenerateInvite = useCallback(() => {
    const payload = generateInvitePayload();
    setGeneratedPayload(payload);
    setShowPayloadDialog(true);
    setShowInviteModal(false);
  }, []);

  const handleCopyPayload = useCallback(() => {
    navigator.clipboard.writeText(generatedPayload);
    alert('Payload copied to clipboard!');
    setShowPayloadDialog(false);
  }, [generatedPayload]);

  return (
    <MobileLayout>
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
                      {currentAgreement.name}
                    </h1>
                    <p className="text-sm text-muted-foreground">
                      {currentAgreement.participants} participants
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
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-green-600 rounded-full flex items-center justify-center">
                  <span className="text-white text-sm font-medium">JD</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    John Doe
                  </p>
                  <p className="text-xs text-muted-foreground">Owner</p>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-green-600 rounded-full flex items-center justify-center">
                  <span className="text-white text-sm font-medium">JS</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Jane Smith
                  </p>
                  <p className="text-xs text-muted-foreground">Signer</p>
                </div>
              </div>
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

          {filteredDocuments.length === 0 ? (
            <Card className="border-border/50">
              <CardContent className="p-8 text-center">
                <FileText className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">
                  No documents uploaded yet. Upload your first PDF to get
                  started.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {filteredDocuments.map((document) => (
                <motion.div
                  key={document.id}
                  variants={ANIMATION_VARIANTS.item}
                  whileHover={{ y: -2, scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
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
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="text-sm text-muted-foreground">
                          Ready for signing
                        </div>
                        <div className="flex items-center space-x-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleOpenDocument(document)}
                            className="p-2 h-auto w-auto"
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveDocument(document.id)}
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
                  className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent mb-3"
                />
                <div className="text-center text-sm text-muted-foreground mb-3">
                  OR
                </div>
                <select className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent mb-3">
                  <option>Enter From Contacts</option>
                </select>
                <Button
                  onClick={handleGenerateInvite}
                  className="w-full text-white dark:text-black text-lg"
                >
                  Generate Invite
                </Button>
              </div>

              <Button variant="outline" className="w-full">
                <Plus className="w-4 h-4 mr-2" />
                Add A Member
              </Button>
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
                <div className="bg-background border border-border rounded-lg p-3 break-all text-sm font-mono">
                  {generatedPayload}
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
              >
                <X className="w-5 h-5" />
              </Button>
            </div>

            <div className="space-y-4">
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
                >
                  <Upload className="w-4 h-4 mr-2 text-white dark:text-black" />
                  Choose PDF File
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf"
                  multiple
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <p className="text-xs text-muted-foreground">
                  Supports: PDF files only
                </p>
              </div>
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
            className="w-full max-w-4xl h-[90vh] max-h-[90vh]"
          >
            <PDFViewer
              file={selectedDocument.file}
              onClose={handleClosePDFViewer}
              title={selectedDocument.name}
              showDownload={true}
              showClose={true}
              maxHeight="90vh"
              className="w-full h-full"
            />
          </motion.div>
        </div>
      )}
    </MobileLayout>
  );
};

export default AgreementPage;
