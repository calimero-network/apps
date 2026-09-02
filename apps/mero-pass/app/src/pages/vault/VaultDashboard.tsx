import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { ConnectButton } from '@calimero-network/mero-react';
import type {
  AuditLogEntry,
  SecretItem,
} from '../../generated/MeroPassClient';
import { useVaultClient } from '../../lib/vault';
import SecretForm from '../../components/SecretForm';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Badge,
  Tabs,
  TabPanel,
  Select,
  Alert,
  Modal,
  Textarea,
  Navbar as MeroNavbar,
  NavbarBrand,
  NavbarMenu,
  NavbarItem,
} from '@calimero-network/mero-ui';

const VaultDashboard: React.FC = () => {
  const { vaultId } = useParams<{ vaultId: string }>();
  // One vault == one context, so the route param IS the context id. The old
  // code listed every context and searched it for a match, which meant a page
  // load could not tell "not a member" from "node unreachable".
  const client = useVaultClient(vaultId ?? null);
  const [secrets, setSecrets] = useState<SecretItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSecret, setSelectedSecret] = useState<SecretItem | null>(null);
  const [isSecretModalOpen, setIsSecretModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<string>('secrets');

  // Load vault data - each context is a vault
  const loadVaultData = useCallback(async () => {
    if (!client) return;

    try {
      setIsLoading(true);
      setError(null);
      const [secretsData, auditData] = await Promise.all([
        client.listSecrets(),
        client.getAuditLogs(),
      ]);
      setSecrets(secretsData);
      setAuditLogs(auditData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load vault data');
    } finally {
      setIsLoading(false);
    }
  }, [client]);

  useEffect(() => {
    loadVaultData();
  }, [loadVaultData]);

  // Filter secrets based on search and tag
  const filteredSecrets = secrets.filter((secret) => {
    if (!secret) return false;

    const secretTags = secret.tags || [];
    const searchLower = searchQuery.toLowerCase().trim();

    // If search query is empty, match all
    const matchesSearch =
      !searchLower ||
      secret.name.toLowerCase().includes(searchLower) ||
      secretTags.some((tag) => tag.toLowerCase().includes(searchLower));

    // If tag filter is 'all', match all
    const matchesTag =
      selectedTag === 'all' || secretTags.includes(selectedTag);

    return matchesSearch && matchesTag;
  });

  // Debug logging
  console.log('VaultDashboard - secrets:', secrets);
  console.log('VaultDashboard - filteredSecrets:', filteredSecrets);
  console.log('VaultDashboard - searchQuery:', searchQuery);
  console.log('VaultDashboard - selectedTag:', selectedTag);

  // Get unique tags for filter
  const allTags = Array.from(new Set(secrets.flatMap((secret) => secret.tags)));

  // Get secret type icon
  const getSecretTypeIcon = (type: string) => {
    switch (type) {
      case 'login':
        return '🔐';
      case 'secure_note':
        return '📝';
      case 'totp':
        return '⏰';
      case 'ssh_key':
        return '🔑';
      case 'payment_card':
        return '💳';
      default:
        return '🔒';
    }
  };

  // Format timestamp (Calimero uses nanoseconds, convert to milliseconds)
  const formatTimestamp = (timestamp: number) => {
    // If timestamp is in nanoseconds (very large number), convert to milliseconds
    const timestampMs =
      timestamp > 1e12 ? Math.floor(timestamp / 1e6) : timestamp;
    return new Date(timestampMs).toLocaleString();
  };

  // Handle secret viewing
  const handleViewSecret = (secret: SecretItem) => {
    setSelectedSecret(secret);
    setIsSecretModalOpen(true);
  };

  // Handle copying secret data
  const handleCopySecret = (text: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        alert('Copied to clipboard!');
      })
      .catch(() => {
        alert('Failed to copy to clipboard');
      });
  };

  // Parse secret data for display
  const parseSecretData = (data: string) => {
    try {
      return JSON.parse(data);
    } catch {
      return { raw: data };
    }
  };

  if (isLoading) {
    return (
      <>
        <MeroNavbar variant="elevated" size="md">
          <NavbarBrand text="MeroPass" />
          <NavbarMenu align="right">
            <NavbarItem>
              <ConnectButton label="Connect a node" />
            </NavbarItem>
          </NavbarMenu>
        </MeroNavbar>
        <div className="flex items-center justify-center h-64">
          <div className="text-lg">Loading vault...</div>
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <MeroNavbar variant="elevated" size="md">
          <NavbarBrand text="MeroPass" />
          <NavbarMenu align="right">
            <NavbarItem>
              <ConnectButton label="Connect a node" />
            </NavbarItem>
          </NavbarMenu>
        </MeroNavbar>
        <Alert className="m-4">{error}</Alert>
      </>
    );
  }

  if (!vaultId) {
    return (
      <>
        <MeroNavbar variant="elevated" size="md">
          <NavbarBrand text="MeroPass" />
          <NavbarMenu align="right">
            <NavbarItem>
              <ConnectButton label="Connect a node" />
            </NavbarItem>
          </NavbarMenu>
        </MeroNavbar>
        <Alert className="m-4">Vault ID not provided</Alert>
      </>
    );
  }

  return (
    <>
      <MeroNavbar variant="elevated" size="md">
        <NavbarBrand text="MeroPass" />
        <NavbarMenu align="right">
          <NavbarItem>
            <ConnectButton label="Connect a node" />
          </NavbarItem>
        </NavbarMenu>
      </MeroNavbar>

      <div className="container mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              Vault {vaultId?.slice(0, 8)}...
            </h1>
            <p className="text-sm text-gray-500">
              Context ID:{' '}
              <span className="font-mono opacity-90">{vaultId}</span>
            </p>
          </div>
          <div className="flex gap-2">
            {client && (
              <SecretForm
                api={client}
                onSuccess={loadVaultData}
              />
            )}
            <Button variant="secondary">Invite Member</Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold">{secrets.length}</div>
              <div className="text-sm text-gray-600">Total Secrets</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold">{allTags.length}</div>
              <div className="text-sm text-gray-600">Tags</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold">{auditLogs.length}</div>
              <div className="text-sm text-gray-600">Audit Events</div>
            </CardContent>
          </Card>
        </div>

        {/* Search and Filter */}
        <div className="flex gap-4">
          <Input
            placeholder="Search secrets..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1"
          />
          <Select
            value={selectedTag}
            onChange={setSelectedTag}
            options={[
              { value: 'all', label: 'All Tags' },
              ...allTags.map((tag) => ({ value: tag, label: tag })),
            ]}
            placeholder="Filter by tag"
            className="w-48"
          />
        </div>

        {/* Main Content */}
        <div className="sticky top-16 z-10 -mx-6 px-6 bg-black/40 backdrop-blur supports-[backdrop-filter]:bg-black/30 border-b border-white/10">
          <Tabs
            tabs={[
              { id: 'secrets', label: `Secrets (${filteredSecrets.length})` },
              { id: 'audit', label: `Audit Log (${auditLogs.length})` },
            ]}
            value={activeTab}
            onValueChange={setActiveTab}
            className="space-y-4"
          >
            <TabPanel when="secrets" active={activeTab} className="space-y-4">
              {filteredSecrets.length === 0 ? (
                <Card>
                  <CardContent className="p-8 text-center">
                    <div className="text-gray-500">
                      {secrets.length === 0
                        ? 'No secrets found'
                        : `No secrets match your filters (${secrets.length} total secrets)`}
                    </div>
                    {secrets.length > 0 && (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setSearchQuery('');
                          setSelectedTag('all');
                        }}
                        className="mt-4"
                      >
                        Clear Filters
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredSecrets.map((secret) => (
                    <Card
                      key={secret.id}
                      className="border border-white/10 rounded-lg hover:shadow-lg transition-shadow"
                    >
                      <CardHeader className="p-4 pb-2">
                        <CardTitle className="flex items-center gap-2 text-base">
                          <span>{getSecretTypeIcon(secret.secret_type)}</span>
                          {secret.name}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-4">
                        <div className="space-y-2">
                          <div className="text-sm text-gray-400">
                            Type:{' '}
                            <Badge variant="info">{secret.secret_type}</Badge>
                          </div>
                          <div className="text-sm text-gray-400">
                            Version: {secret.version}
                          </div>
                          <div
                            className="text-sm text-gray-400"
                            title={formatTimestamp(secret.created_at)}
                          >
                            Created:{' '}
                            {new Date(
                              secret.created_at > 1e12
                                ? Math.floor(secret.created_at / 1e6)
                                : secret.created_at,
                            ).toLocaleDateString()}{' '}
                            {new Date(
                              secret.created_at > 1e12
                                ? Math.floor(secret.created_at / 1e6)
                                : secret.created_at,
                            ).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {secret.tags.map((tag) => (
                              <Badge
                                key={tag}
                                variant="outline"
                                className="text-xs opacity-80"
                              >
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        </div>
                        <div className="flex gap-2 mt-4">
                          <Button
                            variant="primary"
                            onClick={() => handleViewSecret(secret)}
                          >
                            View
                          </Button>
                          <Button variant="secondary">Edit</Button>
                          <Button variant="error">Delete</Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabPanel>

            <TabPanel when="audit" active={activeTab} className="space-y-4">
              <Card className="border border-white/10 rounded-lg">
                <CardHeader>
                  <CardTitle>Audit Log</CardTitle>
                </CardHeader>
                <CardContent>
                  {auditLogs.length === 0 ? (
                    <div className="text-center text-gray-500 py-8">
                      No audit logs found
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {auditLogs.map((log) => (
                        <div
                          key={log.id}
                          className="flex items-start gap-3 p-3 border border-white/10 rounded-lg"
                        >
                          <div className="w-2 h-2 bg-blue-500 rounded-full mt-2"></div>
                          <div className="flex-1">
                            <div className="font-medium">{log.action}</div>
                            <div className="text-sm text-gray-600">
                              {log.details}
                            </div>
                            <div className="text-xs text-gray-500 mt-1">
                              {formatTimestamp(log.timestamp)} •{' '}
                              {log.user_public_key?.slice(0, 8) || 'Unknown'}...
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabPanel>
          </Tabs>
        </div>
      </div>

      {/* Secret Viewing Modal */}
      <Modal
        open={isSecretModalOpen}
        onClose={() => setIsSecretModalOpen(false)}
        title={
          selectedSecret ? `Secret: ${selectedSecret.name}` : 'View Secret'
        }
      >
        {selectedSecret && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Name</label>
                <Input value={selectedSecret.name} disabled />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Type</label>
                <Input value={selectedSecret.secret_type} disabled />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Tags</label>
              <div className="flex flex-wrap gap-1">
                {selectedSecret.tags.map((tag) => (
                  <Badge key={tag} variant="outline" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                Secret Data
              </label>
              <div className="space-y-2">
                {(() => {
                  const parsedData = parseSecretData(selectedSecret.data);
                  return Object.entries(parsedData).map(([key, value]) => (
                    <div key={key} className="flex gap-2">
                      <Input
                        value={key}
                        disabled
                        className="flex-1"
                        placeholder="Field name"
                      />
                      <div className="flex gap-1">
                        <Textarea
                          value={String(value)}
                          disabled
                          className="flex-1"
                          rows={1}
                        />
                        <Button
                          variant="secondary"
                          onClick={() => handleCopySecret(String(value))}
                        >
                          Copy
                        </Button>
                      </div>
                    </div>
                  ));
                })()}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm text-gray-500">
              <div>Created: {formatTimestamp(selectedSecret.created_at)}</div>
              <div>Updated: {formatTimestamp(selectedSecret.updated_at)}</div>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => handleCopySecret(selectedSecret.data)}
              >
                Copy All Data
              </Button>
              <Button onClick={() => setIsSecretModalOpen(false)}>Close</Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
};

export default VaultDashboard;
