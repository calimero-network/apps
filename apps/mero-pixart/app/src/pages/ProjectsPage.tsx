import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useApi } from "../api/useApi";
import { messageOf } from "../api/pixart";
import { useSignedIn } from "../api/sessionContext";
import { askAnOwnerCopy, canCreateIn } from "@calimero-apps/connect";
import { appOnlyInviteNote } from "@calimero-apps/connect";
import { PRODUCT_NAME, createProject as createInstance, inviteLink, inviteToken, isAdmin, listProjects } from "../api/teams";
import { useTeam } from "../api/useTeam";
import Logo from "../components/Logo";
import SettingsModal from "../components/SettingsModal";
import { useToast } from "../contexts/ToastContext";
import { truncateMiddle } from "../utils/format";
import { teamLabel } from "../utils/teamName";
import { clearLastVisit, forgetProject, pickRemembered, readLastVisit, rememberTeam, resumeRequested } from "../utils/lastVisit";
import { SHOWCASE_PROJECTS } from "../showcase";
import type { Project, DocumentInfo } from "../types";
import styles from "./ProjectsPage.module.css";

type Tab = "projects" | "invitations";

// Canvas dimension presets offered in the New Project modal.
const DIMENSION_PRESETS: { label: string; width: number; height: number }[] = [
  { label: "1920 × 1080 · Full HD", width: 1920, height: 1080 },
  { label: "1280 × 720 · HD",       width: 1280, height: 720 },
  { label: "1080 × 1080 · Square",  width: 1080, height: 1080 },
  { label: "800 × 600",             width: 800, height: 600 },
];
const DEFAULT_PRESET = 1; // 1280 × 720

// A project (an app instance in the team's org) enriched with the document
// metadata read from the contract. Best-effort: a read that fails leaves these
// undefined and the card shows placeholders.
interface ProjectCard extends Project {
  width?: number;
  height?: number;
  memberCount?: number;
  /** This account created the project, or is an owner or admin of the team. */
  canDelete?: boolean;
}

export default function ProjectsPage() {
  const { teamId } = useParams<{ teamId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();
  const { client, accountId, passkey, after, source, targetKey, signOut } = useSignedIn();
  const api = useApi();
  const team = useTeam(teamId);
  const teamTitle = teamId ? teamLabel(teamId, team.name) : "Team";
  const myTeamRole = team.roles.get(accountId);

  const [tab, setTab] = useState<Tab>("projects");
  const [projects, setProjects] = useState<ProjectCard[]>([]);
  const [loading, setLoading] = useState(true);
  // The team whose project list last came back from the cluster, empty or not.
  const [listedFor, setListedFor] = useState<string | null>(null);
  /**
   * Whether this account may add a project in the team (core's `CREATE_APP`):
   * an owner or admin, or a member allowed to (the team's defaults, set by a
   * best-effort step-up when it was made). `null` while unknown, when the
   * create is offered and the node decides.
   */
  const [mayCreate, setMayCreate] = useState<boolean | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [settingsProject, setSettingsProject] = useState<Project | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // New-project modal state
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [presetIdx, setPresetIdx] = useState<number>(DEFAULT_PRESET);
  const [customW, setCustomW] = useState("1280");
  const [customH, setCustomH] = useState("720");
  const [creating, setCreating] = useState(false);
  /** Showcase to open the new project with ("" = blank canvas). */
  const [starter, setStarter] = useState("");

  // Invitation state
  const [invitation, setInvitation] = useState("");
  const [inviteAppOnly, setInviteAppOnly] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteCopying, setInviteCopying] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const inviteResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function handleLogout() {
    clearLastVisit(targetKey);
    await signOut();
    navigate("/");
  }

  const loadProjects = useCallback(async () => {
    if (!teamId) return;
    void canCreateIn(client, teamId).then(setMayCreate);
    try {
      const entries = await listProjects(client, source, teamId);
      // Best-effort: read each document so the card can show its real
      // dimensions, member count and name.
      const resolved = await Promise.all(
        entries.map(async (entry): Promise<ProjectCard> => {
          let doc: DocumentInfo | null = null;
          try { doc = await api.call<DocumentInfo>(entry.contextId, "get_document", {}); } catch { /* unreadable */ }
          return {
            contextId: entry.contextId,
            groupId: teamId,
            name: doc?.name?.trim() || entry.name,
            description: doc?.description ?? "",
            width: doc?.width,
            height: doc?.height,
            memberCount: doc?.memberCount,
            canDelete: entry.owner === accountId,
          };
        }),
      );
      setProjects(resolved);
      setListedFor(teamId);
    } catch {
      /* the last answer stays; the next poll tries again */
    } finally {
      setLoading(false);
      after();
    }
  }, [teamId, client, source, api, accountId, after]);

  useEffect(() => {
    void loadProjects();
    const id = setInterval(loadProjects, 30_000);
    return () => clearInterval(id);
  }, [loadProjects]);

  // Remember this team for the next open (utils/lastVisit). Every read checks
  // it against what the node lists, so a stale URL is never resumed into.
  useEffect(() => {
    if (teamId) rememberTeam(targetKey, teamId);
  }, [teamId, targetKey]);

  // Arriving with `state.resume` (the teams list's resume path) goes straight
  // on to the project last open in this team, once the team has listed it and
  // only if it still does; a project no longer listed is forgotten. Resolved
  // either way, once: a later visit to this page is a plain one.
  const resume = resumeRequested(location);
  const resumed = useRef(false);
  useEffect(() => {
    if (!resume || !teamId || listedFor !== teamId || resumed.current) return;
    resumed.current = true;
    const remembered = readLastVisit(targetKey).projects?.[teamId];
    const target = pickRemembered(projects.map((p) => p.contextId), remembered);
    if (target) {
      void openProject(target, { replace: true });
      return;
    }
    if (remembered) forgetProject(targetKey, teamId, remembered);
    navigate(location.pathname + location.search, { replace: true, state: null });
    // `openProject` is a plain function, re-made each render; the ref keeps this to one run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resume, teamId, listedFor, projects, targetKey, navigate, location.pathname, location.search]);

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

  function resolveDimensions(): { width: number; height: number } | null {
    // A showcase brings its own canvas — its layers are laid out for that size,
    // so letting a preset override it would crop the artwork.
    const showcase = SHOWCASE_PROJECTS.find((p) => p.id === starter);
    if (showcase) return { width: showcase.width, height: showcase.height };
    if (presetIdx >= 0) {
      const p = DIMENSION_PRESETS[presetIdx];
      return { width: p.width, height: p.height };
    }
    const w = Math.round(Number(customW));
    const h = Math.round(Number(customH));
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1 || w > 8192 || h > 8192) return null;
    return { width: w, height: h };
  }

  async function createProject() {
    if (!newName.trim() || !teamId) return;
    const dims = resolveDimensions();
    if (!dims) {
      showToast("Enter a valid canvas size (1–8192 px).");
      return;
    }
    setCreating(true);
    try {
      // The document's `init` arguments travel with the create: name,
      // description, width, height.
      const id = await createInstance(
        client,
        source,
        teamId,
        {
          name: newName.trim(),
          description: "",
          width: dims.width,
          height: dims.height,
        },
        passkey,
      );
      setProjects((prev) => [
        ...prev,
        {
          contextId: id,
          groupId: teamId,
          name: newName.trim(),
          description: "",
          width: dims.width,
          height: dims.height,
          memberCount: 1,
          // The creator may delete what they created.
          canDelete: true,
        },
      ]);
      setNewName("");
      setShowCreate(false);
      // Starting from a showcase means going straight into the editor: the
      // `showcase` query param is what tells it to build the layers (only ever
      // into an empty document — see EditorPage's auto-load guard).
      if (starter && id) {
        setStarter("");
        navigate(`/teams/${teamId}/projects/${id}?showcase=${encodeURIComponent(starter)}`);
        return;
      }
    } catch (err) {
      showToast(`Could not create project: ${messageOf(err)}`);
    } finally {
      setCreating(false);
      after();
    }
  }

  // A project is an app instance: its creator, or a team owner or admin,
  // deletes it (with its layers and blobs). The card goes once the cluster has
  // accepted the delete; a refusal is said, not swallowed.
  async function deleteProject(project: ProjectCard) {
    setMenuOpenId(null);
    try {
      await client.deleteApp(project.contextId);
    } catch (err) {
      showToast(`Could not delete project: ${messageOf(err)}`);
      return;
    } finally {
      after();
    }
    setProjects((prev) => prev.filter((p) => p.contextId !== project.contextId));
    if (teamId) forgetProject(targetKey, teamId, project.contextId);
  }

  // Open a project. Nothing to join first: the instance is on the cluster.
  function openProject(contextId: string, opts?: { replace?: boolean }) {
    if (!teamId) return;
    setOpening(contextId);
    const to = `/teams/${teamId}/projects/${contextId}`;
    if (opts?.replace) navigate(to, { replace: true });
    else navigate(to);
    setOpening(null);
  }

  async function generateInvite() {
    if (!teamId) return;
    setInviteError("");
    setInviteLoading(true);
    try {
      // An org invite, approved with this account's passkey. The link is all
      // there is to share: opening it (and signing in) joins the team.
      const { token, appOnly } = await inviteToken(client, teamId, passkey(), source);
      setInvitation(inviteLink(token, teamId));
      setInviteAppOnly(appOnly);
    } catch (err) {
      const msg = `Failed to generate invitation: ${messageOf(err)}`;
      setInviteError(msg);
      showToast(msg);
    } finally {
      setInviteLoading(false);
      after();
    }
  }

  async function copyInvite() {
    if (!invitation || inviteCopying) return;
    await navigator.clipboard.writeText(invitation);
    showToast("Invitation link copied to clipboard.", "success");
    // Brief loader, then reset to the "generate" state so each share is fresh.
    setInviteCopying(true);
    if (inviteResetRef.current) clearTimeout(inviteResetRef.current);
    inviteResetRef.current = setTimeout(() => {
      setInviteCopying(false);
      setInvitation("");
    }, 5000);
  }

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => navigate("/teams")}>← Teams</button>
        <span className={styles.logo}><Logo size={22} /> Mero PixArt</span>
        <div className={styles.headerRight}>
          <button className="mp-btn mp-btn--ghost" onClick={() => void handleLogout()}>Logout</button>
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.titleRow}>
          <div>
            <h1 className={styles.title}>{teamTitle}</h1>
            <p className={styles.subtitle}>Image projects in this team.</p>
            {mayCreate === false && (
              <p className={styles.subtitle} data-testid="create-project-ask">
                {askAnOwnerCopy("a project")}
              </p>
            )}
          </div>
          {tab === "projects" && mayCreate !== false && (
            <button
              className="mp-btn mp-btn--primary"
              onClick={() => { setShowCreate(true); setNewName(""); setPresetIdx(DEFAULT_PRESET); }}
              data-testid="open-create-modal"
            >
              + New project
            </button>
          )}
        </div>

        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${tab === "projects" ? styles.tabActive : ""}`}
            onClick={() => setTab("projects")}
          >Projects</button>
          <button
            className={`${styles.tab} ${tab === "invitations" ? styles.tabActive : ""}`}
            onClick={() => setTab("invitations")}
          >Invitations</button>
        </div>

        {tab === "projects" && (
          <>
            {loading ? (
              <p className={styles.empty}>Loading…</p>
            ) : projects.length === 0 ? (
              <div className={styles.emptyState} data-testid="empty-projects">
                <div className={`${styles.emptyThumb} mp-checkerboard`} />
                <p className={styles.empty}>No projects yet.</p>
                {mayCreate !== false && (
                  <button
                    className="mp-btn mp-btn--primary"
                    onClick={() => { setShowCreate(true); setNewName(""); setPresetIdx(DEFAULT_PRESET); }}
                  >
                    Create your first project
                  </button>
                )}
              </div>
            ) : (
              <div className={styles.grid}>
                {projects.map((p) => (
                  <div key={p.contextId} className={styles.cardWrap} ref={menuOpenId === p.contextId ? menuRef : null}>
                    <button
                      className={styles.card}
                      data-testid={`project-card-${p.contextId}`}
                      onClick={() => openProject(p.contextId)}
                      disabled={opening === p.contextId}
                    >
                      <span
                        className={`${styles.cardThumb} mp-checkerboard`}
                        style={p.width && p.height ? { aspectRatio: `${p.width} / ${p.height}` } : undefined}
                      >
                        {opening === p.contextId && <span className={styles.thumbBusy}>Opening…</span>}
                      </span>
                      <span className={styles.cardBody}>
                        <span className={styles.cardName}>{p.name || p.contextId.slice(0, 8)}</span>
                        <span className={styles.cardMeta}>
                          <span>{p.width && p.height ? `${p.width} × ${p.height}` : "—"}</span>
                          <span className={styles.metaDot}>·</span>
                          <span>{p.memberCount != null ? `${p.memberCount} member${p.memberCount === 1 ? "" : "s"}` : "—"}</span>
                        </span>
                      </span>
                    </button>
                    <button
                      className={styles.menuBtn}
                      onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === p.contextId ? null : p.contextId); }}
                      title="More options"
                    >⋯</button>
                    {menuOpenId === p.contextId && (
                      <div className={styles.dropdown}>
                        <button className={styles.dropdownItem} onClick={() => { setMenuOpenId(null); openProject(p.contextId); }}>
                          Open
                        </button>
                        <button className={styles.dropdownItem} onClick={() => { setMenuOpenId(null); setSettingsProject(p); }}>
                          Settings
                        </button>
                        {(p.canDelete || isAdmin(myTeamRole)) && (
                          <button className={`${styles.dropdownItem} ${styles.dropdownDanger}`} onClick={() => deleteProject(p)}>
                            Delete
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {tab === "invitations" && (
          <div className={styles.inviteSection}>
            <p className={styles.inviteDesc}>
              Generate an invitation link and share it with teammates. Opening it and
              signing in with a passkey joins the team. Single use: one person can join with this link; generate another for each person you invite.
            </p>
            {invitation && inviteAppOnly && (
              <p className={styles.inviteDesc} data-testid="invite-app-only">
                {appOnlyInviteNote(PRODUCT_NAME)}
              </p>
            )}
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
                    title={invitation}
                  >
                    {truncateMiddle(invitation, 28, 10)}
                  </code>
                  <button className="mp-btn" onClick={copyInvite} data-testid="copy-invite">
                    Copy
                  </button>
                </div>
              )
            ) : (
              <button
                className="mp-btn mp-btn--primary"
                onClick={generateInvite}
                disabled={inviteLoading}
                data-testid="generate-invite"
              >
                {inviteLoading ? "Generating…" : "Generate invitation"}
              </button>
            )}
            {inviteError && <p className={styles.inviteError}>{inviteError}</p>}
          </div>
        )}
      </main>

      {showCreate && (
        <div className="mp-overlay" onClick={() => !creating && setShowCreate(false)}>
          <div className="mp-modal" onClick={(e) => e.stopPropagation()} data-testid="create-modal">
            <h2>New project</h2>
            <p className="sub">Create a new image document in this team.</p>

            <label className="mp-label" htmlFor="np-name">Project name</label>
            <input
              id="np-name"
              autoFocus
              className="mp-input"
              placeholder="Untitled artwork"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createProject()}
              data-testid="new-project-input"
              style={{ marginBottom: 16 }}
            />

            <label className="mp-label" style={{ display: "block", marginBottom: 8 }}>Start from</label>
            <div className={styles.starters}>
              <button
                type="button"
                className={`${styles.starter} ${!starter ? styles.starterActive : ""}`}
                onClick={() => setStarter("")}
                data-testid="starter-blank"
              >
                <span className={styles.starterName}>Blank canvas</span>
                <span className={styles.starterHint}>Pick a size below</span>
              </button>
              {SHOWCASE_PROJECTS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`${styles.starter} ${starter === p.id ? styles.starterActive : ""}`}
                  onClick={() => setStarter(p.id)}
                  data-testid={`starter-${p.id}`}
                  title={p.tagline}
                >
                  <span className={styles.starterName}>{p.name}</span>
                  <span className={styles.starterHint}>{p.width} × {p.height} · {p.layers.length} layers</span>
                </button>
              ))}
            </div>

            <label className="mp-label" style={{ display: "block", margin: "16px 0 8px" }}>
              Canvas size
              {starter && <span className={styles.starterLocked}> — set by the showcase</span>}
            </label>
            <div className={`${styles.presets} ${starter ? styles.presetsDisabled : ""}`}>
              {DIMENSION_PRESETS.map((p, i) => (
                <button
                  key={p.label}
                  type="button"
                  className={`${styles.preset} ${presetIdx === i ? styles.presetActive : ""}`}
                  onClick={() => setPresetIdx(i)}
                  data-testid={`preset-${p.width}x${p.height}`}
                >
                  <span className={styles.presetDims}>{p.width} × {p.height}</span>
                  <span className={styles.presetLabel}>{p.label.split("·")[1]?.trim() ?? "Preset"}</span>
                </button>
              ))}
              <button
                type="button"
                className={`${styles.preset} ${presetIdx < 0 ? styles.presetActive : ""}`}
                onClick={() => setPresetIdx(-1)}
                data-testid="preset-custom"
              >
                <span className={styles.presetDims}>Custom</span>
                <span className={styles.presetLabel}>Set your own</span>
              </button>
            </div>

            {presetIdx < 0 && !starter && (
              <div className={styles.customRow}>
                <div className={styles.customField}>
                  <label className="mp-label" htmlFor="np-w">Width</label>
                  <input id="np-w" className="mp-input" type="number" min={1} max={8192} value={customW}
                    onChange={(e) => setCustomW(e.target.value)} data-testid="custom-width" />
                </div>
                <span className={styles.customTimes}>×</span>
                <div className={styles.customField}>
                  <label className="mp-label" htmlFor="np-h">Height</label>
                  <input id="np-h" className="mp-input" type="number" min={1} max={8192} value={customH}
                    onChange={(e) => setCustomH(e.target.value)} data-testid="custom-height" />
                </div>
                <span className={styles.customUnit}>px</span>
              </div>
            )}

            <div className={styles.modalActions}>
              <button className="mp-btn mp-btn--ghost" onClick={() => setShowCreate(false)} disabled={creating}>
                Cancel
              </button>
              <button
                className="mp-btn mp-btn--primary"
                onClick={createProject}
                disabled={creating || !newName.trim()}
                data-testid="create-project-btn"
              >
                {creating ? "Creating…" : "Create project"}
              </button>
            </div>
          </div>
        </div>
      )}

      {settingsProject && (
        <SettingsModal
          type="project"
          id={settingsProject.contextId}
          namespaceId={teamId}
          name={settingsProject.name || settingsProject.contextId.slice(0, 8)}
          onClose={() => setSettingsProject(null)}
        />
      )}
    </div>
  );
}
