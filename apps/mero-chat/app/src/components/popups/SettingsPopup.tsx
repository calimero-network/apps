import React, { useState, useCallback, useEffect, useRef } from "react";
import { styled, keyframes } from "styled-components";
import { useNavigate } from "react-router-dom";
import BaseModal from "../common/popups/BaseModal";
import { useMero, getContextIdentity as getExecutorPublicKey, getContextId } from "@calimero-network/mero-react";
import {
  clearStoredSession,
  clearNamespaceReady,
} from "../../utils/session";
import {
  clearWorkspaceSelection,
  getGroupId,
  getStoredGroupAlias,
} from "../../constants/config";
import { clearMessengerDisplayName, getMessengerDisplayName } from "../../utils/messengerName";
import { useCurrentGroupPermissions } from "../../hooks/useCurrentGroupPermissions";
import { GroupApiDataSource, uploadBlobDirect } from "../../api/dataSource/groupApiDataSource";
import { ClientApiDataSource } from "../../api/dataSource/clientApiDataSource";
import { downloadBlob, getMeroJs } from "../../api/meroJsClient";
import { useToast } from "../../contexts/ToastContext";
import { invalidateAvatarCache } from "../../hooks/useAvatarUrl";
// ─── Animations ────────────────────────────────────────────────────────────────

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
`;

const spin = keyframes`
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
`;

// ─── Layout ────────────────────────────────────────────────────────────────────

const Container = styled.div`
  position: relative;
  width: 100%;
  max-height: 80vh;
  overflow-y: auto;
  animation: ${fadeIn} 0.2s ease both;

  @media (max-width: 1024px) {
    max-height: calc(100vh - 140px);
  }
`;

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.25rem;
  padding-bottom: 0.875rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
`;

const TitleGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 0.625rem;
`;

const TitleIcon = styled.div`
  width: 28px;
  height: 28px;
  border-radius: 7px;
  background: rgba(165, 255, 17, 0.1);
  border: 1px solid rgba(165, 255, 17, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;

  svg {
    stroke: #a5ff11;
  }
`;

const Title = styled.h2`
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  margin: 0;
  letter-spacing: 0.01em;
`;

const CloseButton = styled.button`
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.3);
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.15s ease;

  &:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.08);
  }
`;

// ─── Workspace card ────────────────────────────────────────────────────────────

const WorkspaceCard = styled.div`
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 8px;
  padding: 0.75rem 0.875rem;
  margin-bottom: 1.25rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
`;

const WorkspaceInfo = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
`;

const WorkspaceLabel = styled.span`
  font-size: 0.68rem;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.3);
  text-transform: uppercase;
  letter-spacing: 0.06em;
`;

const WorkspaceName = styled.span`
  font-size: 0.85rem;
  font-weight: 600;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const WorkspaceIdRow = styled.div`
  display: flex;
  align-items: center;
  gap: 0.375rem;
`;

const WorkspaceIdText = styled.span`
  font-size: 0.72rem;
  color: rgba(255, 255, 255, 0.6);
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
`;

const RoleBadge = styled.span<{ $admin: boolean; $mod?: boolean }>`
  flex-shrink: 0;
  font-size: 0.7rem;
  font-weight: 600;
  padding: 0.2rem 0.55rem;
  border-radius: 5px;
  letter-spacing: 0.04em;
  background: ${({ $admin, $mod }) =>
    $admin ? "rgba(165, 255, 17, 0.12)" : $mod ? "rgba(124, 58, 237, 0.12)" : "rgba(255, 255, 255, 0.07)"};
  border: 1px solid ${({ $admin, $mod }) =>
    $admin ? "rgba(165, 255, 17, 0.3)" : $mod ? "rgba(124, 58, 237, 0.35)" : "rgba(255, 255, 255, 0.12)"};
  color: ${({ $admin, $mod }) =>
    $admin ? "#a5ff11" : $mod ? "#a78bfa" : "rgba(255, 255, 255, 0.55)"};
`;

// ─── Profile section ────────────────────────────────────────────────────────

const ProfileCard = styled.div`
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 8px;
  padding: 0.75rem 0.875rem;
  margin-bottom: 0.75rem;
  display: flex;
  align-items: center;
  gap: 0.875rem;
`;

const ProfileAvatar = styled.div<{ $hasImage: boolean }>`
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: ${({ $hasImage }) =>
    $hasImage
      ? "transparent"
      : "linear-gradient(135deg, rgba(87, 101, 242, 0.5) 0%, rgba(165, 255, 17, 0.2) 100%)"};
  border: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.9rem;
  font-weight: 700;
  color: #fff;
  flex-shrink: 0;
  text-transform: uppercase;
  cursor: pointer;
  position: relative;
  overflow: hidden;

  &:hover > .avatar-overlay {
    opacity: 1;
  }
`;

const AvatarOverlay = styled.div`
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.15s ease;
  border-radius: 50%;
`;

const SpinnerSvg = styled.svg`
  animation: ${spin} 0.8s linear infinite;
`;

const ProfileInfo = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
  flex: 1;
`;

const ProfileLabel = styled.span`
  font-size: 0.68rem;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.3);
  text-transform: uppercase;
  letter-spacing: 0.06em;
`;

const ProfileUsername = styled.span`
  font-size: 0.88rem;
  font-weight: 600;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const IdentityRow = styled.div`
  display: flex;
  align-items: center;
  gap: 0.375rem;
`;

const IdentityText = styled.span`
  font-size: 0.72rem;
  color: rgba(255, 255, 255, 0.35);
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 160px;
`;

const CopyButton = styled.button`
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.25);
  cursor: pointer;
  padding: 0;
  display: flex;
  align-items: center;
  flex-shrink: 0;
  transition: color 0.15s ease;

  &:hover {
    color: rgba(255, 255, 255, 0.65);
  }
`;

// ─── Danger zone ────────────────────────────────────────────────────────────

const DangerZone = styled.div`
  margin-top: 0.75rem;
  padding: 0.75rem 0.875rem;
  background: rgba(255, 59, 59, 0.04);
  border: 1px solid rgba(255, 59, 59, 0.18);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
`;

const DangerLabel = styled.span`
  font-size: 0.75rem;
  font-weight: 500;
  color: rgba(255, 100, 100, 0.7);
`;

const LeaveWorkspaceButton = styled.button`
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.4rem 0.875rem;
  border-radius: 7px;
  font-size: 0.78rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  border: 1px solid rgba(255, 80, 80, 0.3);
  background: rgba(255, 80, 80, 0.08);
  color: rgba(255, 110, 110, 0.85);

  &:hover {
    border-color: rgba(255, 80, 80, 0.55);
    background: rgba(255, 80, 80, 0.16);
    color: #ff7a7a;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const ConfirmActions = styled.div`
  display: flex;
  gap: 0.4rem;
`;

const CancelLeaveButton = styled.button`
  padding: 0.4rem 0.75rem;
  border-radius: 7px;
  font-size: 0.78rem;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.7);

  &:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
  }
`;

// ─── Session section ────────────────────────────────────────────────────────────

const LogoutSection = styled.div`
  margin-top: 1.25rem;
  padding-top: 1rem;
  border-top: 1px solid rgba(255, 255, 255, 0.07);
  display: flex;
  align-items: center;
  justify-content: flex-end;
`;

const SessionActions = styled.div`
  display: flex;
  align-items: center;
  gap: 0.625rem;
`;

const SessionButton = styled.button`
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.4rem 0.875rem;
  border-radius: 7px;
  font-size: 0.78rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
`;

const ChangeWorkspaceButton = styled(SessionButton)`
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.72);

  &:hover {
    border-color: rgba(255, 255, 255, 0.22);
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
  }
`;

const LogoutButton = styled(SessionButton)`
  border: 1px solid rgba(255, 80, 80, 0.25);
  background: rgba(255, 80, 80, 0.06);
  color: rgba(255, 100, 100, 0.8);

  &:hover {
    border-color: rgba(255, 80, 80, 0.5);
    background: rgba(255, 80, 80, 0.12);
    color: #ff6464;
  }

  svg { opacity: 0.7; }
`;

// ─── Component ─────────────────────────────────────────────────────────────────

interface SettingsPopupProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  toggle: React.ReactNode;
}

export default function SettingsPopup({
  isOpen,
  setIsOpen,
  toggle,
}: SettingsPopupProps) {
  const { logout } = useMero();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const groupId = getGroupId();
  const alias = getStoredGroupAlias(groupId);
  const { isAdmin, isModerator } = useCurrentGroupPermissions(groupId);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedWorkspace, setCopiedWorkspace] = useState(false);
  const [avatarObjectUrl, setAvatarObjectUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const avatarObjectUrlRef = useRef<string | null>(null);

  const username = getMessengerDisplayName() || "";
  const identity = getExecutorPublicKey() || "";
  const identityShort = identity.length > 16
    ? `${identity.slice(0, 8)}…${identity.slice(-6)}`
    : identity;
  const avatarInitial = username ? username[0] : identity[0] || "?";

  // Load current avatar from the active context on open.
  useEffect(() => {
    if (!isOpen || !identity) return;
    const contextId = getContextId();
    if (!contextId) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await new ClientApiDataSource().getProfiles(contextId, identity);
        const myProfile = res.data?.find((p) => p.identity === identity);
        if (!myProfile?.avatar || cancelled) return;
        const blob = await downloadBlob(myProfile.avatar, contextId);
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        avatarObjectUrlRef.current = url;
        setAvatarObjectUrl(url);
      } catch {
        // no avatar
      }
    })();

    return () => {
      cancelled = true;
      // Revoke the URL created in this run to prevent leaks on repeated opens.
      if (avatarObjectUrlRef.current) {
        URL.revokeObjectURL(avatarObjectUrlRef.current);
        avatarObjectUrlRef.current = null;
      }
    };
  }, [isOpen, identity]);

  // Revoke object URL on unmount.
  useEffect(() => {
    return () => {
      if (avatarObjectUrlRef.current) {
        URL.revokeObjectURL(avatarObjectUrlRef.current);
      }
    };
  }, []);

  const handleCopyIdentity = useCallback(async () => {
    if (!identity) return;
    try {
      await navigator.clipboard.writeText(identity);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }, [identity]);

  const handleCopyWorkspaceId = useCallback(async () => {
    if (!groupId) return;
    try {
      await navigator.clipboard.writeText(groupId);
      setCopiedWorkspace(true);
      setTimeout(() => setCopiedWorkspace(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }, [groupId]);

  const handleAvatarChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      // Reset input so the same file can trigger onChange again later.
      e.target.value = "";

      setUploading(true);
      try {
        const uploadRes = await uploadBlobDirect(file, getContextId() || undefined);
        if (!uploadRes.data?.blobId) {
          addToast({ title: "Avatar", message: "Upload failed", type: "channel", duration: 3000 });
          return;
        }
        const blobId = uploadRes.data.blobId;

        // Show the new image immediately.
        const newUrl = URL.createObjectURL(file);
        if (avatarObjectUrlRef.current) URL.revokeObjectURL(avatarObjectUrlRef.current);
        avatarObjectUrlRef.current = newUrl;
        setAvatarObjectUrl(newUrl);

        // Always update the currently-active context first (fallback when
        // listGroupContexts is stale or returns empty — e.g. after make stop).
        const currentContextId = getContextId();
        const currentIdentity = getExecutorPublicKey();
        const clientDs = new ClientApiDataSource();
        if (currentContextId && currentIdentity) {
          try {
            await clientDs.updateProfile(currentContextId, currentIdentity, username, blobId);
          } catch {
            // best-effort
          }
        }

        // Best-effort: propagate to every other context in the group.
        const contextsRes = await new GroupApiDataSource().listGroupContexts(groupId);
        for (const ctx of contextsRes.data ?? []) {
          if (ctx.contextId === currentContextId) continue; // already done above
          try {
            const owned = await getMeroJs().admin.getContextIdentitiesOwned(ctx.contextId);
            const executorKey = owned.identities?.[0];
            if (!executorKey) continue;
            const profilesRes = await clientDs.getProfiles(ctx.contextId, executorKey);
            const myProfile = profilesRes.data?.find((p) => p.identity === executorKey);
            await clientDs.updateProfile(
              ctx.contextId,
              executorKey,
              myProfile?.username || username,
              blobId,
            );
          } catch {
            // best-effort per context
          }
        }

        invalidateAvatarCache();
        addToast({ title: "Avatar updated", message: "Your profile picture has been saved.", type: "channel", duration: 3000 });
      } finally {
        setUploading(false);
      }
    },
    [addToast, groupId, username],
  );

  // ── Session handlers ────────────────────────────────────────────────────────

  const handleChangeWorkspace = () => {
    clearWorkspaceSelection();
    clearNamespaceReady();
    clearMessengerDisplayName();
    setIsOpen(false);
    navigate("/login");
  };

  const handleLogout = () => {
    const nodeUrl = localStorage.getItem("mero:node_url");
    clearStoredSession();
    clearWorkspaceSelection();
    clearNamespaceReady();
    clearMessengerDisplayName();
    sessionStorage.clear();
    logout();
    if (nodeUrl) localStorage.setItem("mero:node_url", nodeUrl);
    setIsOpen(false);
  };

  const handleLeaveWorkspace = async () => {
    if (!groupId || leaving) return;
    setLeaving(true);
    const result = await new GroupApiDataSource().leaveNamespace(groupId);
    setLeaving(false);
    if (result.error) {
      addToast({
        title: "Leave workspace",
        message: result.error.message || "Failed to leave workspace",
        type: "channel",
        duration: 5000,
      });
      return;
    }
    addToast({
      title: "Left workspace",
      message: "You have left the workspace.",
      type: "channel",
      duration: 3000,
    });
    clearWorkspaceSelection();
    clearNamespaceReady();
    setConfirmLeave(false);
    setIsOpen(false);
    navigate("/login");
  };

  const popupContent = (
    <Container>
      <Header>
        <TitleGroup>
          <TitleIcon>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </TitleIcon>
          <Title>Settings</Title>
        </TitleGroup>
        <CloseButton onClick={() => setIsOpen(false)} aria-label="Close">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </CloseButton>
      </Header>

      {/* Profile */}
      <ProfileCard>
        <ProfileAvatar
          $hasImage={!!avatarObjectUrl}
          onClick={() => !uploading && avatarInputRef.current?.click()}
          title="Change profile picture"
        >
          {avatarObjectUrl ? (
            <img
              src={avatarObjectUrl}
              alt="avatar"
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            avatarInitial
          )}
          <AvatarOverlay className="avatar-overlay">
            {uploading ? (
              <SpinnerSvg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </SpinnerSvg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            )}
          </AvatarOverlay>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={handleAvatarChange}
          />
        </ProfileAvatar>
        <ProfileInfo>
          <ProfileLabel>Profile</ProfileLabel>
          {username && <ProfileUsername>{username}</ProfileUsername>}
          {identity && (
            <IdentityRow>
              <IdentityText title={identity}>{identityShort}</IdentityText>
              <CopyButton onClick={handleCopyIdentity} aria-label="Copy identity">
                {copied ? (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#a5ff11" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                )}
              </CopyButton>
            </IdentityRow>
          )}
        </ProfileInfo>
      </ProfileCard>

      {/* Workspace info */}
      <WorkspaceCard>
        <WorkspaceInfo>
          <WorkspaceLabel>Workspace</WorkspaceLabel>
          {alias ? (
            <WorkspaceName>{alias}</WorkspaceName>
          ) : (
            <WorkspaceIdRow>
              <WorkspaceIdText title={groupId}>{groupId}</WorkspaceIdText>
              <CopyButton onClick={handleCopyWorkspaceId} aria-label="Copy workspace ID">
                {copiedWorkspace ? (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#a5ff11" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                )}
              </CopyButton>
            </WorkspaceIdRow>
          )}
        </WorkspaceInfo>
        <RoleBadge $admin={isAdmin} $mod={isModerator}>{isAdmin ? "Admin" : isModerator ? "Moderator" : "Member"}</RoleBadge>
      </WorkspaceCard>

      {/* Leave workspace (danger). Hidden for admins — server-side leave
          would either fail (last-admin protection) or hand the workspace
          off to an unintended successor. Admins who want out should
          transfer ownership / promote a successor first, or delete the
          namespace via the admin panel. */}
      {!isAdmin && (
        <DangerZone>
          {confirmLeave ? (
            <>
              <DangerLabel>Leave this workspace? You'll need a new invitation to return.</DangerLabel>
              <ConfirmActions>
                <CancelLeaveButton onClick={() => setConfirmLeave(false)} disabled={leaving}>
                  Cancel
                </CancelLeaveButton>
                <LeaveWorkspaceButton onClick={handleLeaveWorkspace} disabled={leaving}>
                  {leaving ? "Leaving…" : "Confirm leave"}
                </LeaveWorkspaceButton>
              </ConfirmActions>
            </>
          ) : (
            <>
              <DangerLabel>Leave workspace</DangerLabel>
              <LeaveWorkspaceButton onClick={() => setConfirmLeave(true)}>
                Leave workspace
              </LeaveWorkspaceButton>
            </>
          )}
        </DangerZone>
      )}

      <LogoutSection>
        <SessionActions>
          <ChangeWorkspaceButton onClick={handleChangeWorkspace}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12h13" />
              <path d="m11 4 8 8-8 8" />
            </svg>
            Change workspace
          </ChangeWorkspaceButton>
          <LogoutButton onClick={handleLogout}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Logout
          </LogoutButton>
        </SessionActions>
      </LogoutSection>
    </Container>
  );

  return (
    <BaseModal
      toggle={toggle}
      content={popupContent}
      open={isOpen}
      onOpenChange={setIsOpen}
    />
  );
}
