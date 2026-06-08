import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMero } from "@calimero-network/mero-react";
import { adminGet, adminPost, adminPut, adminDelete } from "../api/rpc";
import Logo from "../components/Logo";
import SettingsModal from "../components/SettingsModal";
import type { Project } from "../types";
import styles from "./ProjectsPage.module.css";

type SubgroupRaw = {
  groupId?: string;
  group_id?: string;
  id?: string;
  alias?: string;
  name?: string;
};

type ContextRaw = {
  contextId?: string;
  context_id?: string;
  id?: string;
  alias?: string;
  name?: string;
};

type Tab = "projects" | "invitations";

export default function ProjectsPage() {
  const { teamId } = useParams<{ teamId: string }>();
  const navigate = useNavigate();
  const { logout, applicationId } = useMero();

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
  const [inviteCopied, setInviteCopied] = useState(false);
  const [inviteError, setInviteError] = useState("");

  function handleLogout() {
    logout();
    navigate("/login");
  }

  useEffect(() => {
    if (!teamId) return;
    async function loadProjects() {
      try {
        const raw = await adminGet<{ subgroups?: SubgroupRaw[]; data?: SubgroupRaw[] } | SubgroupRaw[]>(
          `/groups/${teamId}/subgroups`,
        );
        const subgroups: SubgroupRaw[] = Array.isArray(raw)
          ? raw
          : (raw as { subgroups?: SubgroupRaw[] }).subgroups ?? (raw as { data?: SubgroupRaw[] }).data ?? [];

        const resolved: Project[] = [];
        for (const sg of subgroups) {
          const sgId = sg.groupId ?? sg.group_id ?? sg.id ?? "";
          const sgName = sg.alias ?? sg.name ?? sgId.slice(0, 8);
          try {
            const ctxRaw = await adminGet<{ contexts?: ContextRaw[]; items?: ContextRaw[] } | ContextRaw[]>(
              `/groups/${sgId}/contexts`,
            );
            const ctxs: ContextRaw[] = Array.isArray(ctxRaw)
              ? ctxRaw
              : (ctxRaw as any).contexts ?? (ctxRaw as any).items ?? [];
            if (ctxs.length > 0) {
              const ctx = ctxs[0];
              resolved.push({
                contextId: ctx.contextId ?? ctx.context_id ?? ctx.id ?? sgId,
                name: ctx.alias ?? ctx.name ?? sgName,
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

  async function createProject() {
    if (!newName.trim() || !teamId) return;
    setCreating(true);
    try {
      const sgData = await adminPost<{ groupId?: string; group_id?: string; id?: string }>(
        `/namespaces/${teamId}/groups`,
        { groupAlias: newName.trim(), groupName: newName.trim() },
      );
      const subgroupId = sgData.groupId ?? sgData.group_id ?? sgData.id ?? "";

      if (subgroupId) {
        await adminPut(`/groups/${subgroupId}/settings/subgroup-visibility`, {
          subgroupVisibility: "open",
        }).catch(() => {});
      }

      const initJson = JSON.stringify({ name: newName.trim(), description: "" });
      const initBytes = Array.from(new TextEncoder().encode(initJson));

      const ctxData = await adminPost<{ contextId?: string; id?: string }>(
        "/contexts",
        {
          applicationId: applicationId ?? "",
          protocol: "near",
          groupId: subgroupId || teamId,
          alias: newName.trim(),
          name: newName.trim(),
          initializationParams: initBytes,
        },
      );
      const id = ctxData.contextId ?? ctxData.id ?? "";
      setProjects((prev) => [
        ...prev,
        { contextId: id, name: newName.trim(), description: "", isPublic: true },
      ]);
      setNewName("");
    } finally {
      setCreating(false);
    }
  }

  async function deleteProject(contextId: string) {
    setMenuOpenId(null);
    try {
      await adminDelete(`/contexts/${contextId}`);
    } catch {
      // best-effort
    }
    setProjects((prev) => prev.filter((p) => p.contextId !== contextId));
  }

  async function generateInvite() {
    if (!teamId) return;
    setInviteError("");
    setInviteLoading(true);
    try {
      const data = await adminPost<unknown>(
        `/namespaces/${teamId}/invite`,
        {},
      );
      if (data) {
        const encoded = btoa(JSON.stringify(data)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
        setInvitation(encoded);
      }
    } catch {
      setInviteError("Failed to generate invitation. Check node connection.");
    } finally {
      setInviteLoading(false);
    }
  }

  async function copyInvite() {
    if (!invitation) return;
    await navigator.clipboard.writeText(invitation);
    setInviteCopied(true);
    setTimeout(() => setInviteCopied(false), 2000);
  }

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => navigate("/teams")}>← Teams</button>
        <span className={styles.logo}><Logo size={22} /> MeroDesign</span>
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
                      <div className={styles.cardThumb} />
                      <span className={styles.cardName}>{p.name || p.contextId.slice(0, 8)}</span>
                    </button>
                    <button
                      className={styles.menuBtn}
                      onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === p.contextId ? null : p.contextId); }}
                      title="More options"
                    >⋯</button>
                    {menuOpenId === p.contextId && (
                      <div className={styles.dropdown}>
                        <button className={styles.dropdownItem} onClick={() => { setMenuOpenId(null); setSettingsProject(p); }}>
                          Settings
                        </button>
                        <button className={`${styles.dropdownItem} ${styles.dropdownDanger}`} onClick={() => deleteProject(p.contextId)}>
                          Delete
                        </button>
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
              Generate an invitation code and share it with teammates. They paste it on the Teams page to join.
            </p>
            {invitation ? (
              <div className={styles.tokenBox}>
                <code className={styles.token} data-testid="invite-token">{invitation}</code>
                <button className={styles.copyBtn} onClick={copyInvite} data-testid="copy-invite">
                  {inviteCopied ? "Copied!" : "Copy"}
                </button>
              </div>
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
          name={settingsProject.name || settingsProject.contextId.slice(0, 8)}
          onClose={() => setSettingsProject(null)}
        />
      )}
    </div>
  );
}
