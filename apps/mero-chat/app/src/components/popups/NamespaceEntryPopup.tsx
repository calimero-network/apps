import { useState, useEffect, useCallback, useRef } from "react";
import { styled, keyframes } from "styled-components";
import { Button, Input } from "@calimero-network/mero-ui";
import { getNodeUrl } from "@calimero-network/mero-react";
import { GroupApiDataSource } from "../../api/dataSource/groupApiDataSource";
import { ClientApiDataSource } from "../../api/dataSource/clientApiDataSource";
import type { GroupSummary } from "../../api/groupApi";
import {
  getApplicationId,
  getGroupId,
  getGroupMemberIdentity,
  setGroupMemberIdentity,
  getStoredGroupAlias,
  setStoredGroupAlias,
} from "../../constants/config";
import {
  getMessengerDisplayName,
  getIdentityDisplayName,
  setIdentityDisplayName,
} from "../../utils/messengerName";
import { DEFAULT_MEMBER_CAPABILITIES } from "../../utils/groupCapabilities";
import {
  AppNotInstalledError,
  installConfiguredApp,
  resolveInstalledAppId,
} from "../../utils/installedApps";
import { useToast } from "../../contexts/ToastContext";
import {
  enterWorkspace,
  forgetJoinedAwaitingName,
  joinedAwaitingName,
} from "../../utils/enterWorkspace";

// ─── Types ────────────────────────────────────────────────────────────────────

type Step =
  | "loading"
  | "select"           // multiple namespaces, user picks
  | "checking"         // resolving identity for selected namespace
  | "enter-name"       // namespace ok, need username
  | "joining"          // submitting username
  | "no-workspace"     // no namespaces: offer create, or say how to join
  | "create"           // show create workspace form
  | "creating"         // creating namespace
  | "not-installed"    // configured app missing on the node: offer install
  | "installing"       // installing the configured app
  | "error";

// ─── Styled components ────────────────────────────────────────────────────────

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: var(--chat-scrim);
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
  background: var(--glass-surface-solid);
  border: 1px solid color-mix(in srgb, var(--glass-ink) 8%, transparent);
  border-radius: 16px;
  padding: 2rem;
  width: 90%;
  max-width: 420px;
  box-shadow: var(--chat-dialog-shadow);
  animation: ${fadeIn} 0.22s ease both;
`;

const Header = styled.div`
  margin-bottom: 1.5rem;
`;

const Title = styled.h2`
  color: var(--glass-ink);
  font-size: 1.25rem;
  font-weight: 700;
  margin: 0 0 0.35rem;
  letter-spacing: -0.02em;
`;

const Sub = styled.p`
  color: color-mix(in srgb, var(--glass-ink) 38%, transparent);
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
  color: color-mix(in srgb, var(--glass-ink) 45%, transparent);
  letter-spacing: 0.04em;
  text-transform: uppercase;
`;

const Select = styled.select`
  appearance: none;
  -webkit-appearance: none;
  padding: 0.7rem 2.5rem 0.7rem 0.9rem;
  background-color: color-mix(in srgb, var(--glass-accent) 4%, transparent);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23a5ff11' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 0.75rem center;
  background-size: 16px;
  border: 1px solid color-mix(in srgb, var(--glass-accent) 22%, transparent);
  border-radius: 10px;
  color: var(--glass-ink);
  font-size: 0.85rem;
  cursor: pointer;
  width: 100%;
  transition: border-color 0.15s, box-shadow 0.15s;

  &:hover {
    border-color: color-mix(in srgb, var(--glass-accent) 45%, transparent);
    background-color: color-mix(in srgb, var(--glass-accent) 7%, transparent);
  }

  &:focus {
    outline: none;
    border-color: color-mix(in srgb, var(--glass-accent) 60%, transparent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--glass-accent) 12%, transparent);
  }

  option {
    background: var(--glass-surface-solid);
    color: var(--glass-ink);
  }
`;

const CreateLink = styled.button`
  background: none;
  border: none;
  color: var(--glass-accent);
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
  color: var(--glass-bad-ink);
  background: rgba(255, 107, 107, 0.08);
  border: 1px solid rgba(255, 107, 107, 0.18);
  border-radius: 12px;
  padding: 0.65rem 0.85rem;
  font-size: 0.8rem;
  margin-bottom: 1rem;
  word-break: break-word;
  overflow-wrap: break-word;
  max-height: 120px;
  overflow-y: auto;
`;

const Info = styled.div`
  color: color-mix(in srgb, var(--glass-ink) 45%, transparent);
  font-size: 0.8rem;
  text-align: center;
  margin-bottom: 1rem;
`;

// How to join a workspace someone else runs: there is no field for it. An
// invitation is a link, and opening it brings up the app-level prompt.
const JoinHint = styled.p`
  color: color-mix(in srgb, var(--glass-ink) 38%, transparent);
  font-size: 0.75rem;
  text-align: center;
  line-height: 1.5;
  margin: 0.9rem 0 0;
`;

const Spinner = styled.div`
  width: 28px;
  height: 28px;
  border: 2px solid color-mix(in srgb, var(--glass-accent) 15%, transparent);
  border-top-color: var(--glass-accent);
  border-radius: 50%;
  animation: ${spin} 0.7s linear infinite;
  margin: 0 auto 1rem;
`;

const BtnSpinner = styled.div`
  width: 14px;
  height: 14px;
  border: 2px solid color-mix(in srgb, var(--glass-accent) 30%, transparent);
  border-top-color: var(--glass-accent);
  border-radius: 50%;
  animation: ${spin} 0.7s linear infinite;
  flex-shrink: 0;
`;

const FieldError = styled.p`
  color: var(--glass-bad-ink);
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
  background: color-mix(in srgb, var(--glass-ink) 5%, transparent);
  margin: 1rem 0;
`;

const LogoutBtn = styled.button`
  background: none;
  border: none;
  color: color-mix(in srgb, var(--glass-ink) 25%, transparent);
  font-size: 0.75rem;
  cursor: pointer;
  padding: 0;
  margin-top: 1rem;
  width: 100%;
  text-align: center;
  transition: color 0.15s;

  &:hover { color: color-mix(in srgb, var(--glass-ink) 50%, transparent); }
`;


// ─── Helpers ─────────────────────────────────────────────────────────────────


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
  const api = useRef(new GroupApiDataSource());
  const { addToast } = useToast();

  const [step, setStep] = useState<Step>("loading");
  const [namespaces, setNamespaces] = useState<GroupSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [nameInput, setNameInput] = useState(getMessengerDisplayName());
  const [nsNameInput, setNsNameInput] = useState("");
  const [error, setError] = useState("");

  // Final step: commit the selection and go into the chat (see enterWorkspace).
  const enterChat = useCallback((namespaceId: string, username: string, memberIdentity: string) => {
    enterWorkspace(api.current, namespaceId, username, memberIdentity);
  }, []);

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

  // Initial load
  const loadNamespaces = useCallback(async () => {
    if (!getNodeUrl()) return;

    setStep("loading");
    setError("");

    let groups: GroupSummary[] = [];
    try {
      const res = await api.current.listGroups();
      // ⚠️ `listGroups` RETURNS a failure, it does not throw — `catchError`
      // turns every error into `{ data: null, error }`. So `res.data ?? []`
      // read a failed or timed-out listing as an EMPTY one, and an empty
      // listing is indistinguishable from "a member of nothing". A listing
      // that fails means "could not tell", never "not a member".
      if (res.error) throw new Error(res.error.message);
      groups = (res.data ?? []).map((g) => ({
        ...g,
        alias: g.alias?.trim() || getStoredGroupAlias(g.groupId) || undefined,
      }));
    } catch {
      setError("Could not reach node. Is merod running?");
      setStep("error");
      return;
    }

    // An invitation was just accepted by someone with no display name yet: open
    // on that workspace's name step, not the list. The node may not list it
    // yet, so it is added from what this browser knows.
    const joined = joinedAwaitingName();
    if (joined) {
      if (!groups.some((g) => g.groupId === joined)) {
        groups = [...groups, {
          groupId: joined,
          alias: getStoredGroupAlias(joined) || undefined,
          appKey: "",
          targetApplicationId: "",
          upgradePolicy: "Automatic",
          createdAt: Math.floor(Date.now() / 1000),
        }];
      }
      setNamespaces(groups);
      setSelectedId(joined);
      setStep("enter-name");
      return;
    }

    setNamespaces(groups);

    if (groups.length === 0) {
      setStep("no-workspace");
      return;
    }

    const storedId = getGroupId();
    const preferred = groups.find((g) => g.groupId === storedId) ?? groups[0];
    setSelectedId(preferred.groupId);
    setStep("select");
  }, []);

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
      const appId = await resolveInstalledAppId(getApplicationId());
      const createRes = await api.current.createGroup({
        applicationId: appId,
        name: trimmedNs,
      });
      if (createRes.error || !createRes.data) {
        throw new Error(createRes.error?.message || "Failed to create namespace");
      }

      const { groupId, haError } = createRes.data;
      // An account's founding also asked the cloud to host the workspace, and
      // it can say no (the account is not linked to a cloud user, no fleet
      // node could be admitted, …). The workspace exists either way; what is
      // lost is the ability to invite anyone until the cause is fixed. Say so
      // now, where the person can act on it, not as a failed Invite later.
      if (haError) {
        addToast({
          title: "Workspace created, but not hosted yet",
          message: `Nobody can be invited to it until this is fixed: ${haError}`,
          type: "channel",
          duration: 12000,
        });
      }
      setStoredGroupAlias(groupId, trimmedNs);
      // The `name` passed to createNamespace above does not reach the group's
      // metadata record — a freshly created namespace reads back
      // `metadata: null` — so write it explicitly. The creator is admin, so
      // this is the call that actually succeeds and gives the workspace a name
      // everyone can see.
      await api.current.setGroupMetadata(groupId, trimmedNs).catch(() => {});

      await api.current.setDefaultCapabilities(groupId, { defaultCapabilities: DEFAULT_MEMBER_CAPABILITIES }).catch(() => {});

      const idRes = await api.current.resolveCurrentMemberIdentity(groupId);
      if (idRes.data?.memberIdentity) {
        setGroupMemberIdentity(groupId, idRes.data.memberIdentity);
      }

      setNamespaces([{
        groupId,
        alias: trimmedNs,
        appKey: "",
        targetApplicationId: "",
        upgradePolicy: "Automatic",
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
      if (err instanceof AppNotInstalledError) {
        setStep("not-installed");
        return;
      }
      setError(err instanceof Error ? err.message : "Failed to create namespace");
      setStep("create");
    }
  }, [nsNameInput, namespaces, enterChat, addToast]);

  // Install the configured app, then resume the create the user asked for.
  const handleInstallApp = useCallback(async () => {
    setStep("installing");
    setError("");
    try {
      const installedId = await installConfiguredApp();
      const expectedId = getApplicationId();
      // The id is a hash over the wasm AND its metadata, so a successful
      // install can still produce a different app than this build targets.
      if (installedId !== expectedId) {
        setError(
          `Installed ${installedId}, but this build expects ${expectedId}. ` +
            `The published WASM or its metadata differs from what this build was made against.`,
        );
        setStep("error");
        return;
      }
      setStep("create");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to install the application");
      setStep("error");
    }
  }, []);

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
            <JoinHint data-testid="join-hint">
              To join someone else&apos;s workspace, open the invitation link they sent you.
            </JoinHint>
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
            <Button
              type="button"
              variant="secondary"
              style={{ backgroundColor: "var(--glass-surface-solid)", color: "var(--glass-ink)", borderColor: "var(--glass-line-strong)", width: "100%", marginTop: "0.5rem" }}
              onClick={() => {
                setError("");
                forgetJoinedAwaitingName();
                setStep(namespaces.length > 0 ? "select" : "no-workspace");
              }}
            >
              ← Back
            </Button>
            <Divider />
            <LogoutBtn onClick={onLogout}>Disconnect node</LogoutBtn>
          </>
        )}

        {/* No workspace: offer create, and say how joining one works */}
        {step === "no-workspace" && (
          <>
            <Header>
              <Title>Welcome to MeroChat</Title>
              <Sub>No servers found on this node yet. Create one to get started.</Sub>
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
            <JoinHint data-testid="join-hint">
              To join someone else&apos;s workspace, open the invitation link they sent you.
            </JoinHint>
            <Divider />
            <LogoutBtn onClick={onLogout}>Disconnect node</LogoutBtn>
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
              style={{ backgroundColor: "var(--glass-surface-solid)", color: "var(--glass-ink)", borderColor: "var(--glass-line-strong)", width: "100%", marginTop: "0.5rem" }}
              onClick={() => { setError(""); setStep(namespaces.length > 0 ? "select" : "no-workspace"); }}
              disabled={step === "creating"}
            >
              ← Back
            </Button>
            <Divider />
            <LogoutBtn onClick={onLogout} disabled={step === "creating"}>Disconnect node</LogoutBtn>
          </>
        )}

        {/* Configured app missing on the node */}
        {(step === "not-installed" || step === "installing") && (
          <>
            <Header>
              <Title>Chat isn't installed yet</Title>
            </Header>
            <Sub>
              This node doesn't have the chat application installed. Install it
              to create your workspace.
            </Sub>
            <Button
              type="button"
              variant="primary"
              style={{ width: "100%" }}
              onClick={handleInstallApp}
              disabled={step === "installing"}
            >
              {step === "installing" ? (
                <>
                  <BtnSpinner />
                  Installing…
                </>
              ) : "Install"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              style={{ backgroundColor: "var(--glass-surface-solid)", color: "var(--glass-ink)", borderColor: "var(--glass-line-strong)", width: "100%", marginTop: "0.5rem" }}
              onClick={() => { setError(""); setStep(namespaces.length > 0 ? "select" : "no-workspace"); }}
              disabled={step === "installing"}
            >
              ← Back
            </Button>
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
                variant="secondary"
                style={{ backgroundColor: "var(--glass-surface-solid)", color: "var(--glass-ink)", borderColor: "var(--glass-line-strong)", flex: 1 }}
                onClick={() => { setError(""); setStep(namespaces.length > 0 ? "select" : "no-workspace"); }}
              >
                ← Back
              </Button>
              <Button
                type="button"
                variant="primary"
                style={{ flex: 1 }}
                onClick={() => void loadNamespaces()}
              >
                Retry
              </Button>
            </Row>
          </>
        )}
      </Box>
    </Overlay>
  );
}
