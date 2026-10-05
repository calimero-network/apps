import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  describeInviteFailure,
  InviteStatusBanner,
  redeemInvitation,
  useInviteRedemption,
} from "@calimero-apps/invite";
import { markNamespaceJustJoined } from "@calimero-apps/join-sync";
import { useMero } from "@calimero-network/mero-react";
import type { SignedGroupOpenInvitation } from "@calimero-network/mero-js";
import { listNamespaces } from "../../api/admin";
import { useEnsureAppId } from "../../hooks/useEnsureAppId";
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

export default function TeamsPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  // `admin`, NOT `mero.admin`. `mero` is the raw client, and on a delegated
  // (account) session its transport is the relay: `mero.admin.createNamespace`
  // is `POST {relay}/admin-api/namespaces` under the account's bearer token,
  // which carries no `namespace:manage` — a 403. `admin` is the session-aware
  // one: the node's own client on a node login, and on an account the account
  // admin, which founds through the relay, signs invitations as the account
  // and redeems them through the admitter's route.
  const { admin, isDelegated, logout } = useMero();
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState("");
  const [inviteFor, setInviteFor] = useState<{ id: string; code: string } | null>(
    null,
  );
  const menuRef = useRef<HTMLDivElement>(null);

  // Mero Calendar's own application id (see hooks/useEnsureAppId).
  const ensureAppId = useEnsureAppId();

  /** The session-aware admin, or a clear refusal before anything is sent. */
  const requireAdmin = useCallback(() => {
    if (!admin) throw new Error("Not connected.");
    return admin;
  }, [admin]);

  useEffect(() => {
    if (!admin) return;
    let cancelled = false;
    async function loadTeams() {
      const appId = await ensureAppId();
      listNamespaces(requireAdmin(), appId)
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
  }, [admin, ensureAppId, requireAdmin]);

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
      // Body is EXACTLY `applicationId` + `name`: `CreateNamespaceApiRequest`
      // is `deny_unknown_fields`, so an extra key is a 400 for the whole
      // create. On an account the same call founds through the relay with the
      // provider's package, and comes back with `haEnabled`/`haError` on top.
      const data = (await requireAdmin().createNamespace({
        applicationId: await ensureAppId(),
        name,
      })) as {
        namespaceId?: string;
        groupId?: string;
        id?: string;
        haEnabled?: boolean;
        haError?: string;
      };
      const id = data.namespaceId ?? data.groupId ?? data.id ?? "";
      if (id) setStoredTeamName(id, name);
      setTeams((prev) => [...prev, { groupId: id, name }]);
      setNewName("");
      // The team exists either way; only hosting was refused. Said now, where
      // it can be acted on, rather than at the first invite, where it would
      // read as a broken link.
      if (data.haError) {
        showToast(
          `Team created, but invitations will not work yet: ${data.haError}.`,
        );
      }
    } catch (err) {
      showToast(extractErrorMessage(err, "Could not create team."));
    } finally {
      setCreating(false);
    }
  }

  /** Node-only: the account admin refuses it, so the control is hidden there. */
  async function deleteTeam(teamId: string) {
    setMenuOpenId(null);
    try {
      await requireAdmin().deleteNamespace(teamId);
    } catch {
      /* best-effort */
    }
    setTeams((prev) => prev.filter((t) => t.groupId !== teamId));
  }

  /** Read a raw invitation token into the parts the join needs. */
  const parseInvitation = useCallback((raw: string) => {
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
    if (!namespaceId) return null;

    const teamName =
      typeof invObj.__teamName === "string" ? invObj.__teamName.trim() : "";
    if (teamName) setStoredTeamName(namespaceId, teamName);

    return { namespaceId, invitation: outer, teamName: teamName || undefined };
  }, []);

  /** The two calls @calimero-apps/invite needs from this app. */
  const redeemer = useMemo(
    () => ({
      // Through `admin`: on an account, `joinNamespace` redeems the invitation
      // via the admitter's unauthenticated route and moves the session onto
      // that relay. `join` has to THROW on refusal — the redeemer reads the
      // outcome off the error — so no catch here.
      join: async (namespaceId: string, invitation: unknown) => {
        await requireAdmin().joinNamespace(namespaceId, {
          invitation: invitation as SignedGroupOpenInvitation,
        });
      },
      memberships: async () => {
        const items = await listNamespaces(requireAdmin(), await ensureAppId());
        return (Array.isArray(items) ? items : []).map(
          (n: NamespaceRaw) => n.namespaceId ?? n.groupId ?? n.id ?? "",
        );
      },
    }),
    [ensureAppId, requireAdmin],
  );

  const refreshTeams = useCallback(async () => {
    const items = await listNamespaces(requireAdmin(), await ensureAppId()).catch(
      () => null,
    );
    if (!Array.isArray(items)) return;
    setTeams(
      items.map((n: NamespaceRaw) => ({
        groupId: n.namespaceId ?? n.groupId ?? n.id ?? "",
        name: (n.alias ?? n.name ?? "").trim(),
      })),
    );
  }, [ensureAppId, requireAdmin]);

  // ── An invitation link opened this app ──────────────────────────────────────
  //
  // Capture, redemption and the attempt cap all live in @calimero-apps/invite;
  // this page supplies the codec and the two calls, and renders the result.
  const invite = useInviteRedemption({
    parse: parseInvitation,
    redeemer,
    onJoined: (namespaceId) => {
      setJoinCode("");
      void refreshTeams();
      navigate(`/teams/${namespaceId}`);
    },
  });

  // Keep the manual field in step, so a link that could not be joined
  // automatically is one click away rather than lost.
  useEffect(() => {
    if (invite.token) setJoinCode(invite.token);
  }, [invite.token]);

  /** The manual "paste a code and press Join" path. */
  async function joinTeam(codeOverride?: string): Promise<boolean> {
    const raw = invitationTokenFrom(codeOverride ?? joinCode);
    if (!raw) return false;
    setJoining(true);
    setJoinError("");
    try {
      const parsed = parseInvitation(raw);
      if (!parsed) throw new Error("no namespace id in invitation");

      const outcome = await redeemInvitation(parsed, redeemer);
      if (outcome.status === "failed") {
        throw new Error(
          describeInviteFailure(outcome.reason, "team") ?? outcome.message,
        );
      }

      markNamespaceJustJoined(outcome.namespaceId);
      await refreshTeams();
      setJoinCode("");
      showToast(
        outcome.status === "already-member"
          ? "You are already in this team."
          : "Joined team. Syncing calendar…",
        "success",
      );
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


  /**
   * Open a team by showing its calendars, not by guessing one.
   *
   * This used to walk the team's subgroups, take `contexts[0]`, and create a
   * context when it found none — so a team with two calendars could only ever
   * open the first, and a mistakenly created one had nowhere to be deleted
   * from. Navigation is now unconditional and the picker owns both.
   */
  function openTeam(teamId: string) {
    setMenuOpenId(null);
    navigate(`/teams/${teamId}`);
  }

  async function generateInvite(teamId: string) {
    setMenuOpenId(null);
    try {
      // `{ invitation, groupName? }` — the same envelope the node route
      // returned, so the code a node mints and the one an account mints decode
      // identically in `parseInvitation`. On an account the invitation is
      // signed by the account itself.
      const data = (await requireAdmin().createNamespaceInvitation(
        teamId,
      )) as unknown as Record<string, unknown>;
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
    navigate("/");
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

        {/* Following an invite link used to land here with nothing on screen
            for as long as the join took. */}
        <InviteStatusBanner
          state={invite.state}
          noun="team"
          onRetry={invite.retry}
          onDismiss={invite.dismiss}
          style={{ marginBottom: "1rem" }}
        />
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
                  data-testid={`team-card-${t.groupId}`}
                >
                  <span className={styles.cardIcon}>
                    <CalendarLogo size={20} color="var(--accent)" />
                  </span>
                  <span className={styles.cardName}>
                    {teamLabel(t.groupId, t.name)}
                  </span>
                  <span className={styles.cardSub}>Shared calendars</span>
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
                    {/* Deleting a namespace is a node's own operation; the
                        account admin refuses it by name, so an account is
                        not offered it. */}
                    {!isDelegated && (
                      <button
                        className={`${styles.dropdownItem} ${styles.dropdownDanger}`}
                        onClick={() => deleteTeam(t.groupId)}
                        data-testid={`delete-team-${t.groupId}`}
                      >
                        Delete
                      </button>
                    )}
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
