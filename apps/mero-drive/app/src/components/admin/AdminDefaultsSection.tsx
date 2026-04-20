import React, { useState, useEffect, useCallback } from 'react';
import { useCalimero } from '@calimero-network/calimero-client';
import { WorkspaceManager } from '@/api/WorkspaceManager';
import { AdminApiError } from '@/api/AdminApi';
import { useWorkspace } from '@/context/WorkspaceContext';
import {
  decodeMemberCapabilitiesBitmask,
  encodeMemberCapabilitiesBitmask,
  type MemberCapabilityFlags,
} from '@/utils/groupCapabilities';
import { Button } from '@/components/ui/button';
import { Loader2, Check, AlertCircle, Globe, Lock, Info } from 'lucide-react';

const CAPABILITY_LABELS: { key: keyof MemberCapabilityFlags; label: string; description: string }[] = [
  { key: 'canCreateContext', label: 'Create folders', description: 'New members can create top-level folder contexts' },
  { key: 'canInviteMembers', label: 'Invite members', description: 'New members can generate invitation links' },
  { key: 'canJoinOpenContexts', label: 'Join open folders', description: 'New members can access open-visibility folders' },
];

export const AdminDefaultsSection: React.FC = () => {
  const { app } = useCalimero();
  const { activeGroupId } = useWorkspace();

  // Capabilities defaults
  const [capsSupported, setCapsSupported] = useState<boolean | null>(null);
  const [flags, setFlags] = useState<MemberCapabilityFlags | null>(null);
  const [isLoadingCaps, setIsLoadingCaps] = useState(false);
  const [isSavingCaps, setIsSavingCaps] = useState(false);
  const [capsSuccess, setCapsSuccess] = useState(false);
  const [capsDirty, setCapsDirty] = useState(false);
  const [capsError, setCapsError] = useState<string | null>(null);

  // Visibility defaults
  const [visSupported, setVisSupported] = useState<boolean | null>(null);
  const [defaultVisibility, setDefaultVisibility] = useState<'open' | 'restricted'>('open');
  const [isLoadingVis, setIsLoadingVis] = useState(false);
  const [isSavingVis, setIsSavingVis] = useState(false);
  const [visSuccess, setVisSuccess] = useState(false);
  const [visError, setVisError] = useState<string | null>(null);

  const isEndpointNotFound = (err: unknown): boolean => {
    if (err instanceof AdminApiError) {
      return err.status === 404 || err.status === 405 || err.status === 501;
    }
    return false;
  };

  const loadDefaults = useCallback(async () => {
    if (!app || !activeGroupId) return;
    const manager = new WorkspaceManager(app);

    setIsLoadingCaps(true);
    setIsLoadingVis(true);
    setCapsError(null);
    setVisError(null);
    try {
      const info = await manager.getGroupInfo(activeGroupId);
      setFlags(decodeMemberCapabilitiesBitmask(info.defaultCapabilities));
      setCapsSupported(true);
      setCapsDirty(false);
      const mode: 'open' | 'restricted' =
        info.defaultVisibility === 'restricted' ? 'restricted' : 'open';
      setDefaultVisibility(mode);
      setVisSupported(true);
    } catch (err) {
      if (isEndpointNotFound(err)) {
        setCapsSupported(false);
        setVisSupported(false);
      } else {
        setCapsSupported(true);
        setVisSupported(true);
        const msg = 'Failed to load workspace defaults.';
        setCapsError(msg);
        setVisError(msg);
      }
    } finally {
      setIsLoadingCaps(false);
      setIsLoadingVis(false);
    }
  }, [app, activeGroupId]);

  useEffect(() => {
    void loadDefaults();
  }, [loadDefaults]);

  const handleCapToggle = (key: keyof MemberCapabilityFlags) => {
    if (!flags) return;
    setFlags({ ...flags, [key]: !flags[key] });
    setCapsDirty(true);
    setCapsSuccess(false);
  };

  const handleSaveCaps = async () => {
    if (!flags || !app || !activeGroupId) return;
    setIsSavingCaps(true);
    setCapsError(null);
    setCapsSuccess(false);
    try {
      const manager = new WorkspaceManager(app);
      const mask = encodeMemberCapabilitiesBitmask(flags);
      await manager.setDefaultCapabilities(activeGroupId, mask);
      setCapsDirty(false);
      setCapsSuccess(true);
    } catch {
      setCapsError('Failed to save default capabilities.');
    } finally {
      setIsSavingCaps(false);
    }
  };

  const handleVisChange = async (mode: 'open' | 'restricted') => {
    if (!app || !activeGroupId) return;
    const previous = defaultVisibility;
    setDefaultVisibility(mode);
    setIsSavingVis(true);
    setVisError(null);
    setVisSuccess(false);
    try {
      const manager = new WorkspaceManager(app);
      await manager.setDefaultVisibility(activeGroupId, mode);
      setVisSuccess(true);
    } catch {
      setDefaultVisibility(previous);
      setVisError('Failed to save default visibility.');
    } finally {
      setIsSavingVis(false);
    }
  };

  const isLoading = isLoadingCaps || isLoadingVis;
  const nothingSupported = capsSupported === false && visSupported === false;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading workspace defaults...
      </div>
    );
  }

  if (nothingSupported) {
    return (
      <div className="text-center py-8 space-y-3">
        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto">
          <Info className="w-6 h-6 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground">
          Default workspace settings are not supported by the current node.
        </p>
        <p className="text-xs text-muted-foreground">
          Upgrade your node to enable default capabilities and visibility controls.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        Configure the default capabilities and visibility applied to new members and new folders in this workspace.
      </p>

      {/* Default Member Capabilities */}
      {capsSupported !== false && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium">Default Member Capabilities</h3>
          <p className="text-xs text-muted-foreground">
            These capabilities are applied to newly invited members. Existing members are not affected.
          </p>

          {flags ? (
            <>
              <div className="space-y-3">
                {CAPABILITY_LABELS.map(({ key, label, description }) => (
                  <div key={key} className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm">{label}</p>
                      <p className="text-xs text-muted-foreground">{description}</p>
                    </div>
                    <button
                      role="switch"
                      aria-checked={flags[key]}
                      onClick={() => handleCapToggle(key)}
                      className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                        flags[key] ? 'bg-primary' : 'bg-muted'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                          flags[key] ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                ))}
              </div>

              {capsError && (
                <div className="flex items-center gap-2 text-xs text-destructive">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                  {capsError}
                </div>
              )}

              {capsSuccess && !capsDirty && (
                <div className="flex items-center gap-2 text-xs text-emerald-500">
                  <Check className="w-3.5 h-3.5 flex-shrink-0" />
                  Default capabilities saved.
                </div>
              )}

              <Button
                size="sm"
                onClick={handleSaveCaps}
                disabled={!capsDirty || isSavingCaps}
                className="w-full"
              >
                {isSavingCaps ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                    Saving...
                  </>
                ) : (
                  'Save Default Capabilities'
                )}
              </Button>
            </>
          ) : capsError ? (
            <div className="flex items-center gap-2 text-xs text-destructive">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              {capsError}
            </div>
          ) : null}
        </div>
      )}

      {capsSupported !== false && visSupported !== false && (
        <hr className="border-border" />
      )}

      {/* Default Context Visibility */}
      {visSupported !== false && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium">Default Folder Visibility</h3>
          <p className="text-xs text-muted-foreground">
            Newly created folders will use this visibility mode by default.
          </p>

          <div className="flex gap-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                value="open"
                checked={defaultVisibility === 'open'}
                onChange={() => handleVisChange('open')}
                className="accent-primary"
                disabled={isSavingVis}
              />
              <Globe className="w-3.5 h-3.5 text-emerald-500" />
              Open
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                value="restricted"
                checked={defaultVisibility === 'restricted'}
                onChange={() => handleVisChange('restricted')}
                className="accent-primary"
                disabled={isSavingVis}
              />
              <Lock className="w-3.5 h-3.5 text-amber-500" />
              Restricted
            </label>
            {isSavingVis && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
          </div>

          {visError && (
            <div className="flex items-center gap-2 text-xs text-destructive">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              {visError}
            </div>
          )}

          {visSuccess && (
            <div className="flex items-center gap-2 text-xs text-emerald-500">
              <Check className="w-3.5 h-3.5 flex-shrink-0" />
              Default visibility saved.
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AdminDefaultsSection;
