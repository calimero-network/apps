import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { AppInfo, CalimeroClient, PasskeyProvider } from "@calimero-network/mero-js";
import { CreateWorkspaceDialog, type CreateWorkspaceDialogProps } from "@calimero-network/mero-react";
import {
  askAnOwnerCopy,
  canCreateIn,
  describeError,
  type AppSource,
  type ClientRoutes,
} from "@calimero-apps/connect";
import type { OpenedScene } from "./scene";
import { rememberName, storedName } from "./editor/hooks";
import { createScene, listScenes, studiosOf } from "./scenes";
import { IconCube, IconPlus } from "./ui/icons";

const CREATE_LABELS = {
  noun: "scene",
  title: "New scene",
  subtitle: "Name your studio and your first scene, and choose the name collaborators see.",
  nameLabel: "Studio name",
  namePlaceholder: "e.g. Space studio",
  selfLabel: "Your name",
  selfPlaceholder: "e.g. Ada",
};

function SceneNameField({ value, onChange }: { value: string; onChange: (name: string) => void }) {
  return (
    <div className="mero-cw-field">
      <label htmlFor="scene-name">Scene name</label>
      <input id="scene-name" value={value} maxLength={80} placeholder="e.g. Spaceship" onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/**
 * Choose which scene to open, or make one.
 *
 * A scene is one instance of this app (v1: a context), and it lives in an
 * organization, the studio (v1: a namespace) whose members reach every scene
 * in it. "New scene" makes both at once; a studio this account is already in
 * takes another scene with "Add scene".
 */
export function ScenePicker({
  client,
  passkey,
  source,
  release,
  onOpen,
  after,
  children,
}: {
  client: CalimeroClient & ClientRoutes<{ apps: "list" | "create"; orgs: "get" }>;
  passkey: () => PasskeyProvider;
  source: AppSource;
  /** What a new scene's studio runs, reviewed in the create dialog; `null` while it is read. */
  release: CreateWorkspaceDialogProps["release"];
  onOpen: (scene: OpenedScene) => void;
  /** Runs after each request (keeps the stored session current). */
  after: () => void;
  children?: ReactNode;
}) {
  const [scenes, setScenes] = useState<AppInfo[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [sceneName, setSceneName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setScenes(await listScenes(client, source));
      setError(null);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setLoading(false);
      after();
    }
  }, [client, source, after]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function create(key: string, org: string, name: string) {
    setBusy(key);
    setFailed(null);
    try {
      const scene = await createScene(client, source, name, org);
      onOpen(scene);
    } catch (e) {
      setFailed(describeError(e));
    } finally {
      setBusy(null);
      after();
    }
  }

  async function created({ orgId, selfName }: { orgId: string; selfName: string }) {
    setCreating(false);
    if (selfName.trim()) rememberName(selfName.trim());
    await create("new", orgId, sceneName);
    setSceneName("");
  }

  const studios = studiosOf(scenes ?? []);
  const studioKey = studios.join(",");

  // Who may add a scene to each studio (core's CREATE_APP rule): a member who
  // may not is told to ask an owner instead of a button that fails. Unknown
  // (`null`, the org unreadable) keeps the button and lets the node decide.
  const [mayAdd, setMayAdd] = useState<Record<string, boolean | null>>({});
  useEffect(() => {
    let live = true;
    for (const org of studioKey ? studioKey.split(",") : []) {
      void canCreateIn(client, org).then((may) => {
        if (live) setMayAdd((m) => ({ ...m, [org]: may }));
      });
    }
    return () => {
      live = false;
    };
  }, [client, studioKey]);

  return (
    <div className="lobby">
      <CreateWorkspaceDialog
        client={client}
        passkey={passkey()}
        release={release}
        defaultSelfName={storedName()}
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(c) => void created(c)}
        labels={CREATE_LABELS}
        fields={<SceneNameField value={sceneName} onChange={setSceneName} />}
        fieldsValid={sceneName.trim() !== ""}
      />
      <section className="lobby-hero">
        <div className="lobby-copy">
          <p className="eyebrow">Scenes</p>
          <h1>Model together, in one shared scene</h1>
          <p className="lede">
            A scene is one instance of Hyperfeed Models. Everyone in its studio sees every change as it lands, and the
            meshes and textures live in the scene&apos;s own blobs.
          </p>
          <div className="new-scene">
            <button className="large" onClick={() => setCreating(true)} disabled={busy !== null} data-testid="new-scene">
              <IconPlus /> {busy === "new" ? "Creating…" : "New scene"}
            </button>
          </div>
          {failed && <pre className="err">{failed}</pre>}
        </div>
        <div className="lobby-art" aria-hidden="true">
          <IconCube size={140} strokeWidth={0.6} />
        </div>
      </section>

      <div className="lobby-grid">
        <div className="card">
          <div className="card-head">
            <h2>Open a scene</h2>
            <button className="ghost small" onClick={() => void refresh()} disabled={loading}>
              Refresh
            </button>
          </div>
          {loading && scenes === null && <p className="empty">Loading scenes…</p>}
          {error && <pre className="err">{error}</pre>}
          {scenes?.length === 0 && (
            <p className="empty">No scenes yet. Start one above, or open an invitation link someone sent you.</p>
          )}
          {scenes && scenes.length > 0 && (
            <ul className="scene-list">
              {scenes.map((s) => (
                <li key={s.appId}>
                  <button
                    className="scene-item"
                    onClick={() => onOpen({ appId: s.appId, name: s.name, org: s.org })}
                    data-testid="scene-item"
                  >
                    <span className="scene-icon" aria-hidden="true">
                      <IconCube size={22} />
                    </span>
                    <span className="scene-text">
                      <span className="scene-title-row">{s.name || "Untitled scene"}</span>
                      <span className="mono scene-id" title={s.appId}>
                        {s.appId}
                      </span>
                    </span>
                    <span className="scene-open">Open</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="lobby-side">
          {children}
          <div className="card">
            <div className="card-head">
              <h2>Studios</h2>
            </div>
            <p className="hint">
              A studio is an organization and each scene in it is a project. People are invited to the studio, so one
              link opens every scene in it.
            </p>
            {studios.length === 0 && <p className="empty">Your studios appear here once you have a scene.</p>}
            {studios.length > 0 && (
              <input
                className="add-scene-name"
                placeholder="Scene name"
                value={sceneName}
                maxLength={80}
                onChange={(e) => setSceneName(e.target.value)}
                aria-label="Name for the scene to add"
              />
            )}
            {studios.length > 0 && (
              <ul className="ns-list">
                {studios.map((org) => (
                  <li key={org}>
                    <span className="mono ns-id" title={org}>
                      {org}
                    </span>
                    {mayAdd[org] === false ? (
                      <p className="hint" data-testid="ask-an-owner">
                        {askAnOwnerCopy("a scene")}
                      </p>
                    ) : (
                      <button className="ghost small" disabled={busy !== null} onClick={() => void create(org, org, sceneName)}>
                        {busy === org ? "Creating…" : "Add scene"}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
