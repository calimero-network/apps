import React, { useState, useEffect, useCallback } from 'react';
import { useMero } from '@calimero-network/mero-react';
import {
  clientForContext,
  useVaultContexts,
  vaultLabel,
} from '../../lib/vault';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Input,
  Badge,
  Alert,
} from '@calimero-network/mero-ui';

interface VaultContext {
  id: string;
  name?: string;
  secretCount: number;
  lastActivity?: number;
}

const VaultList: React.FC = () => {
  const { mero } = useMero();
  const { contextIds, error: contextsError } = useVaultContexts();
  const [vaults, setVaults] = useState<VaultContext[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Surface a context-listing failure the same way a load failure is surfaced.
  useEffect(() => {
    if (contextsError) setError(contextsError);
  }, [contextsError]);

  // Load vaults function - each context is a vault
  const loadVaults = useCallback(async () => {
    if (!mero || contextIds.length === 0) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    // One vault per context. A context whose secrets cannot be read still
    // appears, with a zero count, rather than vanishing from the list — the
    // vault exists either way and hiding it looks like data loss.
    const loaded = await Promise.all(
      contextIds.map(async (contextId): Promise<VaultContext> => {
        try {
          const client = await clientForContext(mero, contextId);
          const secrets = client ? await client.listSecrets() : [];
          return {
            id: contextId,
            name: vaultLabel(contextId),
            secretCount: secrets.length,
            lastActivity:
              secrets.length > 0
                ? Math.max(...secrets.map((secret) => secret.updated_at))
                : undefined,
          };
        } catch {
          return { id: contextId, name: vaultLabel(contextId), secretCount: 0 };
        }
      }),
    );

    setVaults(loaded);
    setIsLoading(false);
  }, [mero, contextIds]);

  // Load vaults from all contexts
  useEffect(() => {
    loadVaults();
  }, [loadVaults]);

  const filteredVaults = vaults.filter((vault) =>
    vault.name?.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg">
          Loading vaults... (Contexts: {contextIds.length})
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">My Vaults</h1>
          <p className="text-gray-600">
            Each context is a vault containing your secrets
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="max-w-md">
        <Input
          placeholder="Search vaults..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Error */}
      {error && <Alert description={error} />}

      {/* A reload control, without the counters. What was here shipped
          "Debug: 0 total vaults, 0 filtered, 0 contexts / User: Connected" to
          every user — three internal numbers and a console.log, on the first
          screen after login. */}
      <div className="flex justify-end mb-4">
        <Button onClick={() => loadVaults()} variant="secondary">
          Reload vaults
        </Button>
      </div>

      {/* Vaults Grid */}
      {filteredVaults.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <div className="text-gray-500 mb-4">
              {searchQuery ? 'No vaults match your search' : 'No vaults found'}
            </div>
            <div className="text-sm text-gray-400">
              A vault is a Calimero context. One appears here when you join a
              namespace that has one — ask whoever runs it for an invitation.
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredVaults.map((vault) => (
            <Card
              key={vault.id || 'unknown'}
              className="hover:shadow-lg transition-shadow cursor-pointer"
            >
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>
                    {vault.name ||
                      `Vault ${vault.id?.slice(0, 8) || 'Unknown'}...`}
                  </span>
                  <Badge variant="outline">{vault.secretCount} secrets</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <p className="text-sm text-gray-600">
                    Context ID: {vault.id || 'Unknown'}
                  </p>

                  {vault.lastActivity && (
                    <div className="flex items-center justify-between text-sm text-gray-500">
                      <span>
                        Last activity: {formatTimestamp(vault.lastActivity)}
                      </span>
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <div className="flex gap-4 text-sm text-gray-500">
                      <span>{vault.secretCount} secrets</span>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-2">
                    <Button
                      className="flex-1"
                      onClick={() => {
                        // Navigate to vault dashboard
                        window.location.href = `/vault/${vault.id}`;
                      }}
                    >
                      Open Vault
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default VaultList;
