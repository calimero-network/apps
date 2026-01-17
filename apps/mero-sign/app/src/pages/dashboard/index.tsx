import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCalimero, apiClient } from '@calimero-network/calimero-client';
import type { ResponseData } from '@calimero-network/calimero-client';
import type { NodeIdentity } from '@calimero-network/calimero-client/lib/api/nodeApi';
import {
  FileText,
  Plus,
  ArrowRight,
  Layers,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Button,
  Card,
  Input,
  SearchInput,
  Heading,
  Text,
  Box,
  Flex,
  Modal,
  Loader,
  Alert,
  Spacer,
  spacing,
  colors,
  radius,
} from '@calimero-network/mero-ui';
import { MobileLayout } from '../../components/MobileLayout';
import { AgreementService } from '../../api/agreementService';
import { ContextApiDataSource } from '../../api/dataSource/nodeApiDataSource';
import { ClientApiDataSource } from '../../api/dataSource/ClientApiDataSource';
import { Agreement } from '../../api/clientApi';
import { UserPlus, Key, Copy } from 'lucide-react';
import { Textarea } from '@calimero-network/mero-ui';

type NotificationType = 'success' | 'error';
interface NotificationState {
  message: string;
  type: NotificationType;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { app } = useCalimero();
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [agreementName, setAgreementName] = useState('');
  const [invitationPayload, setInvitationPayload] = useState('');
  const [contextName, setContextName] = useState('');
  const [generatedIdentity, setGeneratedIdentity] =
    useState<NodeIdentity | null>(null);
  const [generatingIdentity, setGeneratingIdentity] = useState(false);
  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalNotification, setModalNotification] =
    useState<NotificationState | null>(null);

  const agreementService = useMemo(() => new AgreementService(app), [app]);
  const nodeApiService = useMemo(() => new ContextApiDataSource(app), [app]);
  const clientApiService = useMemo(() => new ClientApiDataSource(app), [app]);

  const showModalNotification = useCallback(
    (message: string, type: NotificationType) => {
      setModalNotification({ message, type });
      setTimeout(() => {
        setModalNotification(null);
      }, 1500);
    },
    [],
  );

  const loadAgreements = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await agreementService.listAgreements();

      if (response.error) {
        console.error('Dashboard: Error from listAgreements:', response.error);
        setError(response.error.message);
        setAgreements([]);
      } else {
        setAgreements(response.data || []);
      }
    } catch (err) {
      console.error('Failed to load agreements:', err);
      setError('Failed to load agreements');
      setAgreements([]);
    } finally {
      setLoading(false);
    }
  }, [agreementService]);

  useEffect(() => {
    if (app) {
      loadAgreements();
    }
  }, [app, loadAgreements]);

  const stats = [
    {
      label: 'Active Agreements',
      value: agreements.length,
      icon: Layers,
      color: 'text-blue-600',
      bg: 'bg-blue-100 dark:bg-blue-900/20',
    },
  ];

  const filteredContexts = agreements.filter((agreement) => {
    if (!agreement.name) {
      return false;
    }
    const matchesSearch = agreement.name
      .toLowerCase()
      .includes(searchQuery.toLowerCase());
    return matchesSearch;
  });

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
        delayChildren: 0.2,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
  };

  const handleCreateAgreement = async () => {
    if (!agreementName.trim()) return;

    try {
      setCreating(true);
      setError(null);

      const response = await agreementService.createAgreement(
        agreementName.trim(),
      );

      if (response.error) {
        setError(response.error.message);
        return;
      }

      // Show success notification for 1 second before closing
      showModalNotification('Agreement created successfully!', 'success');

      // Wait for notification to be visible
      await new Promise((resolve) => setTimeout(resolve, 1500));

      setShowCreateModal(false);
      setAgreementName('');
      await loadAgreements();
    } catch (err) {
      console.error('Failed to create agreement:', err);
      setError('Failed to create agreement');
    } finally {
      setCreating(false);
    }
  };

  const handleGenerateIdentity = async () => {
    try {
      setGeneratingIdentity(true);
      setError(null);

      const response: ResponseData<NodeIdentity> = await apiClient
        .node()
        .createNewIdentity();

      if (response.error) {
        setError(response.error.message || 'Failed to create identity');
        return;
      }

      if (response.data) {
        setGeneratedIdentity(response.data);
        // Auto-save to localStorage
        localStorage.setItem(
          'new-context-identity',
          JSON.stringify(response.data),
        );
        showModalNotification('Identity created successfully!', 'success');
      }
    } catch (err) {
      console.error('Failed to generate identity:', err);
      setError('Failed to generate identity');
    } finally {
      setGeneratingIdentity(false);
    }
  };

  const handleCopyIdentity = () => {
    if (generatedIdentity?.publicKey) {
      navigator.clipboard.writeText(generatedIdentity.publicKey);
      showModalNotification('Public key copied to clipboard!', 'success');
    }
  };

  const handleJoinByPayload = async () => {
    if (!invitationPayload.trim()) {
      setError('Please enter a valid invitation payload');
      return;
    }

    try {
      setJoining(true);
      setError(null);

      // If identity was generated, save it for potential future use
      if (generatedIdentity) {
        localStorage.setItem(
          'new-context-identity',
          JSON.stringify(generatedIdentity),
        );
      }

      const joinResponse = await nodeApiService.joinContext({
        invitationPayload: invitationPayload.trim(),
      });

      if (joinResponse.error) {
        setError(joinResponse.error.message || 'Failed to join context');
        return;
      }

      if (!joinResponse.data) {
        setError('No data received from join context response');
        return;
      }

      const { contextId, memberPublicKey } = joinResponse.data;

      // Validate that both contextId and memberPublicKey are present
      if (!contextId || !memberPublicKey) {
        setError(
          'Invalid join response: missing contextId or memberPublicKey',
        );
        return;
      }

      localStorage.setItem('agreementContextID', contextId);
      localStorage.setItem('agreementContextUserID', memberPublicKey);

      // Wait a bit for context to sync after joining
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Register self as participant in the shared context
      // This is required for users joining via payload invitation
      let registerSuccess = false;
      let registerAttempts = 0;
      const maxRegisterAttempts = 5;

      while (!registerSuccess && registerAttempts < maxRegisterAttempts) {
        registerAttempts++;
        try {
          const registerResponse = await clientApiService.registerSelfAsParticipant(
            contextId,
            memberPublicKey,
          );

          if (registerResponse.error) {
            const errorMessage = registerResponse.error.message || '';

            // If already registered, that's fine - continue
            if (errorMessage.includes('Already registered')) {
              console.log('Already registered as participant');
              registerSuccess = true;
            } else if (
              errorMessage.includes('Uninitialized') &&
              registerAttempts < maxRegisterAttempts
            ) {
              // State not ready yet, wait and retry
              console.log(
                `Register attempt ${registerAttempts} failed with Uninitialized, retrying...`,
              );
              await new Promise((resolve) => setTimeout(resolve, 2000));
            } else {
              console.warn(
                'Failed to register as participant:',
                registerResponse.error,
              );
              // Don't block the flow - user can still proceed
              registerSuccess = true;
            }
          } else {
            console.log('Successfully registered as participant in context');
            registerSuccess = true;
          }
        } catch (error) {
          console.warn(
            `Error registering as participant (attempt ${registerAttempts}):`,
            error,
          );
          if (registerAttempts < maxRegisterAttempts) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
          } else {
            // Don't block the flow - user can still proceed
            registerSuccess = true;
          }
        }
      }

      const joinSharedResponse = await clientApiService.joinSharedContext(
        contextId,
        memberPublicKey,
        contextName.trim() || 'Agreement',
      );

      if (joinSharedResponse.error) {
        setError(
          'Failed to join shared context: ' + joinSharedResponse.error.message,
        );
        return;
      }

      showModalNotification('Successfully joined agreement!', 'success');
      setShowJoinModal(false);
      setInvitationPayload('');
      setContextName('');
      await loadAgreements();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join agreement');
    } finally {
      setJoining(false);
    }
  };

  const handleAgreementClick = (agreement: Agreement) => {
    localStorage.setItem('agreementContextID', agreement.contextId);
    localStorage.setItem('agreementContextUserID', agreement.sharedIdentity);

    navigate('/agreement');
  };

  return (
    <MobileLayout>
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        style={{
          padding: `${spacing[6].value} 0`,
          display: 'flex',
          flexDirection: 'column',
          gap: spacing[6].value,
          color: 'var(--current-text)',
        }}
      >
        {/* Header */}
        <motion.section variants={itemVariants}>
          <Box style={{ marginBottom: spacing[4].value }}>
            <Heading size="xl" style={{ marginBottom: spacing[2].value, color: 'var(--current-text)' }}>
              Dashboard
            </Heading>
            <Text size="sm" className="text-muted-foreground">
              Manage your agreements and documents
            </Text>
          </Box>

          {/* Button and Stats Row */}
          <Flex
            className="flex-col sm:flex-row items-stretch"
            style={{ gap: spacing[3].value }}
          >
            <Flex
              style={{ gap: spacing[2].value }}
              className="w-full sm:w-auto flex-shrink-0"
            >
              <Button
                onClick={() => setShowCreateModal(true)}
                variant="primary"
                style={{ height: '52px', padding: `0 ${spacing[4].value}` }}
                className="w-full sm:w-auto flex-1 sm:flex-none min-w-0"
              >
                <Plus className="w-4 h-4 mr-2" />
                New Agreement
              </Button>
              <Button
                onClick={() => setShowJoinModal(true)}
                variant="secondary"
                style={{ height: '52px', padding: `0 ${spacing[4].value}` }}
                className="w-full sm:w-auto flex-1 sm:flex-none min-w-0"
              >
                <UserPlus className="w-4 h-4 mr-2" />
                Join Agreement
              </Button>
            </Flex>

            <Box className="flex-1">
              {stats.map((stat, index) => {
                const Icon = stat.icon;
                return (
                  <Card
                    key={index}
                    className="w-full"
                    style={{
                      padding: spacing[3].value,
                      height: '52px',
                      borderRadius: radius.md.value,
                    }}
                  >
                    <Flex
                      style={{
                        alignItems: 'center',
                        gap: spacing[3].value,
                        height: '100%',
                      }}
                    >
                      <Box
                        className={`flex-shrink-0`}
                        style={{
                          padding: spacing[2].value,
                          borderRadius: '50%',
                          backgroundColor: 'var(--current-surface)',
                        }}
                      >
                        <Icon
                          className={`w-4 h-4`}
                          style={{ color: colors.brand[600].value }}
                        />
                      </Box>
                      <Flex
                        style={{
                          minWidth: 0,
                          gap: spacing[2].value,
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          flex: 1,
                        }}
                      >
                        <Text size="lg" weight="bold" style={{ color: 'var(--current-text)' }}>
                          {stat.value}
                        </Text>
                        <Text
                          size="sm"
                          className="text-muted-foreground truncate"
                        >
                          {stat.label}
                        </Text>
                      </Flex>
                    </Flex>
                  </Card>
                );
              })}
            </Box>
          </Flex>
        </motion.section>

        {/* Search */}
        <motion.section
          variants={itemVariants}
          style={{
            paddingLeft: spacing[2].value,
            paddingRight: spacing[2].value,
          }}
        >
          <SearchInput
            placeholder="Search agreements ..."
            value={searchQuery}
            onChange={setSearchQuery}
            className="w-full"
          />
        </motion.section>

        {/* Context Cards */}
        <motion.section variants={itemVariants}>
          <Flex
            className="flex-col sm:flex-row sm:items-center sm:justify-between"
            style={{ gap: spacing[3].value, marginBottom: spacing[4].value }}
          >
            <Heading size="lg" style={{ color: 'var(--current-text)' }}>Your Agreements</Heading>
          </Flex>

          {loading && (
            <Box
              className="text-center"
              style={{ padding: `${spacing[6].value} 0` }}
            >
              <Loader size="large" />
              <Spacer size="sm" />
              <Text size="sm" className="text-muted-foreground">
                Loading agreements...
              </Text>
            </Box>
          )}

          {error && !loading && (
            <Box
              className="text-center"
              style={{ padding: `${spacing[6].value} 0` }}
            >
              <Alert variant="error" style={{ marginBottom: spacing[4].value }}>
                {error}
              </Alert>
              <Button onClick={loadAgreements} variant="secondary">
                Try Again
              </Button>
            </Box>
          )}

          {!loading && !error && filteredContexts.length === 0 && (
            <Box
              className="text-center"
              style={{ padding: `${spacing[6].value} 0` }}
            >
              <FileText
                className="w-16 h-16 mx-auto text-muted-foreground"
                style={{ marginBottom: spacing[4].value }}
              />
              <Heading size="md" style={{ marginBottom: spacing[2].value, color: 'var(--current-text)' }}>
                No agreements found
              </Heading>
              <Text
                size="sm"
                className="text-muted-foreground"
                style={{ marginBottom: spacing[4].value }}
              >
                Create your first agreement to get started with document
                management.
              </Text>
            </Box>
          )}

          {!loading && !error && filteredContexts.length > 0 && (
            <div
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
              style={{ gap: spacing[6].value }}
            >
              {filteredContexts.map((context) => (
                <motion.div
                  key={context.id}
                  whileHover={{ y: -2, scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  onClick={() => handleAgreementClick(context)}
                  className="cursor-pointer"
                >
                  <Card
                    className="group h-full hover:shadow-lg transition-all duration-300"
                    style={{
                      borderRadius: radius.md.value,
                      padding: spacing[6].value,
                    }}
                  >
                    <Box>
                      {/* Header */}
                      <Flex
                        style={{
                          alignItems: 'flex-start',
                          justifyContent: 'space-between',
                          marginBottom: spacing[4].value,
                        }}
                      >
                        <Box className="flex-1">
                          <Heading
                            size="sm"
                            className="group-hover:text-primary transition-colors duration-300 line-clamp-1"
                            style={{ marginBottom: spacing[2].value, color: 'var(--current-text)' }}
                          >
                            {context.name}
                          </Heading>
                          <Text
                            size="xs"
                            className="text-muted-foreground leading-relaxed line-clamp-2"
                          >
                            Context ID: {context.contextId.slice(0, 6)}...
                            {context.contextId.slice(-4)}
                          </Text>
                        </Box>
                      </Flex>

                      {/* Content */}
                      <Box>
                        {/* Footer */}
                        <Flex
                          style={{
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            paddingTop: spacing[2].value,
                            borderTop: '1px solid',
                            borderColor: 'var(--current-border)',
                          }}
                        >
                          <Text size="xs" className="text-muted-foreground">
                            Joined:{' '}
                            {new Date(
                              context.joinedAt / 1000000,
                            ).toLocaleDateString()}
                          </Text>
                          <ArrowRight className="w-3 h-3 sm:w-4 sm:h-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all duration-300" />
                        </Flex>
                      </Box>
                    </Box>
                  </Card>
                </motion.div>
              ))}
            </div>
          )}
        </motion.section>
      </motion.div>

      {/* Create Agreement Modal */}
      {showCreateModal && (
        <Modal
          open={showCreateModal}
          onClose={() => {
            setShowCreateModal(false);
            setAgreementName('');
            setError(null);
          }}
          title="Create New Agreement"
        >
          <Box
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: spacing[4].value,
            }}
          >
            {/* Notification inside modal */}
            <AnimatePresence>
              {modalNotification && showCreateModal && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.3 }}
                >
                  <Alert
                    variant={
                      modalNotification.type === 'success' ? 'success' : 'error'
                    }
                    style={{ marginBottom: spacing[2].value }}
                  >
                    <Flex alignItems="center" gap="sm">
                      {modalNotification.type === 'success' ? (
                        <CheckCircle2 className="w-4 h-4" />
                      ) : (
                        <AlertCircle className="w-4 h-4" />
                      )}
                      <Text size="sm" weight="medium">
                        {modalNotification.message}
                      </Text>
                    </Flex>
                  </Alert>
                </motion.div>
              )}
            </AnimatePresence>

            <Box>
              <Text
                size="sm"
                weight="medium"
                style={{ marginBottom: spacing[2].value, color: 'var(--current-text)' }}
              >
                Agreement Name
              </Text>
              <Input
                id="agreementName"
                type="text"
                value={agreementName}
                onChange={(e) => setAgreementName(e.target.value)}
                placeholder="Enter agreement name..."
                autoFocus
              />
            </Box>

            {error && <Alert variant="error">{error}</Alert>}

            <Flex
              style={{ gap: spacing[3].value, paddingTop: spacing[4].value }}
            >
              <Button
                onClick={() => {
                  setShowCreateModal(false);
                  setAgreementName('');
                  setError(null);
                }}
                variant="secondary"
                className="flex-1"
                disabled={creating}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateAgreement}
                variant="primary"
                className="flex-1"
                disabled={!agreementName.trim() || creating}
              >
                {creating ? 'Creating...' : 'Create'}
              </Button>
            </Flex>
          </Box>
        </Modal>
      )}

      {/* Join Agreement Modal */}
      {showJoinModal && (
        <Modal
          open={showJoinModal}
          onClose={() => {
            setShowJoinModal(false);
            setInvitationPayload('');
            setContextName('');
            setGeneratedIdentity(null);
            setError(null);
          }}
          title="Join Agreement"
        >
          <Box style={{ padding: spacing[6].value }}>
            <Text
              size="sm"
              style={{
                marginBottom: spacing[4].value,
                color: 'var(--current-text-secondary)',
              }}
            >
              Generate a new identity (optional) or paste the invitation payload
              to join an agreement.
            </Text>

            {/* Generate Identity Section */}
            <Box style={{ marginBottom: spacing[4].value }}>
              <Flex
                style={{
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: spacing[2].value,
                }}
              >
                <Text size="sm" weight="medium" style={{ color: 'var(--current-text)' }}>
                  Identity
                </Text>
                <Button
                  onClick={handleGenerateIdentity}
                  disabled={generatingIdentity || !!generatedIdentity}
                  variant="secondary"
                  style={{ height: '36px', padding: `0 ${spacing[3].value}` }}
                >
                  {generatingIdentity ? (
                    <Flex alignItems="center" gap="sm">
                      <Loader size="small" />
                      <Text size="sm">Generating...</Text>
                    </Flex>
                  ) : generatedIdentity ? (
                    <Flex alignItems="center" gap="sm">
                      <CheckCircle2 className="w-4 h-4" />
                      <Text size="sm">Generated</Text>
                    </Flex>
                  ) : (
                    <Flex alignItems="center" gap="sm">
                      <Key className="w-4 h-4" />
                      <Text size="sm">Generate ID</Text>
                    </Flex>
                  )}
                </Button>
              </Flex>

              {generatedIdentity && (
                <Card
                  style={{
                    padding: spacing[3].value,
                    borderRadius: radius.md.value,
                    backgroundColor: 'var(--current-surface)',
                    marginTop: spacing[2].value,
                  }}
                >
                  <Text
                    size="xs"
                    weight="medium"
                    style={{
                      color: 'var(--current-text-secondary)',
                      marginBottom: spacing[2].value,
                    }}
                  >
                    Public Key
                  </Text>
                  <Flex
                    style={{
                      alignItems: 'center',
                      gap: spacing[2].value,
                    }}
                  >
                    <Input
                      type="text"
                      value={generatedIdentity.publicKey}
                      disabled={true}
                      style={{
                        flex: 1,
                        fontFamily: 'monospace',
                        fontSize: '11px',
                      }}
                    />
                    <Button
                      onClick={handleCopyIdentity}
                      variant="secondary"
                      style={{
                        minWidth: '80px',
                        height: '36px',
                      }}
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  </Flex>
                </Card>
              )}
            </Box>

            <Box style={{ marginBottom: spacing[4].value }}>
              <Text
                size="sm"
                weight="medium"
                style={{ marginBottom: spacing[2].value }}
              >
                Invitation Payload
              </Text>
              <Textarea
                value={invitationPayload}
                onChange={(e) => setInvitationPayload(e.target.value)}
                placeholder="Paste invitation payload..."
                rows={4}
                disabled={joining}
              />
            </Box>

            <Box style={{ marginBottom: spacing[4].value }}>
              <Text
                size="sm"
                weight="medium"
                style={{ marginBottom: spacing[2].value }}
              >
                Context Name (Optional)
              </Text>
              <Input
                value={contextName}
                onChange={(e) => setContextName(e.target.value)}
                placeholder="Enter context name"
                disabled={joining}
              />
            </Box>

            {error && (
              <Alert variant="error" style={{ marginBottom: spacing[4].value }}>
                {error}
              </Alert>
            )}

            <Flex gap="sm">
              <Button
                variant="secondary"
                onClick={() => {
                  setShowJoinModal(false);
                  setInvitationPayload('');
                  setContextName('');
                  setError(null);
                }}
                style={{ flex: 1 }}
                disabled={joining}
              >
                Cancel
              </Button>
              <Button
                onClick={handleJoinByPayload}
                variant="primary"
                style={{ flex: 1 }}
                disabled={!invitationPayload.trim() || joining}
              >
                {joining ? (
                  <Flex alignItems="center" gap="sm">
                    <Loader size="small" />
                    <Text>Joining...</Text>
                  </Flex>
                ) : (
                  'Join Agreement'
                )}
              </Button>
            </Flex>
          </Box>
        </Modal>
      )}
    </MobileLayout>
  );
}
