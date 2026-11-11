import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { AppInfo, CalimeroClient } from "@calimero-network/mero-js";
import {
  askAnOwnerCopy,
  canCreateIn,
  describeError,
  type AppSource,
  type ClientRoutes,
} from "@calimero-apps/connect";
import type { OpenedScene } from "./scene";
import { createScene, listScenes, studiosOf } from "./scenes";
import { IconCube, IconPlus } from "./ui/icons";

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
  source,
  onOpen,
  after,
  children,
}: {
  client: Pick<CalimeroClient, "session"> & ClientRoutes<{ apps: "list" | "create"; orgs: "create" | "get" }>;
  source: AppSource;
  onOpen: (scene: OpenedScene) => void;
  /** Runs after each request (keeps the stored session current). */
  after: () => void;
  children?: ReactNode;
}) {
  const [scenes, setScenes] = useState<AppInfo[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
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

  async function create(key: string, org: string | null) {
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
      <section className="lobby-hero">
        <div className="lobby-copy">
          <p className="eyebrow">Scenes</p>
          <h1>Model together, in one shared scene</h1>
          <p className="lede">
            A scene is one instance of Mero Models. Everyone in its studio sees every change as it lands, and the
            meshes and textures live in the scene&apos;s own blobs.
          </p>
          <div className="new-scene">
            <input
              placeholder="Scene name"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              aria-label="Scene name"
              onKeyDown={(e) => {
                if (e.key === "Enter" && busy === null) void create("new", null);
              }}
            />
            <button className="large" onClick={() => void create("new", null)} disabled={busy !== null} data-testid="new-scene">
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
                      <button className="ghost small" disabled={busy !== null} onClick={() => void create(org, org)}>
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
