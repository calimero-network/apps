import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMero } from "@calimero-network/mero-react";
import {
  createContext,
  createNamespaceInvitation,
  createSubgroup,
  deleteContext,
  listGroupContexts,
  listSubgroups,
  setSubgroupVisibility,
} from "../api/rpc";
import { useApplicationId } from "../hooks/useApplicationId";
import Logo from "../components/Logo";
import SettingsModal from "../components/SettingsModal";
import ProjectThumbnail from "../components/ProjectThumbnail";
import { useToast } from "../contexts/ToastContext";
import { extractErrorMessage, humanizeError } from "../utils/errorMessage";
import { encodeInvitationObject, invitationLink } from "../utils/invitation";
import { truncateMiddle } from "../utils/format";
import { getStoredTeamName, teamLabel } from "../utils/teamName";
import type { Project } from "../types";
import ThemeToggle from "../components/ThemeToggle";
import { EmptyBoardsArt, InviteArt } from "../components/Artwork";
import { IconBack, IconPlus } from "../components/HomeIcons";
import styles from "./Home.module.css";

type Tab = "projects" | "invitations";

export default function ProjectsPage() {
  const { teamId } = useParams<{ teamId: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { logout, isDelegated } = useMero();

  const [tab, setTab] = useState<Tab>("projects");
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [settingsProject, setSettingsProject] = useState<Project | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Invitation state
  const [invitation, setInvitation] = useState("");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteCopying, setInviteCopying] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const inviteResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // MeroDesign's own application id — see hooks/useApplicationId. The desktop
  // deep-links straight to this page (bypassing TeamsPage), so this page
  // resolves it for itself too.
  const ensureAppId = useApplicationId();

  function handleLogout() {
    logout();
    navigate("/");
  }

  useEffect(() => {
    if (!teamId) return;
    async function loadProjects() {
      try {
        const subgroups = await listSubgroups(teamId!);

        const resolved: Project[] = [];
        for (const sg of subgroups) {
          const sgId = sg.groupId;
          const sgName = sg.name ?? sgId.slice(0, 8);
          try {
            const ctxs = await listGroupContexts(sgId);
            if (ctxs.length > 0) {
              const ctx = ctxs[0];
              resolved.push({
                contextId: ctx.contextId || sgId,
                groupId: sgId,
                name: ctx.name ?? sgName,
                description: "",
                isPublic: true,
              });
            }
          } catch {
            // no context yet
          }
        }
        setProjects(resolved);
      } catch {
        setProjects([]);
      } finally {
        setLoading(false);
      }
    }
    loadProjects();
    const id = setInterval(loadProjects, 30_000);
    return () => clearInterval(id);
  }, [teamId]);

  // Close menu on outside click
  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  // Clear any pending invitation-reset timer on unmount.
  useEffect(() => () => {
    if (inviteResetRef.current) clearTimeout(inviteResetRef.current);
  }, []);

  async function createProject() {
    if (!newName.trim() || !teamId) return;
    setCreating(true);
    try {
      // Resolve the app id up front. Never POST an empty one — the node rejects
      // it ("applicationId: invalid length 0" — the node said "base58 encoded
      // hash" before rc.27; it is hex now, but an empty id is rejected either way).
      const appId = await ensureAppId();
      if (!appId) {
        showToast("Select or install the Mero Design application first.");
        return;
      }

      // A project is a subgroup of the team with one context (the board) in it.
      const subgroupId = await createSubgroup(teamId, newName.trim());

      if (subgroupId) {
        await setSubgroupVisibility(subgroupId, "open").catch(() => {});
      }

      const initJson = JSON.stringify({ name: newName.trim(), description: "" });
      const initBytes = Array.from(new TextEncoder().encode(initJson));

      const id = await createContext({
        applicationId: appId,
        groupId: subgroupId || teamId,
        name: newName.trim(),
        initializationParams: initBytes,
      });
      // Store the same group the context was created under (`subgroupId || teamId`).
      // If the subgroup create returned no id, an empty groupId would make Settings
      // fall back to the contextId for `/groups/{id}/members`, which the admin
      // API rejects.
      setProjects((prev) => [
        ...prev,
        { contextId: id, groupId: subgroupId || teamId, name: newName.trim(), description: "", isPublic: true },
      ]);
      setNewName("");
    } catch (err) {
      // Surface node rejections (e.g. the namespace-admin gate on subgroup
      // creation) instead of failing silently in the network console.
      showToast(humanizeError(extractErrorMessage(err, "Could not create project.")));
    } finally {
      setCreating(false);
    }
  }

  async function deleteProject(contextId: string) {
    setMenuOpenId(null);
    try {
      await deleteContext(contextId);
    } catch (err) {
      // Keep the card: dropping it on a refusal (e.g. a token without
      // `context:delete` answering 403) hid the failure until the next reload
      // brought the project back.
      showToast(extractErrorMessage(err, "Could not delete project."));
      return;
    }
    setProjects((prev) => prev.filter((p) => p.contextId !== contextId));
  }

  async function generateInvite() {
    if (!teamId) return;
    setInviteError("");
    setInviteLoading(true);
    try {
      const data = await createNamespaceInvitation(teamId);
      if (data) {
        // Embed the team's human name so the joiner doesn't see a raw ID before
        // the namespace metadata syncs. `__teamName` is a sibling of the signed
        // invitation, so the existing decode path (invObj.invitation) is unchanged.
        const teamName = getStoredTeamName(teamId);
        const payload = teamName ? { ...data, __teamName: teamName } : data;
        setInvitation(encodeInvitationObject(payload));
      }
    } catch (err) {
      const msg = extractErrorMessage(err, "Failed to generate invitation. Check node connection.");
      setInviteError(msg);
      showToast(msg);
    } finally {
      setInviteLoading(false);
    }
  }

  async function copyInvite() {
    if (!invitation || inviteCopying) return;
    // Share the canonical link, not the bare token: it opens the desktop app
    // where installed and the published web build otherwise.
    await navigator.clipboard.writeText(invitationLink(invitation));
    showToast("Invitation link copied to clipboard.", "success");
    // Show a brief loader, then reset back to the "Generate invitation" state so
    // each share starts from a fresh, single-use invitation.
    setInviteCopying(true);
    if (inviteResetRef.current) clearTimeout(inviteResetRef.current);
    inviteResetRef.current = setTimeout(() => {
      setInviteCopying(false);
      setInvitation("");
    }, 5000);
  }

  const teamName = teamId ? teamLabel(teamId) : "Team";

  const createField = (
    <div className={styles.field}>
      <input
        className={styles.input}
        placeholder="New project name…"
        aria-label="New project name"
        value={newName}
        onChange={(e) => setNewName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && createProject()}
        data-testid="new-project-input"
      />
      <button
        className={styles.btn}
        onClick={createProject}
        disabled={creating}
        data-testid="create-project-btn"
      >
        Create
      </button>
    </div>
  );

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => navigate("/teams")}><IconBack /> Teams</button>
        <span className={styles.brand}><Logo size={30} /> <span className={styles.brandText}>Mero Design</span></span>
        <span className={styles.crumbSep} aria-hidden="true">/</span>
        <span className={styles.crumb} title={teamName}>{teamName}</span>
        <div className={styles.headerRight}>
          <ThemeToggle className={styles.iconBtn} />
          <button className={styles.logoutBtn} onClick={handleLogout}>Logout</button>
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>Team</p>
            <h1 className={styles.title}>{teamName}</h1>
            <p className={styles.subtitle}>
              Every project is a shared design board. Open one to draw, comment and present together in real time.
            </p>
          </div>
          <div className={styles.tabs}>
            <button
              className={`${styles.tab} ${tab === "projects" ? styles.tabActive : ""}`}
              aria-pressed={tab === "projects"}
              onClick={() => setTab("projects")}
            >Projects</button>
            <button
              className={`${styles.tab} ${tab === "invitations" ? styles.tabActive : ""}`}
              aria-pressed={tab === "invitations"}
              onClick={() => setTab("invitations")}
            >Invitations</button>
          </div>
        </div>

        {tab === "projects" && (
          loading ? (
            <div className={styles.grid} aria-busy="true" aria-label="Loading">
              {[0, 1, 2].map((i) => <div key={i} className={styles.skeleton} />)}
            </div>
          ) : projects.length === 0 ? (
            <section className={`${styles.panel} ${styles.empty}`} data-testid="empty-projects">
              <EmptyBoardsArt />
              <h2 className={styles.emptyTitle}>No projects yet</h2>
              <p className={styles.emptyText}>
                Create one to get a fresh board. Everyone in {teamName} can open it and draw along.
              </p>
              <div className={styles.emptyField}>{createField}</div>
            </section>
          ) : (
            <>
              <div className={styles.actions}>
                <section className={`${styles.panel} ${styles.actionCard}`}>
                  <div className={styles.actionHead}>
                    <span className={styles.actionIcon} aria-hidden="true"><IconPlus /></span>
                    <span>
                      <span className={styles.actionTitle}>New project</span>
                      <span className={styles.actionHint}>A blank board, shared with the whole team.</span>
                    </span>
                  </div>
                  {createField}
                </section>
              </div>

              <div className={styles.sectionHead}>
                <h2 className={styles.sectionTitle}>Boards</h2>
                <span className={styles.count}>{projects.length}</span>
              </div>
              <div className={styles.grid}>
                {projects.map((p) => {
                  const name = p.name || p.contextId.slice(0, 8);
                  const open = menuOpenId === p.contextId;
                  return (
                    <div
                      key={p.contextId}
                      className={`${styles.cardWrap} ${open ? styles.cardWrapOpen : ""}`}
                      ref={open ? menuRef : null}
                    >
                      <button
                        className={styles.card}
                        data-testid={`project-card-${p.contextId}`}
                        onClick={() => navigate(`/teams/${teamId}/projects/${p.contextId}`)}
                      >
                        <ProjectThumbnail contextId={p.contextId} name={name} className={styles.cardThumb} />
                        <span className={styles.cardBody}>
                          <span className={styles.cardName}>{name}</span>
                          <span className={styles.cardMeta}>
                            Design board <span className={styles.metaDot} aria-hidden="true" />
                            <span className={styles.metaId}>{truncateMiddle(p.contextId, 6, 4)}</span>
                          </span>
                        </span>
                      </button>
                      <button
                        className={styles.menuBtn}
                        onClick={(e) => { e.stopPropagation(); setMenuOpenId(open ? null : p.contextId); }}
                        title="More options"
                      >⋯</button>
                      {open && (
                        <div className={styles.dropdown}>
                          <button className={styles.dropdownItem} data-testid={`project-settings-${p.contextId}`} onClick={() => { setMenuOpenId(null); setSettingsProject(p); }}>
                            Settings
                          </button>
                          {/* Deleting a context is a node's own operation; an
                              account's relay has no form of it. */}
                          {!isDelegated && (
                            <button className={`${styles.dropdownItem} ${styles.dropdownDanger}`} data-testid={`project-delete-${p.contextId}`} onClick={() => deleteProject(p.contextId)}>
                              Delete
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )
        )}

        {tab === "invitations" && (
          <section className={`${styles.panel} ${styles.invite}`}>
            <InviteArt />
            <div className={styles.inviteBody}>
              <h2 className={styles.inviteTitle}>Invite people to {teamName}</h2>
              <p className={styles.inviteDesc}>
                Generate an invitation link and share it with teammates. Opening it launches
                the desktop app where installed, and the web build otherwise, and asks
                them to join.
              </p>
              <ol className={styles.inviteSteps}>
                <li><b>1</b> Generate</li>
                <li><b>2</b> Copy the link</li>
                <li><b>3</b> Send it to a teammate</li>
              </ol>
              {invitation ? (
                inviteCopying ? (
                  <div className={styles.tokenBox} data-testid="invite-copying">
                    <span className={styles.inviteSpinner} aria-hidden="true" />
                    <span className={styles.copiedMsg}>Copied! Resetting invitation…</span>
                  </div>
                ) : (
                  <div className={styles.tokenBox}>
                    <code
                      className={styles.token}
                      data-testid="invite-token"
                      title={invitationLink(invitation)}
                    >
                      {truncateMiddle(invitationLink(invitation), 28, 10)}
                    </code>
                    <button className={styles.copyBtn} onClick={copyInvite} data-testid="copy-invite">
                      Copy
                    </button>
                  </div>
                )
              ) : (
                <button
                  className={`${styles.btn} ${styles.btnLg}`}
                  onClick={generateInvite}
                  disabled={inviteLoading}
                  data-testid="generate-invite"
                >
                  {inviteLoading ? "Generating…" : "Generate invitation"}
                </button>
              )}
              {inviteError && <p className={styles.errorText}>{inviteError}</p>}
            </div>
          </section>
        )}
      </main>

      {settingsProject && (
        <SettingsModal
          type="project"
          id={settingsProject.contextId}
          groupId={settingsProject.groupId}
          name={settingsProject.name || settingsProject.contextId.slice(0, 8)}
          onClose={() => setSettingsProject(null)}
        />
      )}
    </div>
  );
}
