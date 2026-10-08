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
import { getStoredTeamName } from "../utils/teamName";
import type { Project } from "../types";
import styles from "./ProjectsPage.module.css";

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
    // where installed and the published web build otherwise. The join box on
    // the Teams page still accepts either form, so links already shared work.
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

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => navigate("/teams")}>← Teams</button>
        <span className={styles.logo}><Logo size={22} /> Mero Design</span>
        <div className={styles.headerRight}>
          <button className={styles.logoutBtn} onClick={handleLogout}>Logout</button>
        </div>
      </header>

      <main className={styles.main}>
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
            <div className={styles.createRow}>
              <input
                className={styles.input}
                placeholder="New project name…"
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

            {loading ? (
              <p className={styles.empty}>Loading…</p>
            ) : projects.length === 0 ? (
              <p className={styles.empty} data-testid="empty-projects">No projects yet. Create one above.</p>
            ) : (
              <div className={styles.grid}>
                {projects.map((p) => (
                  <div key={p.contextId} className={styles.cardWrap} ref={menuOpenId === p.contextId ? menuRef : null}>
                    <button
                      className={styles.card}
                      data-testid={`project-card-${p.contextId}`}
                      onClick={() => navigate(`/teams/${teamId}/projects/${p.contextId}`)}
                    >
                      <ProjectThumbnail contextId={p.contextId} className={styles.cardThumb} />
                      <span className={styles.cardName}>{p.name || p.contextId.slice(0, 8)}</span>
                    </button>
                    <button
                      className={styles.menuBtn}
                      onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === p.contextId ? null : p.contextId); }}
                      title="More options"
                    >⋯</button>
                    {menuOpenId === p.contextId && (
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
                ))}
              </div>
            )}
          </>
        )}

        {tab === "invitations" && (
          <div className={styles.inviteSection}>
            <p className={styles.inviteDesc}>
              Generate an invitation link and share it with teammates. Opening it launches
              the desktop app where installed, and the web build otherwise — or they can
              paste it on the Teams page to join.
            </p>
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
                className={styles.btn}
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
