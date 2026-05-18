import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { styled, keyframes } from "styled-components";
import { Button, Input } from "@calimero-network/mero-ui";
import { getNodeUrl } from "@calimero-network/mero-react";
import { getAuthConfig } from "../../api/meroJsClient";
import axios from "axios";
import { GroupApiDataSource } from "../../api/dataSource/groupApiDataSource";
import { ClientApiDataSource } from "../../api/dataSource/clientApiDataSource";
import type { GroupSummary } from "../../api/groupApi";
import {
  getApplicationId,
  getGroupId,
  setGroupId,
  getGroupMemberIdentity,
  setGroupMemberIdentity,
  getStoredGroupAlias,
  setStoredGroupAlias,
  setContextMemberIdentity,
} from "../../constants/config";
import {
  getMessengerDisplayName,
  setMessengerDisplayName,
  getIdentityDisplayName,
  setIdentityDisplayName,
} from "../../utils/messengerName";
import { clearStoredSession, setNamespaceReady } from "../../utils/session";
import {
  extractInvitationFromUrl,
  getInvitationFromStorage,
  saveInvitationToStorage,
  clearInvitationFromStorage,
  parseGroupInvitationPayload,
  parseInvitationInput,
} from "../../utils/invitation";

// ─── Types ────────────────────────────────────────────────────────────────────

type Step =
  | "loading"
  | "select"           // multiple namespaces, user picks
  | "checking"         // resolving identity for selected namespace
  | "enter-name"       // namespace ok, need username
  | "joining"          // submitting username
  | "invite-join"      // processing an invitation (join + sync + join contexts)
  | "no-workspace"     // no namespaces: offer create or paste invitation code
  | "join-invitation"  // manual invitation paste
  | "create"           // show create workspace form
  | "creating"         // creating namespace
  | "error";

// ─── Styled components ────────────────────────────────────────────────────────

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 99999;
  backdrop-filter: blur(12px);
`;

const spin = keyframes`
  to { transform: rotate(360deg); }
`;

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0); }
`;

const Box = styled.div`
  background: #111113;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  padding: 2rem;
  width: 90%;
  max-width: 420px;
  box-shadow: 0 32px 64px rgba(0, 0, 0, 0.6);
  animation: ${fadeIn} 0.22s ease both;
`;

const Header = styled.div`
  margin-bottom: 1.5rem;
`;

const Title = styled.h2`
  color: #ffffff;
  font-size: 1.25rem;
  font-weight: 700;
  margin: 0 0 0.35rem;
  letter-spacing: -0.02em;
`;

const Sub = styled.p`
  color: rgba(255, 255, 255, 0.38);
  font-size: 0.82rem;
  margin: 0;
  line-height: 1.55;
`;

const Field = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-bottom: 1rem;
`;

const Label = styled.label`
  font-size: 0.72rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.45);
  letter-spacing: 0.04em;
  text-transform: uppercase;
`;

const Select = styled.select`
  appearance: none;
  -webkit-appearance: none;
  padding: 0.7rem 2.5rem 0.7rem 0.9rem;
  background-color: rgba(165, 255, 17, 0.04);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23a5ff11' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 0.75rem center;
  background-size: 16px;
  border: 1px solid rgba(165, 255, 17, 0.22);
  border-radius: 10px;
  color: #fff;
  font-size: 0.85rem;
  cursor: pointer;
  width: 100%;
  transition: border-color 0.15s, box-shadow 0.15s;

  &:hover {
    border-color: rgba(165, 255, 17, 0.45);
    background-color: rgba(165, 255, 17, 0.07);
  }

  &:focus {
    outline: none;
    border-color: rgba(165, 255, 17, 0.6);
    box-shadow: 0 0 0 3px rgba(165, 255, 17, 0.12);
  }

  option {
    background: #18181c;
    color: #e8e8f0;
  }
`;

const CreateLink = styled.button`
  background: none;
  border: none;
  color: #a5ff11;
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  padding: 0;
  margin-top: 0.6rem;
  width: 100%;
  text-align: center;
  letter-spacing: 0.01em;
  transition: opacity 0.15s;

  &:hover { opacity: 0.75; }
`;

const Err = styled.div`
  color: #ff6b6b;
  background: rgba(255, 107, 107, 0.08);
  border: 1px solid rgba(255, 107, 107, 0.18);
  border-radius: 8px;
  padding: 0.65rem 0.85rem;
  font-size: 0.8rem;
  margin-bottom: 1rem;
  word-break: break-word;
  overflow-wrap: break-word;
  max-height: 120px;
  overflow-y: auto;
`;

const Textarea = styled.textarea`
  width: 100%;
  min-height: 96px;
  padding: 0.7rem 0.9rem;
  background-color: rgba(165, 255, 17, 0.04);
  border: 1px solid rgba(165, 255, 17, 0.22);
  border-radius: 10px;
  color: #fff;
  font-size: 0.75rem;
  font-family: monospace;
  resize: vertical;
  box-sizing: border-box;
  line-height: 1.5;
  transition: border-color 0.15s, box-shadow 0.15s;
  &::placeholder { color: rgba(255, 255, 255, 0.22); }
  &:hover { border-color: rgba(165, 255, 17, 0.45); background-color: rgba(165, 255, 17, 0.07); }
  &:focus { outline: none; border-color: rgba(165, 255, 17, 0.6); box-shadow: 0 0 0 3px rgba(165, 255, 17, 0.12); }
`;

const Info = styled.div`
  color: rgba(255, 255, 255, 0.45);
  font-size: 0.8rem;
  text-align: center;
  margin-bottom: 1rem;
`;

const Spinner = styled.div`
  width: 28px;
  height: 28px;
  border: 2px solid rgba(165, 255, 17, 0.15);
  border-top-color: #a5ff11;
  border-radius: 50%;
  animation: ${spin} 0.7s linear infinite;
  margin: 0 auto 1rem;
`;

const BtnSpinner = styled.div`
  width: 14px;
  height: 14px;
  border: 2px solid rgba(165, 255, 17, 0.3);
  border-top-color: #a5ff11;
  border-radius: 50%;
  animation: ${spin} 0.7s linear infinite;
  flex-shrink: 0;
`;

const FieldError = styled.p`
  color: #ff6b6b;
  font-size: 0.72rem;
  margin: 0.3rem 0 0;
`;

const Row = styled.div`
  display: flex;
  gap: 0.5rem;
  margin-top: 0.75rem;
`;

const Divider = styled.div`
  height: 1px;
  background: rgba(255, 255, 255, 0.05);
  margin: 1rem 0;
`;

const LogoutBtn = styled.button`
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.25);
  font-size: 0.75rem;
  cursor: pointer;
  padding: 0;
  margin-top: 1rem;
  width: 100%;
  text-align: center;
  transition: color 0.15s;

  &:hover { color: rgba(255, 255, 255, 0.5); }
`;


// ─── Helpers ─────────────────────────────────────────────────────────────────

const DEFAULT_ENDPOINT = "http://localhost:2428";

function authHeaders(): Record<string, string> {
  const cfg = getAuthConfig();
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg?.jwtToken) h.Authorization = `Bearer ${cfg.jwtToken}`;
  return h;
}

async function resolveAppId(preferred: string): Promise<string> {
  const base = getNodeUrl() || DEFAULT_ENDPOINT;
  const res = await axios.get(`${base}/admin-api/applications`, { headers: authHeaders() });
  const apps: unknown[] = res.data?.data?.apps ?? [];
  const ids = apps
    .map((a) => {
      if (!a || typeof a !== "object") return "";
      const t = a as { id?: string; applicationId?: string };
      return t.id ?? t.applicationId ?? "";
    })
    .filter(Boolean);
  if (!ids.length) throw new Error("No applications installed on this node.");
  return ids.includes(preferred) ? preferred : ids[0];
}

// When the alias is missing the user gets shown an ID slice. That's
// the "weird ID instead of name" complaint from the explainer — the
// aliased namespace metadata isn't propagated by rc.35 governance to
// nodes that joined via invitation, and only a namespace admin can set
// it locally. Until the upstream fix ships, fall back to a friendlier
// "Workspace {short-id}" label rather than the bare hex slice.
function nsLabel(g: GroupSummary): string {
  const alias = g.alias?.trim();
  if (alias) return alias;
  const stored = getStoredGroupAlias(g.groupId).trim();
  if (stored) return stored;
  return `Workspace ${g.groupId.slice(0, 6)}`;
}

// ─── Component ───────────────────────────────────────────────────────────────

interface Props {
  isAuthenticated: boolean;
  isConfigSet: boolean;
  onLogout: () => void;
}

export default function NamespaceEntryPopup({ isAuthenticated, isConfigSet, onLogout }: Props) {
  const navigate = useNavigate();
  const api = useRef(new GroupApiDataSource());

  const [step, setStep] = useState<Step>("loading");
  const [namespaces, setNamespaces] = useState<GroupSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [nameInput, setNameInput] = useState(getMessengerDisplayName());
  const [nsNameInput, setNsNameInput] = useState("");
  const [inviteStatus, setInviteStatus] = useState("");
  const [joinInviteInput, setJoinInviteInput] = useState("");
  const [error, setError] = useState("");

  // Final step: commit selection, persist the chosen handle as the
  // namespace-level member name, then navigate to chat. The user only
  // gets the channels they explicitly join (self-join for Open subgroups,
  // admin-add for Restricted) — no force-joining contexts at workspace
  // entry.
  const enterChat = useCallback(async (namespaceId: string, username: string, memberIdentity: string) => {
    setGroupId(namespaceId);
    setMessengerDisplayName(username);
    if (memberIdentity) {
      setGroupMemberIdentity(namespaceId, memberIdentity);
      setIdentityDisplayName(memberIdentity, username);
      // Propagate the chosen handle as the namespace-level member name.
      // Without this, other users' `listMembers(namespaceId)` returns
      // this member with `name: null` and the channel/DM/admin UIs all
      // fall through to displaying the raw identity string.
      if (username) {
        api.current
          .setMemberMetadata(namespaceId, memberIdentity, { name: username })
          .catch(() => {
            /* non-fatal */
          });
      }
    }
    clearStoredSession();
    setNamespaceReady();
    navigate("/");
  }, [navigate]);

  // Check whether this node already has identity + username for a namespace.
  // Recovery order: server alias (node) → per-identity cache → WASM profiles → enter-name.
  // Server alias is the authoritative source — if set, the user is never re-prompted.
  const checkNamespace = useCallback(async (namespaceId: string) => {
    setStep("checking");
    setError("");

    try {
      const storedIdentity = getGroupMemberIdentity(namespaceId);
      const res = await api.current.resolveCurrentMemberIdentity(namespaceId, storedIdentity);

      if (res.data?.memberIdentity) {
        const memberIdentity = res.data.memberIdentity;
        setGroupMemberIdentity(namespaceId, memberIdentity);

        // 1. Server alias — authoritative, survives localStorage.clear() and re-login
        const serverAlias = res.data.members
          ?.find((m) => m.identity === memberIdentity)
          ?.alias?.trim();

        if (serverAlias) {
          setIdentityDisplayName(memberIdentity, serverAlias);
          enterChat(namespaceId, serverAlias, memberIdentity);
          return;
        }

        // 2. Per-identity cache — fast path within a session
        const cachedName = getIdentityDisplayName(memberIdentity);
        if (cachedName) {
          // Back-fill server alias so future re-logins don't reach enter-name
          api.current.setMemberMetadata(namespaceId, memberIdentity, { name: cachedName }).catch(() => {});
          enterChat(namespaceId, cachedName, memberIdentity);
          return;
        }

        // 3. WASM profiles — P2P-replicated, may be set from another device
        const ctxRes = await api.current.listGroupContexts(namespaceId);
        if (ctxRes.data?.length) {
          const clientApi = new ClientApiDataSource();
          for (const ctx of ctxRes.data) {
            const profilesRes = await clientApi.getProfiles(ctx.contextId, memberIdentity);
            if (profilesRes.data) {
              const myProfile = profilesRes.data.find((p) => p.identity === memberIdentity);
              if (myProfile?.username) {
                api.current.setMemberMetadata(namespaceId, memberIdentity, { name: myProfile.username }).catch(() => {});
                setIdentityDisplayName(memberIdentity, myProfile.username);
                enterChat(namespaceId, myProfile.username, memberIdentity);
                return;
              }
            }
          }
        }
      }
    } catch {
      // Identity lookup failed — fall through to enter-name
    }

    setStep("enter-name");
  }, [enterChat]);

  // Process a pending invitation (join namespace → sync → join all contexts)
  const processInvitation = useCallback(async (payload: string, afterJoin?: string) => {
    setStep("invite-join");
    setError("");

    const parsed = parseGroupInvitationPayload(payload);
    if (!parsed) {
      setError("Invalid invitation payload.");
      setStep("error");
      return;
    }

    try {
      setInviteStatus("Joining namespace…");
      const joinRes = await api.current.joinGroup({
        invitation: parsed.invitation,
        groupAlias: parsed.groupAlias,
      });
      if (joinRes.error || !joinRes.data) {
        throw new Error(joinRes.error?.message || "Failed to join namespace");
      }

      const { groupId, memberIdentity } = joinRes.data;
      setGroupMemberIdentity(groupId, memberIdentity);
      if (parsed.groupAlias?.trim()) setStoredGroupAlias(groupId, parsed.groupAlias.trim());

      setInviteStatus("Syncing…");
      await api.current.syncGroup(groupId).catch(() => {});

      clearInvitationFromStorage();

      // After joining, show the enter-name step for this namespace
      setSelectedId(groupId);
      setNamespaces((prev) => {
        if (prev.find((g) => g.groupId === groupId)) return prev;
        return [...prev, {
          groupId,
          alias: parsed.groupAlias?.trim() || afterJoin,
          appKey: "",
          targetApplicationId: "",
          upgradePolicy: "Automatic",
          createdAt: Math.floor(Date.now() / 1000),
        }];
      });

      // If user already has a name (same identity from another workspace), go straight in
      const existingName = getIdentityDisplayName(memberIdentity) || getMessengerDisplayName();
      if (existingName) {
        api.current.setMemberMetadata(groupId, memberIdentity, { name: existingName }).catch(() => {});
        enterChat(groupId, existingName, memberIdentity);
        return;
      }

      setStep("enter-name");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to process invitation");
      setStep("error");
    }
  }, [enterChat]);

  // Initial load
  const loadNamespaces = useCallback(async () => {
    if (!getNodeUrl()) return;

    setStep("loading");
    setError("");

    // Save invitation from URL to storage before anything else
    const urlInvite = extractInvitationFromUrl();
    if (urlInvite) saveInvitationToStorage(urlInvite);

    let groups: GroupSummary[] = [];
    try {
      const res = await api.current.listGroups();
      groups = (res.data ?? []).map((g) => ({
        ...g,
        alias: g.alias?.trim() || getStoredGroupAlias(g.groupId) || undefined,
      }));
    } catch {
      setError("Could not reach node. Is merod running?");
      setStep("error");
      return;
    }

    setNamespaces(groups);

    // Check for a pending invitation
    const pendingInvite = getInvitationFromStorage();

    if (groups.length === 0) {
      if (pendingInvite) {
        // No namespace yet but we have an invitation — join via it
        void processInvitation(pendingInvite);
        return;
      }
      setStep("no-workspace");
      return;
    }

    // If there's an invitation for a namespace we're not in yet, process it
    if (pendingInvite) {
      const parsed = parseGroupInvitationPayload(pendingInvite);
      if (parsed) {
        const inv = parsed.invitation.invitation as unknown as Record<string, unknown>;
        const rawId = inv.group_id ?? inv.groupId;
        const invNsId = Array.isArray(rawId)
          ? (rawId as number[]).map((b) => b.toString(16).padStart(2, "0")).join("")
          : String(rawId ?? "");
        if (invNsId && !groups.find((g) => g.groupId === invNsId)) {
          void processInvitation(pendingInvite);
          return;
        }
      }
      clearInvitationFromStorage();
    }

    const storedId = getGroupId();
    const preferred = groups.find((g) => g.groupId === storedId) ?? groups[0];
    setSelectedId(preferred.groupId);
    setStep("select");
  }, [checkNamespace, processInvitation]);

  useEffect(() => {
    if (isAuthenticated || isConfigSet) {
      void loadNamespaces();
    }
  }, [loadNamespaces, isAuthenticated, isConfigSet]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleSelectContinue = () => {
    if (selectedId) void checkNamespace(selectedId);
  };

  const handleJoin = useCallback(async () => {
    const trimmed = nameInput.trim();
    if (!trimmed || !selectedId) return;

    setStep("joining");
    setError("");

    try {
      const storedIdentity = getGroupMemberIdentity(selectedId);
      const res = await api.current.resolveCurrentMemberIdentity(selectedId, storedIdentity);
      const memberIdentity = res.data?.memberIdentity ?? storedIdentity;

      if (memberIdentity) {
        await api.current.setMemberMetadata(selectedId, memberIdentity, { name: trimmed }).catch(() => {});
      }

      enterChat(selectedId, trimmed, memberIdentity);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to join chat");
      setStep("enter-name");
    }
  }, [nameInput, selectedId, enterChat]);

  const handleCreate = useCallback(async () => {
    const trimmedNs = nsNameInput.trim();
    if (!trimmedNs) return;

    const isDuplicate = namespaces.some(
      (n) => (n.alias ?? "").toLowerCase() === trimmedNs.toLowerCase(),
    );
    if (isDuplicate) {
      setError("A workspace with this name already exists");
      return;
    }

    setStep("creating");
    setError("");

    try {
      const appId = await resolveAppId(getApplicationId());
      const createRes = await api.current.createGroup({
        applicationId: appId,
        upgradePolicy: "LazyOnAccess",
        alias: trimmedNs,
      });
      if (createRes.error || !createRes.data) {
        throw new Error(createRes.error?.message || "Failed to create namespace");
      }

      const { groupId } = createRes.data;

      await api.current.setDefaultCapabilities(groupId, { defaultCapabilities: 0x0F }).catch(() => {});

      // Create initial "general" channel so the namespace has something to chat in
      try {
        const base = getNodeUrl() || DEFAULT_ENDPOINT;
        const ctxRes = await axios.post<{ data: { contextId: string; memberPublicKey: string } }>(
          `${base}/admin-api/contexts`,
          // Send both `name` (new, persisted into MetadataRecord on core
          // post-054a784f) and `alias` (old, for transition compatibility).
          { applicationId: appId, groupId, alias: "general", name: "general" },
          { headers: authHeaders() },
        );
        const ctxData = ctxRes.data?.data;
        if (ctxData?.contextId && ctxData?.memberPublicKey) {
          setContextMemberIdentity(ctxData.contextId, ctxData.memberPublicKey);
        }
      } catch { /* non-fatal — user can create channels from the app */ }

      const idRes = await api.current.resolveCurrentMemberIdentity(groupId);
      if (idRes.data?.memberIdentity) {
        setGroupMemberIdentity(groupId, idRes.data.memberIdentity);
      }

      setNamespaces([{
        groupId,
        alias: trimmedNs,
        appKey: "",
        targetApplicationId: "",
        upgradePolicy: "LazyOnAccess",
        createdAt: Math.floor(Date.now() / 1000),
      }]);
      setSelectedId(groupId);

      const existingName = getMessengerDisplayName();
      if (existingName) {
        enterChat(groupId, existingName, idRes.data?.memberIdentity ?? "");
        return;
      }

      setStep("enter-name");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create namespace");
      setStep("create");
    }
  }, [nsNameInput, namespaces, enterChat]);

  const handleJoinFromCode = useCallback(async () => {
    const raw = joinInviteInput.trim();
    if (!raw) return;
    setError("");
    const payload = parseInvitationInput(raw);
    if (!payload) {
      setError("Could not parse invitation. Paste the full link or the raw encoded code.");
      return;
    }
    saveInvitationToStorage(payload);
    await processInvitation(payload);
  }, [joinInviteInput, processInvitation]);

  // ── Render ──────────────────────────────────────────────────────────────────

  const isDuplicateNsName =
    nsNameInput.trim().length > 0 &&
    namespaces.some((n) => (n.alias ?? "").toLowerCase() === nsNameInput.trim().toLowerCase());

  const selectedNs = namespaces.find((g) => g.groupId === selectedId);

  return (
    <Overlay>
      <Box>
        {/* Loading */}
        {(step === "loading" || step === "checking") && (
          <>
            <Spinner />
            <Info>{step === "loading" ? "Connecting to node…" : "Checking identity…"}</Info>
          </>
        )}

        {/* Invite join in progress */}
        {step === "invite-join" && (
          <>
            <Spinner />
            <Info>{inviteStatus || "Processing invitation…"}</Info>
          </>
        )}

        {/* Joining */}
        {step === "joining" && (
          <>
            <Spinner />
            <Info>Entering chat…</Info>
          </>
        )}

        {/* Creating namespace — handled inline inside the "create" step (spinner on button) */}

        {/* Select namespace */}
        {step === "select" && (
          <>
            <Header>
              <Title>Select workspace</Title>
              <Sub>Pick the workspace you want to join.</Sub>
            </Header>
            {error && <Err>{error}</Err>}
            <Field>
              <Label>Server</Label>
              <Select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
                {namespaces.map((g) => (
                  <option key={g.groupId} value={g.groupId}>{nsLabel(g)}</option>
                ))}
              </Select>
            </Field>
            <Button
              type="button"
              variant="primary"
              style={{ width: "100%" }}
              onClick={handleSelectContinue}
              disabled={!selectedId}
            >
              Continue
            </Button>
            <CreateLink onClick={() => { setError(""); setNsNameInput(""); setStep("create"); }}>
              + Create new workspace
            </CreateLink>
            <CreateLink onClick={() => { setError(""); setJoinInviteInput(""); setStep("join-invitation"); }}>
              Join existing workspace
            </CreateLink>
            <Divider />
            <LogoutBtn onClick={onLogout}>Disconnect node</LogoutBtn>
          </>
        )}

        {/* Enter name */}
        {step === "enter-name" && (
          <>
            <Header>
              <Title>
                {selectedNs ? `Join ${nsLabel(selectedNs)}` : "Join chat"}
              </Title>
              <Sub>Choose a display name to use in this server.</Sub>
            </Header>
            {error && <Err>{error}</Err>}
            <Field>
              <Label>Your name</Label>
              <div onKeyDown={(e) => { if (e.key === "Enter") void handleJoin(); }}>
                <Input
                  type="text"
                  placeholder="e.g. Alice"
                  value={nameInput}
                  onChange={(e) => { setNameInput(e.target.value); setError(""); }}
                  autoFocus
                />
              </div>
            </Field>
            <Button
              type="button"
              variant="primary"
              style={{ width: "100%" }}
              onClick={() => void handleJoin()}
              disabled={!nameInput.trim()}
            >
              Join chat
            </Button>
            {namespaces.length > 1 && (
              <Button
                type="button"
                variant="secondary"
                style={{ width: "100%", marginTop: "0.5rem" }}
                onClick={() => setStep("select")}
              >
                ← Back
              </Button>
            )}
            <Divider />
            <LogoutBtn onClick={onLogout}>Disconnect node</LogoutBtn>
          </>
        )}

        {/* No workspace: offer create or join via invitation code */}
        {step === "no-workspace" && (
          <>
            <Header>
              <Title>Welcome to MeroChat</Title>
              <Sub>No servers found on this node. Create one, or join via an invitation link.</Sub>
            </Header>
            {error && <Err>{error}</Err>}
            <Button
              type="button"
              variant="primary"
              style={{ width: "100%" }}
              onClick={() => { setError(""); setStep("create"); }}
            >
              Create workspace
            </Button>
            <CreateLink onClick={() => { setError(""); setJoinInviteInput(""); setStep("join-invitation"); }}>
              Join existing workspace
            </CreateLink>
            <Divider />
            <LogoutBtn onClick={onLogout}>Disconnect node</LogoutBtn>
          </>
        )}

        {/* Join via invitation code */}
        {step === "join-invitation" && (
          <>
            <Header>
              <Title>Join workspace</Title>
              <Sub>Paste an invitation link or code to join an existing workspace.</Sub>
            </Header>
            {error && <Err>{error}</Err>}
            <Field>
              <Label>Invitation</Label>
              <Textarea
                placeholder={"calimero://curb/join?invitation=… or paste the raw encoded code"}
                value={joinInviteInput}
                onChange={(e) => { setJoinInviteInput(e.target.value); setError(""); }}
                autoFocus
              />
            </Field>
            <Button
              type="button"
              variant="primary"
              style={{ width: "100%" }}
              onClick={() => void handleJoinFromCode()}
              disabled={!joinInviteInput.trim()}
            >
              Join
            </Button>
            <Button
              type="button"
              variant="secondary"
              style={{ width: "100%", marginTop: "0.5rem" }}
              onClick={() => { setError(""); setJoinInviteInput(""); setStep(namespaces.length > 0 ? "select" : "no-workspace"); }}
            >
              ← Back to workspace selection
            </Button>
          </>
        )}

        {/* Create namespace */}
        {(step === "create" || step === "creating") && (
          <>
            <Header>
              <Title>Create workspace</Title>
              <Sub>Give your server a name to get started.</Sub>
            </Header>
            <Field>
              <Label>Server name</Label>
              <div onKeyDown={(e) => {
                if (e.key === "Enter" && step !== "creating" && nsNameInput.trim() && nsNameInput.trim().length <= 64) {
                  void handleCreate();
                }
              }}>
                <Input
                  type="text"
                  placeholder="e.g. My Team"
                  value={nsNameInput}
                  onChange={(e) => { setNsNameInput(e.target.value); setError(""); }}
                  autoFocus
                  disabled={step === "creating"}
                />
              </div>
              {nsNameInput.length > 64 && (
                <FieldError>Name must be 64 characters or fewer ({nsNameInput.length}/64)</FieldError>
              )}
              {nsNameInput.length <= 64 && isDuplicateNsName && (
                <FieldError>A workspace with this name already exists</FieldError>
              )}
              {nsNameInput.length <= 64 && !isDuplicateNsName && error && (
                <FieldError>{error}</FieldError>
              )}
            </Field>
            <Button
              type="button"
              variant="primary"
              style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}
              onClick={() => void handleCreate()}
              disabled={step === "creating" || !nsNameInput.trim() || nsNameInput.trim().length > 64 || isDuplicateNsName}
            >
              {step === "creating" ? (
                <>
                  <BtnSpinner />
                  Creating…
                </>
              ) : "Create"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              style={{ width: "100%", marginTop: "0.5rem" }}
              onClick={() => { setError(""); setStep(namespaces.length > 0 ? "select" : "no-workspace"); }}
              disabled={step === "creating"}
            >
              ← Back
            </Button>
            <Divider />
            <LogoutBtn onClick={onLogout} disabled={step === "creating"}>Disconnect node</LogoutBtn>
          </>
        )}

        {/* Error */}
        {step === "error" && (
          <>
            <Header>
              <Title>Something went wrong</Title>
            </Header>
            <Err>{error}</Err>
            <Row>
              <Button
                type="button"
                variant="primary"
                style={{ flex: 1 }}
                onClick={() => void loadNamespaces()}
              >
                Retry
              </Button>
              <Button
                type="button"
                variant="secondary"
                style={{ flex: 1 }}
                onClick={onLogout}
              >
                Disconnect
              </Button>
            </Row>
          </>
        )}
      </Box>
    </Overlay>
  );
}
