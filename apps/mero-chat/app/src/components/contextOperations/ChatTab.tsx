import { useState, useEffect, useCallback, type ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";
import { styled } from "styled-components";
import { getNodeUrl } from "@calimero-network/mero-react";
import { Button, Input } from "@calimero-network/mero-ui";
import { GroupApiDataSource } from "../../api/dataSource/groupApiDataSource";
import type { GroupMember, GroupSummary } from "../../api/groupApi";
import { clearStoredSession } from "../../utils/session";
import {
  getGroupMemberIdentity,
  getGroupId,
  getStoredGroupAlias,
  setGroupId,
  setGroupMemberIdentity,
} from "../../constants/config";
import {
  getMessengerDisplayName,
  setMessengerDisplayName,
} from "../../utils/messengerName";

const TabContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  align-items: center;
  width: 100%;
`;

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  width: 100%;
  max-width: 400px;
`;

const InputGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
`;

const Label = styled.label`
  font-size: 0.7rem;
  font-weight: 500;
  color: #b8b8d1;
`;

const Note = styled.p`
  font-size: 0.6rem;
  color: #b8b8d1;
  margin-top: 0.2rem;
`;

const Select = styled.select`
  appearance: none;
  -webkit-appearance: none;
  padding: 0.65rem 2.5rem 0.65rem 0.85rem;
  background-color: rgba(255, 255, 255, 0.06);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23b8b8d1' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 0.75rem center;
  background-size: 16px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  color: #fff;
  font-size: 0.8rem;
  cursor: pointer;
  transition: border-color 0.15s ease, background-color 0.15s ease;
  width: 100%;

  &:hover:not(:disabled) {
    background-color: rgba(255, 255, 255, 0.09);
    border-color: rgba(255, 255, 255, 0.22);
  }

  &:focus {
    outline: none;
    border-color: #7c3aed;
    background-color: rgba(255, 255, 255, 0.09);
    box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.18);
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  option {
    background: #18181c;
    color: #e8e8f0;
  }
`;

const Message = styled.div<{ type?: "success" | "error" | "info" }>`
  font-size: 0.7rem;
  text-align: center;
  color: ${({ type }) =>
    type === "success"
      ? "#27ae60"
      : type === "error"
        ? "#e74c3c"
        : type === "info"
          ? "#3b82f6"
          : "#b8b8d1"};
`;

const NewUsernameBanner = styled.div`
  font-size: 0.68rem;
  padding: 0.45rem 0.65rem;
  border-radius: 6px;
  background: rgba(59, 130, 246, 0.08);
  border: 1px solid rgba(59, 130, 246, 0.22);
  color: rgba(147, 197, 253, 0.85);
  line-height: 1.45;
`;

interface ChatTabProps {
  isAuthenticated: boolean;
  isConfigSet: boolean;
  _onInvitationSaved?: () => void;
}

function getWorkspaceLabel(group: GroupSummary): string {
  return group.alias?.trim() || `${group.groupId.substring(0, 12)}...`;
}

function getMemberAlias(members: GroupMember[], memberIdentity: string): string {
  return (
    members.find((member) => member.identity === memberIdentity)?.alias?.trim() || ""
  );
}

export default function ChatTab({
  isAuthenticated,
  isConfigSet,
}: ChatTabProps) {
  const navigate = useNavigate();
  const [availableGroups, setAvailableGroups] = useState<GroupSummary[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState(getGroupId());
  const [messengerName, setMessengerName] = useState(getMessengerDisplayName());
  const [fetchingGroups, setFetchingGroups] = useState(false);
  const [openingWorkspace, setOpeningWorkspace] = useState(false);
  const [error, setError] = useState("");
  const [hasExistingAlias, setHasExistingAlias] = useState(true);
  const hasNamespaces = availableGroups.length > 0;
  const isNewUsername = !hasExistingAlias && messengerName.trim().length > 0;

  const resolveWorkspaceMember = useCallback(async (groupId: string) => {
    const identityResponse = await new GroupApiDataSource().resolveCurrentMemberIdentity(
      groupId,
      getGroupMemberIdentity(groupId),
    );

    if (identityResponse.error || !identityResponse.data) {
      throw new Error(
        identityResponse.error?.message || "Failed to resolve namespace identity",
      );
    }

    return {
      memberIdentity: identityResponse.data.memberIdentity,
      memberAlias: getMemberAlias(
        identityResponse.data.members ?? [],
        identityResponse.data.memberIdentity,
      ),
    };
  }, []);

  const fetchGroups = useCallback(async () => {
    if (!getNodeUrl()) return;

    setFetchingGroups(true);
    setError("");

    try {
      const response = await new GroupApiDataSource().listGroups();
      if (response.data && response.data.length > 0) {
        const groups = response.data.map((group) => ({
          ...group,
          alias: group.alias?.trim() || getStoredGroupAlias(group.groupId) || undefined,
        }));
        setAvailableGroups(groups);
        const storedGroupId = getGroupId();
        const preferred =
          groups.find((g) => g.groupId === storedGroupId) ?? groups[0];
        setSelectedGroupId(preferred.groupId);
      } else if (response.error) {
        setAvailableGroups([]);
        setSelectedGroupId("");
        setError(response.error.message || "Failed to load namespaces");
      } else {
        setAvailableGroups([]);
        setSelectedGroupId("");
      }
    } catch {
      setAvailableGroups([]);
      setSelectedGroupId("");
      setError("Could not reach node — is it running?");
    } finally {
      setFetchingGroups(false);
    }
  }, []);

  useEffect(() => {
    if ((isAuthenticated || isConfigSet) && getNodeUrl()) {
      fetchGroups();
    }
  }, [fetchGroups, isAuthenticated, isConfigSet]);

  useEffect(() => {
    if (!selectedGroupId) return;

    let cancelled = false;

    void (async () => {
      try {
        const { memberIdentity, memberAlias } = await resolveWorkspaceMember(selectedGroupId);
        if (cancelled) return;
        setGroupMemberIdentity(selectedGroupId, memberIdentity);
        setMessengerName(memberAlias || getMessengerDisplayName());
        setHasExistingAlias(!!memberAlias);
      } catch {
        if (!cancelled) {
          setMessengerName(getMessengerDisplayName());
          setHasExistingAlias(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [resolveWorkspaceMember, selectedGroupId]);

  // Auto-enter when there is exactly one namespace and a name is already stored.
  useEffect(() => {
    if (
      availableGroups.length === 1 &&
      !fetchingGroups &&
      messengerName.trim() &&
      selectedGroupId &&
      !openingWorkspace
    ) {
      void openWorkspace(selectedGroupId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableGroups, fetchingGroups]);

  const openWorkspace = useCallback(
    async (groupId: string) => {
      const trimmedName = messengerName.trim();
      if (!groupId || !trimmedName) return;

      setOpeningWorkspace(true);
      setError("");

      try {
        const groupApi = new GroupApiDataSource();
        const { memberIdentity } = await resolveWorkspaceMember(groupId);

        try {
          const aliasResponse = await groupApi.setMemberMetadata(groupId, memberIdentity, {
            name: trimmedName,
          });
          if (aliasResponse.error) {
            console.warn("setMemberMetadata failed (non-fatal):", aliasResponse.error.message);
          }
        } catch {
          console.warn("setMemberMetadata threw (non-fatal)");
        }

        setGroupId(groupId);
        setMessengerDisplayName(trimmedName);
        setGroupMemberIdentity(groupId, memberIdentity);
        clearStoredSession();
        navigate("/");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to enter namespace");
      } finally {
        setOpeningWorkspace(false);
      }
    },
    [messengerName, navigate, resolveWorkspaceMember],
  );

  const handleNamespaceChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setSelectedGroupId(event.target.value);
    setError("");
  };

  if (!getNodeUrl()) return null;

  return (
    <TabContent>
      <Form onSubmit={(event) => event.preventDefault()}>
        {hasNamespaces && (
          <InputGroup>
            <Label>Namespace</Label>
            <Select
              id="namespaceSelect"
              value={selectedGroupId}
              onChange={handleNamespaceChange}
              disabled={fetchingGroups || openingWorkspace}
            >
              {availableGroups.length > 1 && (
                <option value="">Select a namespace…</option>
              )}
              {availableGroups.map((group) => (
                <option key={group.groupId} value={group.groupId}>
                  {getWorkspaceLabel(group)}
                </option>
              ))}
            </Select>
          </InputGroup>
        )}

        {!hasNamespaces && !fetchingGroups && (
          <Note style={{ textAlign: "center", marginBottom: "0.5rem" }}>
            No namespaces found on this node. Create one to get started.
          </Note>
        )}

        {fetchingGroups && (
          <Note style={{ textAlign: "center" }}>Loading…</Note>
        )}

        {hasNamespaces && (
          <InputGroup>
            <Label>Your name</Label>
            <Input
              id="messengerNameInput"
              type="text"
              placeholder="Enter your name"
              value={messengerName}
              onChange={(event) => {
                setMessengerName(event.target.value);
                setError("");
              }}
              disabled={openingWorkspace}
            />
          </InputGroup>
        )}

        {isNewUsername && (
          <NewUsernameBanner>
            "{messengerName.trim()}" is a new name for this workspace — once you join, it will be locked to your identity.
          </NewUsernameBanner>
        )}

        {hasNamespaces && (
          <Button
            type="button"
            variant="primary"
            style={{ width: "100%", marginTop: "0.5rem" }}
            onClick={() => { void openWorkspace(selectedGroupId); }}
            disabled={!selectedGroupId || !messengerName.trim() || fetchingGroups || openingWorkspace}
          >
            {openingWorkspace ? "Entering…" : "Enter"}
          </Button>
        )}

        {error && <Message type="error">{error}</Message>}
      </Form>
    </TabContent>
  );
}
