import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMero, setApplicationId } from "@calimero-network/mero-react";
import { adminGet, adminPost, adminPut, adminDelete, rpcCall, joinContext } from "../api/rpc";
import { resolveApplicationId } from "../api/appId";
import Logo from "../components/Logo";
import SettingsModal from "../components/SettingsModal";
import { useToast } from "../contexts/ToastContext";
import { extractErrorMessage, humanizeError } from "../utils/errorMessage";
import { encodeInvitationObject } from "../utils/invitation";
import { truncateMiddle } from "../utils/format";
import { getStoredTeamName, teamLabel } from "../utils/teamName";
import type { Project, DocumentInfo } from "../types";
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

// Canvas dimension presets offered in the New Project modal.
const DIMENSION_PRESETS: { label: string; width: number; height: number }[] = [
  { label: "1920 × 1080 · Full HD", width: 1920, height: 1080 },
  { label: "1280 × 720 · HD",       width: 1280, height: 720 },
  { label: "1080 × 1080 · Square",  width: 1080, height: 1080 },
  { label: "800 × 600",             width: 800, height: 600 },
];
const DEFAULT_PRESET = 1; // 1280 × 720

// A project enriched with the document metadata read from the contract. The
// dimensions / member count are best-effort: a project created by a peer may not
// have synced its document yet, in which case these stay undefined and the card
// shows placeholders.
interface ProjectCard extends Project {
  width?: number;
  height?: number;
  memberCount?: number;
}

export default function ProjectsPage() {
  const { teamId } = useParams<{ teamId: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { logout, applicationId } = useMero();

  const [tab, setTab] = useState<Tab>("projects");
  const [projects, setProjects] = useState<ProjectCard[]>([]);
  const [loading, setLoading] = useState(true);
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

  // Invitation state
  const [invitation, setInvitation] = useState("");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteCopying, setInviteCopying] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const inviteResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Resolve MeroPixArt's own application id (mirrors TeamsPage's ensureAppId).
  // The desktop can deep-link straight to this page (bypassing TeamsPage), so we
  // must resolve here too rather than trust a possibly-empty useMero().applicationId
  // — otherwise createProject would POST an empty applicationId and the node
  // rejects it ("invalid length 0").
  const appIdRef = useRef<string>("");
  const ensureAppId = useCallback(async (): Promise<string> => {
    if (appIdRef.current) return appIdRef.current;
    let id = "";
    try { id = await resolveApplicationId(); } catch { /* ignore */ }
    if (!id) id = applicationId ?? "";
    if (id) { appIdRef.current = id; setApplicationId(id); }
    return id;
  }, [applicationId]);

  function handleLogout() {
    logout();
    navigate("/login");
  }

  useEffect(() => {
    if (!teamId) return;
    let cancelled = false;
    async function loadProjects() {
      try {
        const raw = await adminGet<{ subgroups?: SubgroupRaw[]; data?: SubgroupRaw[] } | SubgroupRaw[]>(
          `/groups/${teamId}/subgroups`,
        );
        const subgroups: SubgroupRaw[] = Array.isArray(raw)
          ? raw
          : (raw as { subgroups?: SubgroupRaw[] }).subgroups ?? (raw as { data?: SubgroupRaw[] }).data ?? [];

        const resolved: ProjectCard[] = [];
        for (const sg of subgroups) {
          const sgId = sg.groupId ?? sg.group_id ?? sg.id ?? "";
          const sgName = sg.alias ?? sg.name ?? sgId.slice(0, 8);
          try {
            const ctxRaw = await adminGet<{ contexts?: ContextRaw[]; items?: ContextRaw[] } | ContextRaw[]>(
              `/groups/${sgId}/contexts`,
            );
            const ctxs: ContextRaw[] = Array.isArray(ctxRaw)
              ? ctxRaw
              : (ctxRaw as { contexts?: ContextRaw[]; items?: ContextRaw[] }).contexts
                ?? (ctxRaw as { items?: ContextRaw[] }).items ?? [];
            if (ctxs.length > 0) {
              const ctx = ctxs[0];
              const contextId = ctx.contextId ?? ctx.context_id ?? ctx.id ?? sgId;
              // Best-effort: read the document so the card can show real
              // dimensions / member count + name. Failures (not joined yet,
              // unsynced) leave them undefined.
              let doc: DocumentInfo | null = null;
              try { doc = await rpcCall<DocumentInfo>(contextId, "get_document", {}); } catch { /* unsynced */ }
              // Member count comes from the governance group, not the contract's
              // `doc.memberCount` (which counts in-contract registrations and reads
              // 0 for peers who joined the subgroup but never registered). The
              // subgroup id is hex, so `/groups/{id}/members` accepts it.
              let memberCount: number | undefined = doc?.memberCount;
              try {
                const m = await adminGet<{ members?: unknown[] } | unknown[]>(`/groups/${sgId}/members`);
                const arr = Array.isArray(m) ? m : (m as { members?: unknown[] }).members ?? [];
                if (Array.isArray(arr)) memberCount = arr.length;
              } catch { /* keep the doc fallback */ }
              resolved.push({
                contextId,
                groupId: sgId,
                name: doc?.name?.trim() || ctx.alias || ctx.name || sgName,
                description: doc?.description ?? "",
                width: doc?.width,
                height: doc?.height,
                memberCount,
              });
            }
          } catch {
            // no context yet
          }
        }
        if (!cancelled) setProjects(resolved);
      } catch {
        if (!cancelled) setProjects([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadProjects();
    const id = setInterval(loadProjects, 30_000);
    return () => { cancelled = true; clearInterval(id); };
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

  function resolveDimensions(): { width: number; height: number } | null {
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
      // Resolve the app id up front. Never POST an empty one — the node rejects
      // it ("applicationId: invalid length 0, expected a base58 encoded hash").
      const appId = await ensureAppId();
      if (!appId) {
        showToast("Select or install the MeroPixArt application first.");
        return;
      }

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

      // Editor document init params: name, description, width, height. Encoded as
      // the UTF-8 byte array of the JSON object — the node passes these straight
      // into the WASM contract's init.
      const initJson = JSON.stringify({
        name: newName.trim(),
        description: "",
        width: dims.width,
        height: dims.height,
      });
      const initBytes = Array.from(new TextEncoder().encode(initJson));

      const ctxData = await adminPost<{ contextId?: string; id?: string }>(
        "/contexts",
        {
          applicationId: appId,
          protocol: "near",
          groupId: subgroupId || teamId,
          alias: newName.trim(),
          name: newName.trim(),
          initializationParams: initBytes,
        },
      );
      const id = ctxData.contextId ?? ctxData.id ?? "";
      // Store the same group the context was created under (`subgroupId || teamId`).
      // An empty groupId would make Settings fall back to the base58 contextId for
      // `/groups/{id}/members`, which the admin API rejects.
      setProjects((prev) => [
        ...prev,
        {
          contextId: id,
          groupId: subgroupId || teamId,
          name: newName.trim(),
          description: "",
          width: dims.width,
          height: dims.height,
          memberCount: 1,
        },
      ]);
      setNewName("");
      setShowCreate(false);
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
      await adminDelete(`/contexts/${contextId}`);
    } catch {
      // best-effort
    }
    setProjects((prev) => prev.filter((p) => p.contextId !== contextId));
  }

  // Open a project: ensure this node has joined the context (it may have been
  // created on a peer after we joined the team), then navigate into the editor.
  // joinContext is idempotent node-side, so a no-op for projects we created.
  async function openProject(contextId: string) {
    if (!teamId) return;
    setOpening(contextId);
    try {
      await joinContext(contextId).catch(() => { /* already joined / not required */ });
      navigate(`/teams/${teamId}/projects/${contextId}`);
    } finally {
      setOpening(null);
    }
  }

  async function generateInvite() {
    if (!teamId) return;
    setInviteError("");
    setInviteLoading(true);
    try {
      const data = await adminPost<Record<string, unknown>>(
        `/namespaces/${teamId}/invite`,
        {},
      );
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
    await navigator.clipboard.writeText(invitation);
    showToast("Invitation copied to clipboard.", "success");
    // Brief loader, then reset to the "generate" state so each share is fresh.
    setInviteCopying(true);
    if (inviteResetRef.current) clearTimeout(inviteResetRef.current);
    inviteResetRef.current = setTimeout(() => {
      setInviteCopying(false);
      setInvitation("");
    }, 5000);
  }

  const teamTitle = teamId ? teamLabel(teamId, "") : "Team";

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => navigate("/teams")}>← Teams</button>
        <span className={styles.logo}><Logo size={22} /> MeroPixArt</span>
        <div className={styles.headerRight}>
          <button className="mp-btn mp-btn--ghost" onClick={handleLogout}>Logout</button>
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.titleRow}>
          <div>
            <h1 className={styles.title}>{teamTitle}</h1>
            <p className={styles.subtitle}>Image projects in this team.</p>
          </div>
          {tab === "projects" && (
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
                <button
                  className="mp-btn mp-btn--primary"
                  onClick={() => { setShowCreate(true); setNewName(""); setPresetIdx(DEFAULT_PRESET); }}
                >
                  Create your first project
                </button>
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
              inviteCopying ? (
                <div className={styles.tokenBox} data-testid="invite-copying">
                  <span className={styles.inviteSpinner} aria-hidden="true" />
                  <span className={styles.copiedMsg}>Copied! Resetting invitation…</span>
                </div>
              ) : (
                <div className={styles.tokenBox}>
                  <code className={styles.token} data-testid="invite-token" title={invitation}>
                    {truncateMiddle(invitation, 22, 12)}
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

            <label className="mp-label" style={{ display: "block", marginBottom: 8 }}>Canvas size</label>
            <div className={styles.presets}>
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

            {presetIdx < 0 && (
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
          groupId={settingsProject.groupId}
          name={settingsProject.name || settingsProject.contextId.slice(0, 8)}
          onClose={() => setSettingsProject(null)}
        />
      )}
    </div>
  );
}
