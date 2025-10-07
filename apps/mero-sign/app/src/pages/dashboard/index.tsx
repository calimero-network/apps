import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCalimero, apiClient } from '@calimero-network/calimero-client';
import {
  FileText,
  Plus,
  ArrowRight,
  Layers,
  UserPlus,
  CheckCircle2,
  AlertCircle,
  Key,
  Copy,
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
  Textarea,
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
  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinProgress, setJoinProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [generatedIdentity, setGeneratedIdentity] = useState<string>('');
  const [generatingIdentity, setGeneratingIdentity] = useState(false);
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

  const handleJoinAgreement = async () => {
    if (!invitationPayload.trim()) {
      setError('Please enter a valid invitation payload');
      return;
    }
    if (!contextName.trim()) {
      setError('Please enter the context name you are joining');
      return;
    }

    const payload = invitationPayload.trim();

    if (payload.length < 10) {
      setError('Invitation payload appears to be invalid (too short)');
      return;
    }

    try {
      setJoining(true);
      setError(null);
      setJoinProgress('Joining context...');

      const joinResponse = await nodeApiService.joinContext({
        invitationPayload: payload,
      });

      if (joinResponse.error) {
        console.error('Join context error:', joinResponse.error);
        setError(joinResponse.error.message || 'Failed to join context');
        setJoining(false);
        return;
      }

      setJoinProgress('Storing context information...');
      if (!joinResponse.data) {
        setError('No data received from join context response');
        setJoining(false);
        return;
      }

      const { contextId, memberPublicKey } = joinResponse.data;
      if (!contextId || !memberPublicKey) {
        setError('Invalid join context response data');
        setJoining(false);
        return;
      }

      localStorage.setItem('agreementContextID', contextId);
      localStorage.setItem('agreementContextUserID', memberPublicKey);

      setJoinProgress('Joining shared context...');

      const joinSharedResponse = await clientApiService.joinSharedContext(
        contextId,
        memberPublicKey,
        contextName.trim(),
      );

      if (joinSharedResponse.error) {
        console.error('Join shared context error:', joinSharedResponse.error);
        setError(
          'Failed to join shared context: ' + joinSharedResponse.error.message,
        );
        setJoining(false);
        return;
      }

      setJoinProgress('Finalizing...');

      showModalNotification('Successfully joined agreement!', 'success');

      await new Promise((resolve) => setTimeout(resolve, 1500));

      setShowJoinModal(false);
      setInvitationPayload('');
      setContextName('');
      setGeneratedIdentity('');

      await loadAgreements();
    } catch (err) {
      console.error('Failed to join agreement:', err);
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to join agreement';
      setError(errorMessage);
    } finally {
      setJoining(false);
      setJoinProgress('');
    }
  };

  const handleGenerateIdentity = async () => {
    try {
      setGeneratingIdentity(true);
      setError(null);

      // Create new identity
      const identityResponse = await apiClient.node().createNewIdentity();

      if (identityResponse.error) {
        setError(
          'Failed to generate identity: ' + identityResponse.error.message,
        );
        return;
      }

      if (identityResponse.data) {
        // Extract the public key or ID from the NodeIdentity object
        const identity = identityResponse.data as any;
        const identityId =
          identity.publicKey || identity.id || JSON.stringify(identity);
        setGeneratedIdentity(identityId);
        showModalNotification('Identity generated successfully!', 'success');
      } else {
        setError('No identity data received');
      }
    } catch (err) {
      console.error('Failed to generate identity:', err);
      setError('Failed to generate identity');
    } finally {
      setGeneratingIdentity(false);
    }
  };

  const handleCopyIdentity = () => {
    if (generatedIdentity) {
      navigator.clipboard.writeText(generatedIdentity);
      showModalNotification('Identity copied to clipboard!', 'success');
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
        }}
      >
        {/* Header */}
        <motion.section variants={itemVariants}>
          <Box style={{ marginBottom: spacing[4].value }}>
            <Heading size="xl" style={{ marginBottom: spacing[2].value }}>
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
                          backgroundColor: colors.background.secondary.value,
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
                        <Text size="lg" weight="bold">
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
            <Heading size="lg">Your Agreements</Heading>
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
              <Heading size="md" style={{ marginBottom: spacing[2].value }}>
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
                            style={{ marginBottom: spacing[2].value }}
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
                            borderColor:
                              colors.neutral[200]?.value || '#e5e7eb',
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
                style={{ marginBottom: spacing[2].value }}
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
            setGeneratedIdentity('');
            setError(null);
            setJoinProgress('');
          }}
          title="Join Agreement"
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
              {modalNotification && showJoinModal && (
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
                style={{ marginBottom: spacing[2].value }}
              >
                Invitation Payload
              </Text>
              <Textarea
                value={invitationPayload}
                onChange={(e) => setInvitationPayload(e.target.value)}
                placeholder="Paste the invitation payload you received..."
                rows={4}
                disabled={joining}
              />
              <Text
                size="xs"
                className="text-muted-foreground"
                style={{ marginTop: spacing[2].value }}
              >
                Enter the invitation payload shared by the agreement owner
              </Text>
            </Box>

            <Box>
              <Text
                size="sm"
                weight="medium"
                style={{ marginBottom: spacing[2].value }}
              >
                Context Name
              </Text>
              <Input
                id="contextName"
                type="text"
                value={contextName}
                onChange={(e) => setContextName(e.target.value)}
                placeholder="Enter the name of the context you are joining"
                disabled={joining}
              />
              <Text
                size="xs"
                className="text-muted-foreground"
                style={{ marginTop: spacing[2].value }}
              >
                This will be used as the name for the joined context
              </Text>
            </Box>

            {/* Identity Generation Section */}
            <Box>
              <Flex
                style={{
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: spacing[2].value,
                }}
              >
                <Text size="sm" weight="medium">
                  Identity
                </Text>
                <Button
                  onClick={handleGenerateIdentity}
                  variant="secondary"
                  disabled={joining || generatingIdentity}
                  style={{ height: '32px', padding: `0 ${spacing[3].value}` }}
                >
                  {generatingIdentity ? (
                    <>
                      <Loader size="small" />
                      <Spacer size="xs" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Key className="w-3 h-3 mr-1" />
                      Generate Identity
                    </>
                  )}
                </Button>
              </Flex>

              {generatedIdentity && (
                <Box
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: spacing[2].value,
                  }}
                >
                  <Flex style={{ gap: spacing[2].value, alignItems: 'center' }}>
                    <Input
                      type="text"
                      value={generatedIdentity}
                      disabled
                      className="font-mono text-sm flex-1"
                    />
                    <Button
                      onClick={handleCopyIdentity}
                      variant="secondary"
                      style={{
                        height: '40px',
                        width: '40px',
                        padding: 0,
                        flexShrink: 0,
                      }}
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  </Flex>
                  <Text size="xs" className="text-muted-foreground">
                    Your generated identity. Click the copy button to copy it to
                    clipboard.
                  </Text>
                </Box>
              )}

              {!generatedIdentity && (
                <Text size="xs" className="text-muted-foreground">
                  Generate a new identity. This is sending your identity to
                  other users for creating invitation payload for you to join
                  agreements.
                </Text>
              )}
            </Box>

            {error && <Alert variant="error">{error}</Alert>}

            <Flex
              style={{ gap: spacing[3].value, paddingTop: spacing[4].value }}
            >
              <Button
                onClick={() => {
                  setShowJoinModal(false);
                  setInvitationPayload('');
                  setContextName('');
                  setGeneratedIdentity('');
                  setError(null);
                  setJoinProgress('');
                }}
                variant="secondary"
                className="flex-1"
                disabled={joining}
              >
                Cancel
              </Button>
              <Button
                onClick={handleJoinAgreement}
                variant="primary"
                className="flex-1"
                disabled={
                  !invitationPayload.trim() || !contextName.trim() || joining
                }
              >
                {joining ? (
                  <>
                    <Loader size="small" />
                    <Spacer size="xs" />
                    {joinProgress || 'Joining...'}
                  </>
                ) : (
                  <>
                    <UserPlus className="w-4 h-4 mr-2" />
                    Join Agreement
                  </>
                )}
              </Button>
            </Flex>
          </Box>
        </Modal>
      )}
    </MobileLayout>
  );
}
