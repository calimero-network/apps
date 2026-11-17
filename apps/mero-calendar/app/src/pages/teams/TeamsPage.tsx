import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { appInviteTeams, appOnlyInviteNote, otherOrgs, type OtherOrg } from "@calimero-apps/connect";
import { CreateWorkspaceDialog, InviteDialog } from "@calimero-network/mero-react";
import { ConnectExistingOrg, reviewRelease, useResolvedSource } from "@calimero-apps/passkey";
import { lastUsedName } from "@calimero-apps/names";
import { messageOf, PACKAGE } from "../../api/calendar";
import { StayedInApp } from "../../api/consent";
import { useSignedIn } from "../../api/sessionContext";
import {
  CONNECTED_CALENDAR_NAME,
  createCalendar,
  deleteTeam as deleteOrgTeam,
  finishTeam,
  inviteLinkBase,
  leaveTeam as leaveOrgTeam,
  leaveTeamOrg,
  PRODUCT_NAME,
  listTeams,
  ownsTeam,
  setMyTeamName,
  type Team,
} from "../../api/teams";
import CalendarLogo from "../../components/common/logo/CalendarLogo";
import { InstallAppIconButton } from "@calimero-apps/install";
import ThemeToggle from "../../components/common/theme-toggle/ThemeToggle";
import LogoutButton from "../../components/common/logout-button/LogoutButton";
import { useToast } from "../../contexts/ToastContext";
import { setStoredTeamName, teamLabel } from "../../utils/teamName";
import {
  forgetTeam,
  pickRemembered,
  readLastVisit,
  shouldResume,
} from "../../utils/lastVisit";
import { visibleInterval } from "../../utils/visibleInterval";
import styles from "./teams.module.scss";

const CREATE_LABELS = {
  title: "New team",
  subtitle: "Name your team. Its members share its calendars.",
  nameLabel: "Team name",
  namePlaceholder: "e.g. Design",
  selfLabel: "Your name in this team",
  selfPlaceholder: "e.g. Ada",
};

const INVITE_LABELS = {
  noun: "team",
  title: "Invite to this team",
  subtitle: "Choose what the people you invite can do in this team.",
};

/**
 * The teams this account is in: Calimero organizations (v1: namespaces of
 * this app). Orgs are the platform's teams, so one made in another Calimero
 * 1.0 app is listed too and can hold calendars.
 */
export default function TeamsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();
  const { client, accountId, source, passkey, after, targetKey } = useSignedIn();
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  // The cluster has answered the list (empty or not). A failed read has not, and
  // must not forget a team it simply could not see.
  const [listed, setListed] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const { source: release, pending: releasePending } = useResolvedSource(client, accountId, source);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [inviteFor, setInviteFor] = useState<{ org: string; teams: string[]; appOnly: boolean } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Mounted once a team exists, so a full-page approval finishes here on return.
  const inviteOrg = inviteFor?.org ?? teams[0]?.groupId;

  const loadTeams = useCallback(async () => {
    try {
      setTeams(await listTeams(client, source));
      setListed(true);
    } catch {
      /* the last answer stays; the next poll, or coming back to the tab, tries again */
    } finally {
      setLoading(false);
      after();
    }
  }, [client, source, after]);

  useEffect(() => {
    void loadTeams();
    return visibleInterval(() => void loadTeams(), 30_000);
  }, [loadTeams]);

  // Resume the team open last (utils/lastVisit) when this is the default
  // landing, not a visit you chose, and the cluster still lists it. Anything
  // else settles here: a remembered team no longer listed is forgotten, and
  // the entry is replaced so Back or a reload to it is a plain visit to the list.
  const resume = shouldResume(location);
  const remembered = readLastVisit(targetKey).team;
  const resumeTo =
    resume && listed
      ? pickRemembered(
          teams.map((t) => t.groupId),
          remembered,
        )
      : null;
  useEffect(() => {
    if (!resume || loading || resumeTo) return;
    if (listed && remembered) forgetTeam(targetKey, remembered);
    navigate(location.pathname + location.search, {
      replace: true,
      state: null,
    });
  }, [
    resume,
    loading,
    listed,
    resumeTo,
    remembered,
    targetKey,
    navigate,
    location.pathname,
    location.search,
  ]);

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

  // "Connect to an existing organization": this app goes into an org the
  // account has for another app only on this explicit choice.
  const loadOtherOrgs = useCallback(async () => {
    try {
      return await otherOrgs(client, source);
    } finally {
      after();
    }
  }, [client, source, after]);
  const connectOrg = useCallback(
    async (org: OtherOrg) => {
      try {
        await createCalendar(client, source, org.orgId, CONNECTED_CALENDAR_NAME, passkey);
      } finally {
        after();
      }
      setStoredTeamName(org.orgId, org.name);
      navigate(`/teams/${org.orgId}`);
    },
    [client, source, passkey, after, navigate],
  );

  async function teamCreated({ orgId, name, selfName }: { orgId: string; name: string; selfName: string }) {
    setShowCreate(false);
    try {
      const { groupId, warning } = await finishTeam(client, orgId, passkey, source);
      setStoredTeamName(groupId, name);
      // Best effort: the team exists either way, and a calendar in it asks
      // once when the name is missing.
      await setMyTeamName(client, groupId, accountId, selfName).catch(() => {});
      setTeams((prev) => [...prev, { groupId, name, role: "owner" }]);
      if (warning) showToast(warning);
    } catch (err) {
      showToast(`Could not set up the team: ${messageOf(err)}`);
    } finally {
      after();
    }
  }

  /** The team's owner deletes it (a passkey step-up, on the node's consent page from the app's own address), with its calendars. */
  async function deleteTeam(teamId: string) {
    setMenuOpenId(null);
    try {
      await deleteOrgTeam(client, teamId, passkey);
    } catch (err) {
      if (!(err instanceof StayedInApp)) showToast(`Could not delete team: ${messageOf(err)}`);
      return;
    } finally {
      after();
    }
    setTeams((prev) => prev.filter((t) => t.groupId !== teamId));
    forgetTeam(targetKey, teamId);
  }

  /**
   * Anyone else leaves it (a passkey step-up). In an org that keeps its apps
   * apart that is Hyperfeed Calendar only; when it was the last app there, the
   * organization itself is offered too.
   */
  async function leaveTeam(teamId: string) {
    setMenuOpenId(null);
    try {
      const left = await leaveOrgTeam(client, teamId, source, passkey, accountId);
      if (
        left.left === "app" &&
        left.lastApp &&
        window.confirm(`${PRODUCT_NAME} was your last app in this organization. Leave the organization too?`)
      ) {
        await leaveTeamOrg(client, teamId, passkey, accountId);
      }
    } catch (err) {
      if (!(err instanceof StayedInApp)) showToast(`Could not leave team: ${messageOf(err)}`);
      return;
    } finally {
      after();
    }
    setTeams((prev) => prev.filter((t) => t.groupId !== teamId));
    forgetTeam(targetKey, teamId);
  }

  /** Open a team by showing its calendars. */
  function openTeam(teamId: string) {
    setMenuOpenId(null);
    navigate(`/teams/${teamId}`);
  }

  async function inviteTo(org: string) {
    setMenuOpenId(null);
    try {
      setInviteFor({ org, ...(await appInviteTeams(client, org, source)) });
    } catch (err) {
      showToast(`Failed to generate invitation: ${messageOf(err)}`);
    }
  }

  if (resumeTo) {
    return (
      <Navigate to={`/teams/${resumeTo}`} replace state={{ resume: true }} />
    );
  }

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <span className={styles.logo}>
          <CalendarLogo size={24} color="var(--accent)" /> Hyperfeed Calendar
        </span>
        <div className={styles.headerRight}>
          <InstallAppIconButton className="mc-theme-toggle" />
          <ThemeToggle />
          <LogoutButton />
        </div>
      </header>

      <main className={styles.main}>
        <h1 className={styles.title}>Your Teams</h1>

        <p className={styles.subtitle}>Teams are shared calendars.</p>

        <div className={styles.createRow}>
          <button
            className="mc-btn mc-btn--primary"
            onClick={() => setShowCreate(true)}
            data-testid="create-team-btn"
          >
            New team
          </button>
        </div>
        <CreateWorkspaceDialog
          client={client}
          passkey={passkey()}
          release={releasePending ? null : (reviewRelease(release) ?? { package: PACKAGE })}
          defaultSelfName={lastUsedName()}
          open={showCreate}
          onClose={() => setShowCreate(false)}
          onCreated={teamCreated}
          labels={CREATE_LABELS}
        />
        {inviteOrg && (
          <InviteDialog
            client={client}
            passkey={passkey()}
            open={inviteFor !== null}
            onClose={() => setInviteFor(null)}
            org={inviteOrg}
            teams={inviteFor?.teams}
            appName={PRODUCT_NAME}
            labels={inviteFor?.appOnly ? { ...INVITE_LABELS, note: appOnlyInviteNote(PRODUCT_NAME) } : INVITE_LABELS}
            linkBase={inviteFor ? inviteLinkBase(inviteFor.org, { href: new URL(appRoot(), window.location.origin).href }) : undefined}
          />
        )}
        <ConnectExistingOrg appName="Hyperfeed Calendar" load={loadOtherOrgs} onConnect={connectOrg} />

        {loading ? (
          <p className={styles.empty}>Loading…</p>
        ) : teams.length === 0 ? (
          <p className={styles.empty} data-testid="empty-teams">
            No teams yet. Create one above, or open an invitation link someone
            sent you.
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
                      onClick={() => void inviteTo(t.groupId)}
                    >
                      Invite
                    </button>
                    {/* The owner deletes, anyone else leaves. */}
                    {ownsTeam(t.role) && (
                      <button
                        className={`${styles.dropdownItem} ${styles.dropdownDanger}`}
                        onClick={() => deleteTeam(t.groupId)}
                        data-testid={`delete-team-${t.groupId}`}
                      >
                        Delete
                      </button>
                    )}
                    {!ownsTeam(t.role) && (
                      <button
                        className={`${styles.dropdownItem} ${styles.dropdownDanger}`}
                        onClick={() => leaveTeam(t.groupId)}
                        data-testid={`leave-team-${t.groupId}`}
                      >
                        Leave
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

      </main>
    </div>
  );
}

/** Where this frontend's routes start: the page's path up to `/teams`. */
function appRoot(): string {
  const { pathname } = window.location;
  const at = pathname.indexOf("/teams");
  return at >= 0 ? pathname.slice(0, at) || "/" : "/";
}
