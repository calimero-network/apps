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
import {
  formatUserId,
  formatTimestamp,
} from '../lib/utils';

interface AuditEntry {
  entry_id: string;
  user_id: string;
  action: string;
  timestamp: Date;
  consent_given?: boolean;
  document_hash_after_action?: string;
  metadata?: string;
  context_id: string;
  document_id: string;
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
      //TODO: Implement Calimero-based audit trail
      setError(
        'Audit trail functionality is currently unavailable. This feature will be re-implemented using Calimero.',
      );
      setAuditEntries([]);
    } catch (err) {
      console.error('💥 Failed to load audit trail:', err);
      setError(
        'Failed to load audit trail: ' +
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
              Audit history for "{documentName}"
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
                    Audit trail functionality is currently unavailable.
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
              Audit trail functionality will be available with Calimero integration
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
