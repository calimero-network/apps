import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Clock,
  User,
  FileText,
  Check,
  UserPlus,
  Shield,
  X,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import { Button } from './ui/button';
import { Card, CardContent } from './ui';
import { useTheme } from '../contexts/ThemeContext';
import { backendService } from '../api/icp/backendService';
import { AuditEntry as IcpAuditEntry } from '../api/icp/types';
import {
  generateIcpDocumentId,
  formatUserId,
  formatTimestamp,
} from '../lib/utils';

interface AuditEntry extends Omit<IcpAuditEntry, 'timestamp' | 'action'> {
  action: string;
  timestamp: Date;
}

interface AuditTrailProps {
  contextId: string;
  documentId: string;
  documentName: string;
  onClose: () => void;
  isOpen: boolean;
}

const getActionIcon = (action: string) => {
  switch (action) {
    case 'DocumentUploaded':
      return <FileText className="w-5 h-5" />;
    case 'ConsentGiven':
      return <Shield className="w-5 h-5" />;
    case 'SignatureApplied':
      return <Check className="w-5 h-5" />;
    case 'DocumentCompleted':
      return <Check className="w-5 h-5" />;
    case 'SignerAdded':
      return <UserPlus className="w-5 h-5" />;
    default:
      return <Clock className="w-5 h-5" />;
  }
};

const getActionColor = (action: string) => {
  switch (action) {
    case 'DocumentUploaded':
      return 'text-blue-600 bg-blue-100 dark:bg-blue-900/20';
    case 'ConsentGiven':
      return 'text-orange-600 bg-orange-100 dark:bg-orange-900/20';
    case 'SignatureApplied':
      return 'text-green-600 bg-green-100 dark:bg-green-900/20';
    case 'DocumentCompleted':
      return 'text-emerald-600 bg-emerald-100 dark:bg-emerald-900/20';
    case 'SignerAdded':
      return 'text-indigo-600 bg-indigo-100 dark:bg-indigo-900/20';
    default:
      return 'text-gray-600 bg-gray-100 dark:bg-gray-900/20';
  }
};

const getActionTitle = (action: string) => {
  switch (action) {
    case 'DocumentUploaded':
      return 'Document Uploaded';
    case 'ConsentGiven':
      return 'Consent Given';
    case 'SignatureApplied':
      return 'Signature Applied';
    case 'DocumentCompleted':
      return 'Document Completed';
    case 'SignerAdded':
      return 'Signer Added';
    default:
      return action;
  }
};

const AuditTrail: React.FC<AuditTrailProps> = ({
  contextId,
  documentId,
  documentName,
  onClose,
  isOpen,
}) => {
  const { mode } = useTheme();
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(
    new Set(),
  );

  const loadAuditTrail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Step 1: Sanitize document ID (matches DocumentService.sanitizeDocumentId)
      const sanitizedDocumentId = documentId.replace(/[^a-zA-Z0-9_-]/g, '_');

      // Step 2: Generate ICP Document ID for display purposes only
      const icpDocumentId = generateIcpDocumentId(
        contextId,
        sanitizedDocumentId,
      );

      // Debug logging - standardized ID tracking
      console.log('🔍 Audit Trail ID Standardization:');
      console.log('  • Context ID:', contextId);
      console.log('  • Original Document ID:', documentId);
      console.log('  • Sanitized Document ID:', sanitizedDocumentId);
      console.log('  • Display ICP Document ID:', icpDocumentId);
      console.log(
        '  • Backend Query ID (sanitized only):',
        sanitizedDocumentId,
      );

      // Step 3: Get backend service and query with SANITIZED ID ONLY
      const service = await backendService();
      console.log('✅ Backend service initialized');

      // Step 4: Query ICP canister with SANITIZED document ID (not the combined ICP ID)
      console.log(
        '📡 Querying ICP canister with sanitized ID:',
        sanitizedDocumentId,
      );
      const auditResult = await service.getAuditTrail(sanitizedDocumentId);
      console.log('📋 ICP canister response:', auditResult);

      if (auditResult) {
        console.log('✅ Audit result exists, processing entries...');
        console.log('Number of entries:', auditResult.entries?.length || 0);
        console.log('Raw entries:', auditResult.entries);

        // Transform ICP audit entries to component format
        const transformedEntries: AuditEntry[] = auditResult.entries.map(
          (entry) => {
            console.log('🔄 Transforming entry:', entry);
            console.log('🔄 Entry action type:', typeof entry.action);
            console.log('🔄 Entry action value:', entry.action);

            // Convert action object to string
            let actionString = 'Unknown';
            if (typeof entry.action === 'object' && entry.action !== null) {
              // Action comes as object like {DocumentUploaded: null} or {DocumentCompleted: null}
              const actionKey = Object.keys(entry.action)[0];
              actionString = actionKey || 'Unknown';
              console.log('🔄 Extracted action key:', actionString);
            } else if (typeof entry.action === 'string') {
              actionString = entry.action;
            }

            // Convert optional arrays to proper values
            const consentGiven =
              Array.isArray(entry.consent_given) &&
              entry.consent_given.length > 0
                ? entry.consent_given[0]
                : undefined;

            const documentHashAfterAction =
              Array.isArray(entry.document_hash_after_action) &&
              entry.document_hash_after_action.length > 0
                ? entry.document_hash_after_action[0]
                : undefined;

            const metadata =
              Array.isArray(entry.metadata) && entry.metadata.length > 0
                ? entry.metadata[0]
                : undefined;

            const transformedEntry = {
              entry_id: entry.entry_id,
              user_id: entry.user_id,
              action: actionString,
              timestamp: entry.timestampDate, // Already converted in backendService
              consent_given: consentGiven,
              document_hash_after_action: documentHashAfterAction,
              metadata: metadata,
            };

            console.log('🔄 Transformed entry result:', transformedEntry);

            // Verify no objects are being passed as React children (except Date objects which are handled)
            Object.keys(transformedEntry).forEach((key) => {
              const value =
                transformedEntry[key as keyof typeof transformedEntry];
              if (
                value !== null &&
                value !== undefined &&
                typeof value === 'object' &&
                !(value instanceof Date)
              ) {
                console.error(`❌ Object found in ${key}:`, value);
              }
            });

            return transformedEntry;
          },
        );

        console.log('🔄 Transformed entries:', transformedEntries);

        // Sort entries by timestamp (newest first)
        transformedEntries.sort(
          (a, b) => b.timestamp.getTime() - a.timestamp.getTime(),
        );

        console.log('📅 Sorted entries:', transformedEntries);
        setAuditEntries(transformedEntries);
      } else {
        console.log('❌ No audit result returned from backend');
        setAuditEntries([]);
      }
    } catch (err) {
      console.error('💥 Failed to load audit trail:', err);
      console.error('Error details:', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        contextId,
        originalDocumentId: documentId,
        sanitizedDocumentId: documentId.replace(/[^a-zA-Z0-9_-]/g, '_'),
        backendQueryId: documentId.replace(/[^a-zA-Z0-9_-]/g, '_'),
        displayIcpDocumentId: generateIcpDocumentId(
          contextId,
          documentId.replace(/[^a-zA-Z0-9_-]/g, '_'),
        ),
      });
      setError(
        'Failed to load audit trail from blockchain: ' +
          (err instanceof Error ? err.message : String(err)),
      );
      setAuditEntries([]);
    } finally {
      setLoading(false);
    }
  }, [contextId, documentId]);

  useEffect(() => {
    if (isOpen) {
      loadAuditTrail();
    }
  }, [isOpen, loadAuditTrail]);

  const toggleEntryExpansion = (entryId: string) => {
    const newExpanded = new Set(expandedEntries);
    if (newExpanded.has(entryId)) {
      newExpanded.delete(entryId);
    } else {
      newExpanded.add(entryId);
    }
    setExpandedEntries(newExpanded);
  };

  const hasDetails = (entry: AuditEntry) => {
    return !!(
      entry.metadata ||
      entry.document_hash_after_action ||
      entry.consent_given !== undefined
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        className={`w-full max-w-4xl max-h-[90vh] rounded-xl shadow-2xl border overflow-hidden ${
          mode === 'dark'
            ? 'bg-gray-900 border-gray-700'
            : 'bg-white border-gray-200'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div>
            <h2 className="text-xl font-semibold text-foreground mb-1">
              Audit Trail
            </h2>
            <p className="text-sm text-muted-foreground">
              Complete blockchain audit history for "{documentName}"
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="p-2 h-auto w-auto"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Content */}
        <div className="p-6 max-h-[calc(90vh-120px)] overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="flex flex-col items-center space-y-3">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">
                  Loading audit trail...
                </p>
              </div>
            </div>
          )}

          {error && !loading && (
            <div className="flex items-center justify-center py-12">
              <Card className="border-red-200 dark:border-red-800">
                <CardContent className="p-6 text-center">
                  <AlertCircle className="w-12 h-12 mx-auto text-red-500 mb-4" />
                  <p className="text-red-600 dark:text-red-400 mb-4">{error}</p>
                  <div className="text-xs text-muted-foreground space-y-1 mb-4">
                    <div>
                      <strong>ID Standardization Debug:</strong>
                    </div>
                    <div>• Original Document ID: {documentId}</div>
                    <div>
                      • Sanitized Document ID:{' '}
                      {documentId.replace(/[^a-zA-Z0-9_-]/g, '_')}
                    </div>
                    <div>• Context ID: {contextId.slice(0, 20)}...</div>
                    <div>
                      • Backend Query ID:{' '}
                      {documentId.replace(/[^a-zA-Z0-9_-]/g, '_')}
                    </div>
                    <div>
                      • Display ICP Document ID:{' '}
                      {generateIcpDocumentId(
                        contextId,
                        documentId.replace(/[^a-zA-Z0-9_-]/g, '_'),
                      )}
                    </div>
                  </div>
                  <Button
                    onClick={loadAuditTrail}
                    variant="outline"
                    size="sm"
                    className="border-red-300 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400"
                  >
                    Try Again
                  </Button>
                </CardContent>
              </Card>
            </div>
          )}

          {!loading && !error && auditEntries.length === 0 && (
            <div className="flex items-center justify-center py-12">
              <Card className="border-border/50">
                <CardContent className="p-8 text-center">
                  <Clock className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground mb-4">
                    No audit entries found for this document on the blockchain.
                  </p>
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>Document ID: {documentId}</p>
                    <p>Context ID: {contextId.slice(0, 20)}...</p>
                    <p className="mt-2">
                      Audit entries are created when documents are uploaded,
                      viewed, signed, or when consent is given.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {!loading && !error && auditEntries.length > 0 && (
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground mb-4">
                {auditEntries.length} audit{' '}
                {auditEntries.length === 1 ? 'entry' : 'entries'} found
              </div>

              {auditEntries.map((entry, index) => {
                const isExpanded = expandedEntries.has(entry.entry_id);
                const showDetails = hasDetails(entry);

                return (
                  <motion.div
                    key={entry.entry_id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1 }}
                  >
                    <Card className="border-border/50 hover:shadow-md transition-all duration-200">
                      <CardContent className="p-4">
                        <div className="flex items-start space-x-4">
                          {/* Timeline dot */}
                          <div className="relative flex-shrink-0">
                            <div
                              className={`w-10 h-10 rounded-full flex items-center justify-center ${getActionColor(entry.action)}`}
                            >
                              {getActionIcon(entry.action)}
                            </div>
                            {index < auditEntries.length - 1 && (
                              <div className="absolute top-10 left-1/2 w-px h-8 bg-border transform -translate-x-1/2" />
                            )}
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between">
                              <div>
                                <h3 className="font-medium text-foreground mb-1">
                                  {getActionTitle(entry.action)}
                                </h3>
                                <div className="flex items-center space-x-3 text-sm text-muted-foreground mb-2">
                                  <div className="flex items-center space-x-1">
                                    <User className="w-4 h-4" />
                                    <span>{formatUserId(entry.user_id)}</span>
                                  </div>
                                  <div className="flex items-center space-x-1">
                                    <Clock className="w-4 h-4" />
                                    <span>
                                      {formatTimestamp(entry.timestamp)}
                                    </span>
                                  </div>
                                </div>
                              </div>

                              {showDetails && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    toggleEntryExpansion(entry.entry_id)
                                  }
                                  className="p-1 h-auto w-auto ml-2"
                                >
                                  {isExpanded ? (
                                    <ChevronDown className="w-4 h-4" />
                                  ) : (
                                    <ChevronRight className="w-4 h-4" />
                                  )}
                                </Button>
                              )}
                            </div>

                            {/* Expanded details */}
                            <AnimatePresence>
                              {isExpanded && showDetails && (
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: 'auto', opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  transition={{ duration: 0.2 }}
                                  className="overflow-hidden"
                                >
                                  <div className="mt-3 p-3 bg-muted rounded-lg space-y-2">
                                    {entry.consent_given !== undefined && (
                                      <div className="flex items-center space-x-2 text-sm">
                                        <span className="font-medium text-foreground">
                                          Consent:
                                        </span>
                                        <span
                                          className={
                                            entry.consent_given
                                              ? 'text-green-600'
                                              : 'text-red-600'
                                          }
                                        >
                                          {entry.consent_given
                                            ? 'Given'
                                            : 'Not Given'}
                                        </span>
                                      </div>
                                    )}
                                    {entry.document_hash_after_action && (
                                      <div className="space-y-1 text-sm">
                                        <span className="font-medium text-foreground">
                                          Document Hash:
                                        </span>
                                        <div className="font-mono text-xs text-muted-foreground break-all bg-background p-2 rounded border">
                                          {entry.document_hash_after_action}
                                        </div>
                                      </div>
                                    )}
                                    {entry.metadata && (
                                      <div className="space-y-1 text-sm">
                                        <span className="font-medium text-foreground">
                                          Metadata:
                                        </span>
                                        <div className="text-muted-foreground bg-background p-2 rounded border text-xs">
                                          {entry.metadata}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border bg-muted/30">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              All entries are cryptographically secured on the Internet Computer
              blockchain
            </p>
            <Button onClick={onClose} variant="outline" size="sm">
              Close
            </Button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default AuditTrail;
