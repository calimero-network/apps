import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMero, setApplicationId } from "@calimero-network/mero-react";
import {
  adminGet,
  adminPost,
  adminPut,
  adminDelete,
  listNamespaces,
  joinContext,
} from "../../api/rpc";
import { resolveApplicationId } from "../../api/appId";
import CalendarLogo from "../../components/common/logo/CalendarLogo";
import ThemeToggle from "../../components/common/theme-toggle/ThemeToggle";
import { useToast } from "../../contexts/ToastContext";
import { extractErrorMessage, humanizeError } from "../../utils/errorMessage";
import {
  decodeInvitationObject,
  encodeInvitationObject,
  invitationLink,
  invitationTokenFrom,
} from "../../utils/invitation";
import { onInvitation } from "../../utils/invitationIntents";
import {
  getStoredTeamName,
  setStoredTeamName,
  teamLabel,
} from "../../utils/teamName";
import type { Team } from "../../types/workspace";
import styles from "./teams.module.scss";

type NamespaceRaw = {
  namespaceId?: string;
  groupId?: string;
  id?: string;
  alias?: string;
  name?: string;
};

type SubgroupRaw = {
  groupId?: string;
  group_id?: string;
  id?: string;
};

type ContextRaw = {
  contextId?: string;
  context_id?: string;
  id?: string;
};

export default function TeamsPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { applicationId, logout } = useMero();
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState("");
  const [inviteFor, setInviteFor] = useState<{ id: string; code: string } | null>(
    null,
  );
  const menuRef = useRef<HTMLDivElement>(null);

  // Mero Calendar's own application id, resolved once per mount (see appId.ts).
  // Resolution already prefers the session's id, but only when the node really
  // has it — so the persisted id is a fallback for the case where we could not
  // reach /applications at all. Shared by list/create/join/open so every
  // namespace + context is scoped to the right app.
  const appIdRef = useRef<string>("");
  const ensureAppId = useCallback(async (): Promise<string> => {
    if (appIdRef.current) return appIdRef.current;
    let id = "";
    try {
      id = await resolveApplicationId();
    } catch {
      /* ignore */
    }
    if (!id) id = applicationId ?? "";
    if (id) {
      appIdRef.current = id;
      setApplicationId(id);
    }
    return id;
  }, [applicationId]);

  useEffect(() => {
    let cancelled = false;
    async function loadTeams() {
      const appId = await ensureAppId();
      listNamespaces<NamespaceRaw[]>(appId)
        .then((items) => {
          if (cancelled) return;
          const arr = Array.isArray(items) ? items : [];
          setTeams(
            arr.map((n) => ({
              groupId: n.namespaceId ?? n.groupId ?? n.id ?? "",
              name: n.alias ?? n.name ?? "",
            })),
          );
        })
        .catch(() => {
          if (!cancelled) setTeams([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }
    loadTeams();
    const id = setInterval(loadTeams, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [ensureAppId]);

  // Close dropdown on outside click
  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  async function createTeam() {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const data = await adminPost<{
        namespaceId?: string;
        groupId?: string;
        id?: string;
      }>("/namespaces", {
        applicationId: await ensureAppId(),
        alias: name,
        name,
        // No `upgradePolicy`: core removed the concept in rc.21 and mero-js
        // dropped it from CreateNamespaceRequest in 9.0.0. An rc.24 node accepts
        // the field and ignores it, so this was silently doing nothing while
        // reading as though a policy were being chosen.
      });
      const id = data.namespaceId ?? data.groupId ?? data.id ?? "";
      if (id) setStoredTeamName(id, name);
      setTeams((prev) => [...prev, { groupId: id, name }]);
      setNewName("");
    } catch (err) {
      showToast(extractErrorMessage(err, "Could not create team."));
    } finally {
      setCreating(false);
    }
  }

  async function deleteTeam(teamId: string) {
    setMenuOpenId(null);
    try {
      await adminDelete(`/namespaces/${teamId}`);
    } catch {
      /* best-effort */
    }
    setTeams((prev) => prev.filter((t) => t.groupId !== teamId));
  }

  async function joinTeam(codeOverride?: string): Promise<boolean> {
    // Accept either a shared invitation link or the bare token inside it.
    const raw = invitationTokenFrom(codeOverride ?? joinCode);
    if (!raw) return false;
    setJoining(true);
    setJoinError("");
    try {
      const invObj = decodeInvitationObject<Record<string, unknown>>(raw);
      const outer = (invObj.invitation as Record<string, unknown>) ?? invObj;
      const inner = (outer?.invitation as Record<string, unknown>) ?? outer;
      const rawGroupId =
        inner?.group_id ?? inner?.groupId ?? outer?.group_id ?? outer?.groupId;
      const namespaceId = Array.isArray(rawGroupId)
        ? (rawGroupId as number[])
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("")
        : String(rawGroupId ?? "");

      if (!namespaceId) throw new Error("no namespace id in invitation");

      const embeddedName =
        typeof invObj.__teamName === "string" ? invObj.__teamName.trim() : "";
      if (embeddedName) setStoredTeamName(namespaceId, embeddedName);

      await adminPost(`/namespaces/${namespaceId}/join`, { invitation: outer });

      const items = await listNamespaces<NamespaceRaw[]>(await ensureAppId());
      const arr = Array.isArray(items) ? items : [];
      setTeams(
        arr.map((n) => {
          const gid = n.namespaceId ?? n.groupId ?? n.id ?? "";
          const serverName = (n.alias ?? n.name ?? "").trim();
          if (gid === namespaceId && embeddedName && !serverName)
            return { groupId: gid, name: embeddedName };
          return { groupId: gid, name: serverName };
        }),
      );
      setJoinCode("");
      showToast("Joined team. Syncing calendar…", "success");
      return true;
    } catch (err) {
      const msg = extractErrorMessage(
        err,
        "Could not join. Check the invitation code.",
      );
      setJoinError(msg);
      showToast(msg);
      return false;
    } finally {
      setJoining(false);
    }
  }

  // Open a team's ONE shared calendar context. If a context already exists under
  // the team, join + open it; otherwise create exactly one (subgroup → open
  // visibility → context with empty init params, since the calendar contract's
  // init() takes no args).
  // ── An invitation link opened this app ──────────────────────────────────────
  //
  // Fill the join field and try it once, so a shared link actually joins the
  // team instead of landing the recipient here with the token stuck in the
  // address bar (which is what happened before capture existed).
  //
  // The intent is acked ONLY on a successful join. A failure leaves it in the
  // durable store, so a transient one (node still starting, no online member)
  // is retried on the next load rather than lost — no need to guess which error
  // messages are permanent. `attemptedInvites` stops it retrying in a loop
  // within this session; the token stays in the field for a manual retry.
  const attemptedInvites = useRef<Set<string>>(new Set());
  useEffect(
    () =>
      onInvitation(({ token, resolve }) => {
        setJoinCode(token);
        if (attemptedInvites.current.has(token)) return;
        attemptedInvites.current.add(token);
        void joinTeam(token).then((joined) => {
          if (joined) resolve();
        });
      }),
    // joinTeam is re-created every render but only reads `joinCode` when no
    // token is passed, and we always pass one — so the captured closure is safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  async function openTeam(teamId: string) {
    setMenuOpenId(null);
    setOpening(teamId);
    try {
      const appId = await ensureAppId();
      const name = teamLabel(teamId, "");

      // 1) Look for an existing calendar context in any of the team's subgroups.
      let contextId = "";
      try {
        const raw = await adminGet<
          { subgroups?: SubgroupRaw[]; data?: SubgroupRaw[] } | SubgroupRaw[]
        >(`/groups/${teamId}/subgroups`);
        const subgroups: SubgroupRaw[] = Array.isArray(raw)
          ? raw
          : (raw as { subgroups?: SubgroupRaw[] }).subgroups ??
            (raw as { data?: SubgroupRaw[] }).data ??
            [];
        for (const sg of subgroups) {
          const sgId = sg.groupId ?? sg.group_id ?? sg.id ?? "";
          if (!sgId) continue;
          const ctxRaw = await adminGet<
            { contexts?: ContextRaw[]; items?: ContextRaw[] } | ContextRaw[]
          >(`/groups/${sgId}/contexts`);
          const ctxs: ContextRaw[] = Array.isArray(ctxRaw)
            ? ctxRaw
            : (ctxRaw as { contexts?: ContextRaw[] }).contexts ??
              (ctxRaw as { items?: ContextRaw[] }).items ??
              [];
          if (ctxs.length > 0) {
            const c = ctxs[0];
            contextId = c.contextId ?? c.context_id ?? c.id ?? "";
            if (contextId) break;
          }
        }
      } catch {
        /* no subgroups/contexts yet — fall through to create */
      }

      // 2) Create the single calendar context if none exists.
      if (!contextId) {
        if (!appId) {
          showToast("Select or install the Mero Calendar application first.");
          return;
        }
        const sgData = await adminPost<{
          groupId?: string;
          group_id?: string;
          id?: string;
        }>(`/namespaces/${teamId}/groups`, {
          groupAlias: name,
          groupName: name,
        });
        const subgroupId = sgData.groupId ?? sgData.group_id ?? sgData.id ?? "";
        if (subgroupId) {
          await adminPut(`/groups/${subgroupId}/settings/subgroup-visibility`, {
            subgroupVisibility: "open",
          }).catch(() => {});
        }
        // The calendar contract's init() takes no args → empty init params.
        const ctxData = await adminPost<{ contextId?: string; id?: string }>(
          "/contexts",
          {
            applicationId: appId,
            protocol: "near",
            groupId: subgroupId || teamId,
            alias: name,
            name,
            initializationParams: [],
          },
        );
        contextId = ctxData.contextId ?? ctxData.id ?? "";
      }

      if (!contextId) throw new Error("Could not open the team calendar.");

      // 3) Ensure this node has joined the context (idempotent), then navigate.
      await joinContext(contextId).catch(() => {});
      navigate(`/teams/${teamId}/calendar/${contextId}`);
    } catch (err) {
      showToast(humanizeError(extractErrorMessage(err, "Could not open team.")));
    } finally {
      setOpening(null);
    }
  }

  async function generateInvite(teamId: string) {
    setMenuOpenId(null);
    try {
      const data = await adminPost<Record<string, unknown>>(
        `/namespaces/${teamId}/invite`,
        {},
      );
      const teamName = getStoredTeamName(teamId);
      const payload = teamName ? { ...data, __teamName: teamName } : data;
      const code = encodeInvitationObject(payload);
      setInviteFor({ id: teamId, code });
    } catch (err) {
      showToast(
        extractErrorMessage(err, "Failed to generate invitation."),
      );
    }
  }

  async function copyInvite() {
    if (!inviteFor) return;
    // Share the canonical link, not the bare token: it opens the desktop app
    // where installed and the web build otherwise.
    await navigator.clipboard.writeText(invitationLink(inviteFor.code));
    showToast("Invitation link copied to clipboard.", "success");
  }

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <span className={styles.logo}>
          <CalendarLogo size={24} color="var(--accent)" /> Mero Calendar
        </span>
        <div className={styles.headerRight}>
          <ThemeToggle />
          <button className="mc-btn mc-btn--ghost" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </header>

      <main className={styles.main}>
        <h1 className={styles.title}>Your Teams</h1>
        <p className={styles.subtitle}>Teams are shared calendars.</p>

        <div className={styles.createRow}>
          <input
            className={`mc-input ${styles.createInput}`}
            placeholder="New team name…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createTeam()}
            data-testid="new-team-input"
          />
          <button
            className="mc-btn mc-btn--primary"
            onClick={createTeam}
            disabled={creating || !newName.trim()}
            data-testid="create-team-btn"
          >
            {creating ? "Creating…" : "Create team"}
          </button>
        </div>

        {loading ? (
          <p className={styles.empty}>Loading…</p>
        ) : teams.length === 0 ? (
          <p className={styles.empty} data-testid="empty-teams">
            No teams yet. Create one above.
          </p>
        ) : (
          <div className={styles.grid}>
            {teams.map((t) => (
              <div
                key={t.groupId}
                className={styles.cardWrap}
                ref={menuOpenId === t.groupId ? menuRef : null}
              >
                <button
                  className={styles.card}
                  onClick={() => openTeam(t.groupId)}
                  disabled={opening === t.groupId}
                  data-testid={`team-card-${t.groupId}`}
                >
                  <span className={styles.cardIcon}>
                    <CalendarLogo size={20} color="var(--accent)" />
                  </span>
                  <span className={styles.cardName}>
                    {teamLabel(t.groupId, t.name)}
                  </span>
                  <span className={styles.cardSub}>
                    {opening === t.groupId ? "Opening calendar…" : "Shared calendar"}
                  </span>
                </button>
                <button
                  className={styles.menuBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpenId(menuOpenId === t.groupId ? null : t.groupId);
                  }}
                  title="More options"
                  data-testid={`team-menu-${t.groupId}`}
                >
                  ⋯
                </button>
                {menuOpenId === t.groupId && (
                  <div className={styles.dropdown}>
                    <button
                      className={styles.dropdownItem}
                      onClick={() => openTeam(t.groupId)}
                    >
                      Open calendar
                    </button>
                    <button
                      className={styles.dropdownItem}
                      onClick={() => generateInvite(t.groupId)}
                    >
                      Invite
                    </button>
                    <button
                      className={`${styles.dropdownItem} ${styles.dropdownDanger}`}
                      onClick={() => deleteTeam(t.groupId)}
                    >
                      Delete
                    </button>
                  </div>
                )}
                {inviteFor?.id === t.groupId && (
                  <div className={styles.inviteBox}>
                    <code className={styles.inviteCode} title={inviteFor.code}>
                      {inviteFor.code.slice(0, 18)}…{inviteFor.code.slice(-8)}
                    </code>
                    <button
                      className="mc-btn"
                      onClick={copyInvite}
                      data-testid="copy-invite"
                    >
                      Copy
                    </button>
                    <button
                      className="mc-btn mc-btn--ghost"
                      onClick={() => setInviteFor(null)}
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className={styles.joinSection}>
          <p className={styles.joinLabel}>Got an invitation? Join a team.</p>
          <div className={styles.joinRow}>
            <input
              className={`mc-input ${styles.createInput}`}
              placeholder="Paste invitation code…"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void joinTeam(); }}
              data-testid="join-code-input"
            />
            <button
              className="mc-btn"
              onClick={() => void joinTeam()}
              disabled={joining || !joinCode.trim()}
              data-testid="join-team-btn"
            >
              {joining ? "Joining…" : "Join"}
            </button>
          </div>
          {joinError && <p className={styles.joinError}>{joinError}</p>}
        </div>
      </main>
    </div>
  );
}
