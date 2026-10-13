import { useEffect, useRef, useState, type ReactElement } from "react";
import type { TextureRef, VersionView } from "../generated/MeroModelsClient";
import { cloneObject, MAP_SLOTS, MAX_TEXTURE_SIDE, newId, type MapSlot, type SceneObject } from "../editor/model";
import { inspectImage } from "../editor/textures";
import { messageOf } from "../editor/sync";
import { nameOf, useEditor } from "../editor/store";
import { NumberField, Section } from "../ui/fields";
import { useStudio } from "./StudioContext";

// ── formatting ──────────────────────────────────────────────────────────────

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatAgo(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString();
}

function formatUntil(ms: number): string {
  const d = new Date(ms);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
}

// ── check-out ───────────────────────────────────────────────────────────────

const DURATIONS = [
  { hours: 1, label: "1 hour" },
  { hours: 8, label: "8 hours" },
  { hours: 24, label: "1 day" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "1 week" },
];

/**
 * Check an asset out so nobody else changes it while you work, as in a
 * studio's version control. Everyone else's node refuses their writes to it
 * until you check it in or the check-out lapses; an admin can release it.
 */
export function CheckoutSection({ ids, label = "Check-out" }: { ids: string[]; label?: string }) {
  const { sync } = useStudio();
  const locks = useEditor((s) => s.locks);
  const role = useEditor((s) => s.role);
  const state = useEditor();
  const [hours, setHours] = useState(8);
  const [busy, setBusy] = useState(false);
  if (!ids.length) return null;
  const held = ids.map((id) => locks.get(id)).filter((l) => l && l.expires_at > Date.now());
  const theirs = held.filter((l) => !l!.mine);
  const mine = held.filter((l) => l!.mine);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title={label}>
      {theirs.length > 0 ? (
        <>
          <p className="lock-note theirs" data-testid="lock-theirs">
            <span aria-hidden="true">🔒</span> Checked out by {nameOf(state, theirs[0]!.holder)} until {formatUntil(theirs[0]!.expires_at)}. It is
            read-only to you until they check it in.
          </p>
          {role === "admin" && (
            <div className="button-row">
              <button className="danger" disabled={busy || !sync} onClick={() => void run(() => sync!.checkIn(theirs.map((l) => l!.asset_id)))}>
                Release their check-out
              </button>
            </div>
          )}
        </>
      ) : mine.length > 0 ? (
        <>
          <p className="lock-note mine" data-testid="lock-mine">
            Checked out by you until {formatUntil(Math.min(...mine.map((l) => l!.expires_at)))}. Nobody else can change {ids.length > 1 ? "these" : "it"}.
          </p>
          <div className="button-row">
            <button disabled={busy || !sync} onClick={() => void run(() => sync!.checkIn(ids))} data-testid="check-in">
              Check in
            </button>
            <button className="ghost" disabled={busy || !sync} onClick={() => void run(() => sync!.checkOut(ids, hours))}>
              Extend {DURATIONS.find((d) => d.hours === hours)?.label}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="hint">Check out to keep others from changing {ids.length > 1 ? `these ${ids.length}` : "this"} while you work.</p>
          <div className="button-row">
            <select value={hours} onChange={(e) => setHours(Number(e.target.value))} aria-label="Check-out length" disabled={role === "viewer"}>
              {DURATIONS.map((d) => (
                <option key={d.hours} value={d.hours}>
                  {d.label}
                </option>
              ))}
            </select>
            <button disabled={busy || !sync || role === "viewer"} onClick={() => void run(() => sync!.checkOut(ids, hours))} data-testid="check-out">
              Check out
            </button>
          </div>
        </>
      )}
    </Section>
  );
}

// ── history ─────────────────────────────────────────────────────────────────

/**
 * Every saved version of a mesh or texture, newest first. Restoring writes the
 * old blob as a new version, so restoring is itself undoable and recorded.
 */
export function HistorySection({
  assetId,
  kind,
  texture,
}: {
  assetId: string;
  kind: "mesh" | "texture";
  texture?: TextureRef;
}) {
  const { sync } = useStudio();
  const state = useEditor();
  const current = kind === "mesh" ? state.meshes.get(assetId)?.ref?.blob_id : texture?.blob_id;
  const [rows, setRows] = useState<VersionView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [all, setAll] = useState(false);
  const locked = !!state.lockedByOther(assetId);
  const canEdit = state.role !== "viewer" && !locked;

  useEffect(() => {
    if (!sync) return;
    let live = true;
    sync
      .listHistory(assetId)
      .then((r) => live && (setRows(r), setError(null)))
      .catch((e) => live && setError(messageOf(e)));
    return () => {
      live = false;
    };
  }, [sync, assetId, current]);

  const shown = (rows ?? []).slice().reverse();
  const visible = all ? shown : shown.slice(0, 8);

  return (
    <Section title={rows ? `History · ${rows.length} version${rows.length === 1 ? "" : "s"}` : "History"} defaultOpen={false}>
      {kind === "mesh" && (
        <div className="save-version">
          <input
            placeholder="Version note, e.g. retopo pass"
            value={note}
            maxLength={80}
            disabled={!canEdit}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            aria-label="Version note"
          />
          <button
            disabled={!canEdit || !sync || !note.trim() || !state.meshes.get(assetId)}
            onClick={() => {
              void sync!.saveVersion(assetId, note.trim());
              setNote("");
            }}
          >
            Save version
          </button>
        </div>
      )}
      {error && <pre className="err">{error}</pre>}
      {!rows && !error && <p className="hint">Loading…</p>}
      {rows && rows.length === 0 && <p className="hint">No saved versions yet.</p>}
      <ol className="history-list" data-testid="history">
        {visible.map((v) => (
          <li key={`${v.number}-${v.blob_id}`} className={v.current ? "current" : ""}>
            <span className="v-num">v{v.number}</span>
            <span className="v-text">
              <span className="v-line">
                {nameOf(state, v.author)} · {formatAgo(v.created_at)}
              </span>
              <span className="v-sub">
                {kind === "mesh" ? `${v.a.toLocaleString()} verts · ${v.b.toLocaleString()} tris` : `${v.a}×${v.b}`} · {formatBytes(v.size)}
                {v.message && <em> · {v.message}</em>}
              </span>
            </span>
            {v.current ? (
              <span className="role-badge editor">Current</span>
            ) : (
              <button
                className="ghost small"
                disabled={!canEdit || !sync}
                onClick={() => {
                  if (!sync) return;
                  const p = kind === "mesh" ? sync.restoreMesh(assetId, v) : texture ? sync.restoreTexture(texture, v) : Promise.resolve();
                  void p.catch((e) => useEditor.getState().notify(messageOf(e), true));
                }}
              >
                Restore
              </button>
            )}
          </li>
        ))}
      </ol>
      {shown.length > visible.length && (
        <button className="ghost small" onClick={() => setAll(true)}>
          Show all {shown.length}
        </button>
      )}
    </Section>
  );
}

// ── textures ────────────────────────────────────────────────────────────────

/** A small preview of a texture, read from its blob. */
export function TextureThumb({ texture, size = 36 }: { texture: TextureRef | undefined; size?: number }) {
  const { sync } = useStudio();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!sync || !texture) return;
    let live = true;
    let made: string | null = null;
    sync.blobs
      .get(texture.blob_id)
      .then((bytes) => {
        if (!live) return;
        made = URL.createObjectURL(new Blob([bytes], { type: texture.mime }));
        setUrl(made);
      })
      .catch(() => {});
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
      setUrl(null);
    };
  }, [sync, texture?.blob_id, texture?.mime]);
  return (
    <span className="tex-thumb" style={{ width: size, height: size }}>
      {url ? <img src={url} alt="" /> : <span className="tex-empty" />}
    </span>
  );
}

/** Pick an image file and add it as a texture; resolves to the new texture's id, or null. */
export function useTextureUpload(): {
  input: ReactElement;
  choose: (opts: { colorSpace: "srgb" | "linear"; replace?: TextureRef }) => Promise<string | null>;
  busy: boolean;
} {
  const { sync } = useStudio();
  const ref = useRef<HTMLInputElement>(null);
  const pending = useRef<((file: File | null) => void) | null>(null);
  const [busy, setBusy] = useState(false);
  const input = (
    <input
      ref={ref}
      type="file"
      accept="image/png,image/jpeg,image/webp"
      hidden
      onChange={(e) => {
        const file = e.target.files?.[0] ?? null;
        e.target.value = "";
        pending.current?.(file);
        pending.current = null;
      }}
    />
  );
  const choose = async ({ colorSpace, replace }: { colorSpace: "srgb" | "linear"; replace?: TextureRef }) => {
    if (!sync || !ref.current) return null;
    const file = await new Promise<File | null>((resolve) => {
      pending.current = resolve;
      ref.current!.click();
    });
    if (!file) return null;
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const info = await inspectImage(bytes);
      if (info.width > MAX_TEXTURE_SIDE || info.height > MAX_TEXTURE_SIDE) {
        throw new Error(`That image is ${info.width}×${info.height}; a texture is at most ${MAX_TEXTURE_SIDE} pixels a side.`);
      }
      const id = replace?.id ?? newId();
      useEditor.getState().notify(`Uploading ${file.name} (${formatBytes(bytes.length)})…`);
      await sync.putTexture(
        {
          id,
          name: replace?.name ?? file.name.replace(/\.[^.]+$/, "").slice(0, 80),
          width: info.width,
          height: info.height,
          mime: info.mime,
          color_space: replace?.color_space ?? colorSpace,
          message: replace ? `Replaced with ${file.name}` : "",
        },
        bytes,
      );
      useEditor.getState().notify(`${file.name} is a texture now.`);
      return id;
    } catch (e) {
      useEditor.getState().notify(messageOf(e), true);
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { input, choose, busy };
}

/** The material's texture slots, for every selected solid. */
export function TextureSlots({ objects, canEdit }: { objects: SceneObject[]; canEdit: boolean }) {
  const textures = useEditor((s) => s.textures);
  const { input, choose, busy } = useTextureUpload();
  const active = objects.at(-1);
  if (!active) return null;
  const list = [...textures.values()].sort((a, b) => a.name.localeCompare(b.name));

  const assign = (slot: MapSlot, textureId: string) => {
    const s = useEditor.getState();
    const puts = objects.map((o) => {
      const next = cloneObject(o);
      next.material[slot] = textureId;
      return next;
    });
    s.commit({ puts, deletes: [], meshes: [] }, textureId ? "Assign texture" : "Remove texture");
  };

  return (
    <div className="tex-slots" data-testid="texture-slots">
      {input}
      {MAP_SLOTS.map((slot) => {
        const id = active.material[slot.key];
        const tex = id ? textures.get(id) : undefined;
        return (
          <div className="tex-slot" key={slot.key}>
            <TextureThumb texture={tex} />
            <div className="tex-slot-body">
              <span className="num-label">{slot.label}</span>
              <select
                value={tex ? id : ""}
                disabled={!canEdit}
                aria-label={`${slot.label} texture`}
                onChange={(e) => assign(slot.key, e.target.value)}
              >
                <option value="">None</option>
                {list.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {t.width}×{t.height}
                  </option>
                ))}
                {id && !tex && <option value={id}>(missing texture)</option>}
              </select>
            </div>
            <button
              className="ghost small"
              disabled={!canEdit || busy}
              title="Upload an image for this slot"
              onClick={() => void choose({ colorSpace: slot.colorSpace }).then((newIdValue) => newIdValue && assign(slot.key, newIdValue))}
            >
              Upload…
            </button>
          </div>
        );
      })}
      {active.material.normal_map && (
        <NumberField
          label="Normal strength"
          value={active.material.normal_scale}
          step={0.05}
          min={0}
          max={10}
          disabled={!canEdit}
          onCommit={(v) => {
            const puts = objects.map((o) => ({ ...cloneObject(o), material: { ...o.material, normal_scale: v } }));
            useEditor.getState().commit({ puts, deletes: [], meshes: [] }, "Normal strength");
          }}
        />
      )}
    </div>
  );
}

/** Every texture in the scene: replace, version, check out, delete. */
export function TextureLibrary({ canEdit }: { canEdit: boolean }) {
  const { sync } = useStudio();
  const textures = useEditor((s) => s.textures);
  const objects = useEditor((s) => s.objects);
  const state = useEditor();
  const [open, setOpen] = useState<string | null>(null);
  const { input, choose, busy } = useTextureUpload();
  const list = [...textures.values()].sort((a, b) => a.name.localeCompare(b.name));
  const usedBy = (id: string) =>
    [...objects.values()].filter((o) => MAP_SLOTS.some((slot) => o.material[slot.key] === id)).length;

  return (
    <Section title={`Textures · ${list.length}`} defaultOpen={list.length > 0}>
      {input}
      <div className="button-row">
        <button disabled={!canEdit || busy} onClick={() => void choose({ colorSpace: "srgb" })} data-testid="add-texture">
          Add texture…
        </button>
      </div>
      {list.length === 0 && <p className="hint">No textures yet. Add one here, or from a material slot.</p>}
      <ul className="tex-list">
        {list.map((t) => {
          const lockedOut = !!state.lockedByOther(t.id);
          const lock = state.locks.get(t.id);
          return (
            <li key={t.id}>
              <div className="tex-row">
                <TextureThumb texture={t} size={40} />
                <button className="tex-name" onClick={() => setOpen(open === t.id ? null : t.id)}>
                  <span>
                    {t.name}
                    {lock && lock.expires_at > Date.now() && <span title={`Checked out by ${nameOf(state, lock.holder)}`}> 🔒</span>}
                  </span>
                  <span className="v-sub">
                    {t.width}×{t.height} · {formatBytes(t.size)} · {t.color_space} · used by {usedBy(t.id)}
                  </span>
                </button>
              </div>
              {open === t.id && (
                <div className="tex-detail">
                  <div className="button-row">
                    <button disabled={!canEdit || lockedOut || busy} onClick={() => void choose({ colorSpace: t.color_space as "srgb" | "linear", replace: t })}>
                      Replace image…
                    </button>
                    <button
                      className="danger"
                      disabled={!canEdit || lockedOut || !sync}
                      onClick={() => void sync!.deleteTextures([t.id])}
                    >
                      Delete
                    </button>
                  </div>
                  <CheckoutSection ids={[t.id]} />
                  <HistorySection assetId={t.id} kind="texture" texture={t} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
