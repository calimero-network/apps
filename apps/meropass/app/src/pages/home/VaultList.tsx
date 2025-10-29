import React, { useState, useEffect, useCallback } from 'react';
import { useCalimero } from '@calimero-network/calimero-client';
import { AbiClient } from '../../api/AbiClient';
import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle,
  Button,
  Input,
  Badge,
  Alert,
  Modal
} from '@calimero-network/mero-ui';

interface VaultContext {
  id: string;
  name?: string;
  secretCount: number;
  lastActivity?: number;
}

const VaultList: React.FC = () => {
  const { app } = useCalimero();
  const [vaults, setVaults] = useState<VaultContext[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [contexts, setContexts] = useState<any[]>([]);

  // Fetch contexts for the application
  useEffect(() => {
    if (!app) return;

    const fetchContexts = async () => {
      try {
        console.log('fetchContexts: Starting to fetch contexts...');
        const contextsData = await app.fetchContexts();
        console.log('fetchContexts: Raw response:', contextsData);
        
        // Handle the response structure - contexts might be in data.contexts
        const actualContexts = contextsData.data?.contexts || contextsData.contexts || contextsData;
        console.log('fetchContexts: Processed contexts:', actualContexts);
        
        // Ensure it's an array
        const contextsArray = Array.isArray(actualContexts) ? actualContexts : [];
        console.log('fetchContexts: Contexts array:', contextsArray);
        
        setContexts(contextsArray);
        console.log('fetchContexts: Set contexts state:', contextsArray);
      } catch (err) {
        console.error('Failed to fetch contexts:', err);
        setError('Failed to fetch contexts');
      }
    };

    fetchContexts();
  }, [app]);

  // Load vaults function - each context is a vault
  const loadVaults = useCallback(async () => {
    if (!app || contexts.length === 0) {
      console.log('loadVaults: Missing app or no contexts', { app: !!app, contextsLength: contexts.length });
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      console.log('Available contexts:', contexts);
      console.log('loadVaults: Starting to process contexts');

      const vaultContexts: VaultContext[] = [];
      
      // Each context is a vault - get secret count for each
      for (const context of contexts) {
        // Handle both context.id and context.contextId
        const contextId = context.id || context.contextId;
        
        // Skip if context doesn't have an id
        if (!context || !contextId) {
          console.warn('Skipping context without id:', context);
          continue;
        }

        try {
          console.log(`Loading vault data from context ${contextId}`, context);
          const api = new AbiClient(app, context);
          const secrets = await api.listSecrets();
          
          const vaultContext: VaultContext = {
            id: contextId,
            name: `Vault ${contextId.slice(0, 8)}...`,
            secretCount: secrets.length,
            lastActivity: secrets.length > 0 ? Math.max(...secrets.map(s => s.updated_at)) : undefined
          };
          
          vaultContexts.push(vaultContext);
          console.log(`Context ${contextId}: ${secrets.length} secrets`);
        } catch (err) {
          console.error(`Failed to load secrets from context ${contextId}:`, err);
          // Still add the context as a vault, just with 0 secrets
          vaultContexts.push({
            id: contextId,
            name: `Vault ${contextId.slice(0, 8)}...`,
            secretCount: 0
          });
        }
      }
      
      setVaults(vaultContexts);
      console.log('Total vault contexts loaded:', vaultContexts.length);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load vaults');
    } finally {
      setIsLoading(false);
    }
  }, [app, contexts]);

  // Load vaults from all contexts
  useEffect(() => {
    loadVaults();
  }, [loadVaults]);

  const filteredVaults = vaults.filter(vault =>
    vault.name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg">Loading vaults... (Contexts: {contexts.length})</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">My Vaults</h1>
          <p className="text-gray-600">Each context is a vault containing your secrets</p>
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
      {error && (
        <Alert description={error} />
      )}

      {/* Debug Info */}
      <div className="text-sm text-gray-500 mb-4">
        Debug: {vaults.length} total vaults, {filteredVaults.length} filtered, {contexts.length} contexts
        <br />
        User: Connected
        <br />
        <div className="flex gap-2 mt-2">
          <Button 
            onClick={() => {
              console.log('Manual vault reload triggered');
              loadVaults();
            }}
            variant="secondary"
          >
            Reload Vaults
          </Button>
        </div>
      </div>

      {/* Vaults Grid */}
      {filteredVaults.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <div className="text-gray-500 mb-4">
              {searchQuery ? 'No vaults match your search' : 'No vaults found'}
            </div>
            <div className="text-sm text-gray-400">
              Vaults are created when you join contexts. Ask someone to invite you to a vault!
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredVaults.map(vault => (
            <Card key={vault.id || 'unknown'} className="hover:shadow-lg transition-shadow cursor-pointer">
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>{vault.name || `Vault ${vault.id?.slice(0, 8) || 'Unknown'}...`}</span>
                  <Badge variant="outline">
                    {vault.secretCount} secrets
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <p className="text-sm text-gray-600">
                    Context ID: {vault.id || 'Unknown'}
                  </p>
                  
                  {vault.lastActivity && (
                    <div className="flex items-center justify-between text-sm text-gray-500">
                      <span>Last activity: {formatTimestamp(vault.lastActivity)}</span>
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
