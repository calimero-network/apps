# MeroPixArt — Build Tracker

A collaborative, peer‑to‑peer raster image editor (a Photopea / Photoshop‑style
app) built on the **Calimero** network. Layers, masks, adjustments, blend modes,
transform/warp, text, folders, brush/eraser/fill, image upload, export, and a
gallery — all collaborative across nodes the same way **MeroDesign** and
**MeroChat** are: teams (namespaces) → projects (subgroups + contexts) →
invitations → roles.

Package: `com.calimero.meropixart` · crate `meropixart` · wasm `meropixart.wasm`
Dev ports: node1 `2460`/`2560`, node2 `2461`/`2561` · frontend `5176`

---

## 0. Architecture (decisions)

- **Contract holds metadata, blobs hold pixels.** WASM/CRDT state is too small &
  expensive for raster data. Each raster layer's pixels are a **PNG blob**
  (`PUT /admin-api/blobs`, announced to context). The contract stores the
  `blobId` + layer metadata. Masks are grayscale PNG blobs too.
- **Editing pipeline.** Destructive ops (brush, eraser, fill, crop, transform
  bake, filters) are rendered in‑browser to an offscreen canvas → exported to a
  new PNG blob → `update_layer_content(layerId, blobId, …)`. Non‑destructive
  adjustments (brightness/contrast/saturation/hue/exposure/curves), opacity,
  blend mode, visibility, and transform live as **layer params** applied at
  composite/render time.
- **Compositor.** Layers composited bottom→top honoring folder nesting, blend
  mode, opacity, mask, and adjustments. 2D canvas first; WebGL optional later.
- **Collaboration.** Same governance as MeroDesign: namespace=team,
  subgroup+context=project, `AccessControl` roles (admin/editor/viewer), SSE for
  realtime, live cursors. LWW merge on `updated_at`.
- **Theme.** Calimero dark: bg `#0F1419`/`#131215`/`#0A0E13`, accent lime
  `#A5FF11`, font Power Grotesk/Inter. Dark UI is correct for an image editor.

---

## 1. Backend — WASM contract (`logic/`)  ✓ DONE

> **SDK pin:** `0.11.0-rc.6` for all Calimero crates (sdk, storage,
> storage-macros), via **git tag** `https://github.com/calimero-network/core?tag=0.11.0-rc.6`
> (commit `33f5763`) — rc.6 is published only as a git tag (crates.io stops at
> rc.5) and the workspace package version at the tag is `0.0.0`, so a plain
> version requirement can't match; the git-tag form is required. Uses **borsh
> 1.6.1** (rc.6 needs borsh 1.x). The unused `calimero-wasm-abi` build-dep was
> dropped (no `build.rs`; the crate was renamed `mero-abi` in core anyway).
> 10/10 `cargo test` pass; WASM builds to `res/meropixart.wasm` (~1.17 MB).
> Merobox/CI runtime image bumped to `merod:0.11.0-rc.6`. Verified end-to-end on
> a live node (install + init + RPCs).

- [x] `Cargo.toml`, `rust-toolchain.toml`, `build.sh`, `build-bundle.sh`, `calimero.json`
- [x] State: doc name/desc (Ownable<LwwRegister>), canvas w/h/background,
      `layers/members/cursors: UnorderedMap`, `roles: AccessControl`
- [x] `Layer` (id,name,kind,parentId,layerIndex,visible,locked,opacity,blendMode,
      x/y/w/h,rotation,scaleX/scaleY,blobId,maskBlobId,fill,adjustments,text,
      createdBy/At,updatedAt) — LWW merge on updatedAt
- [x] `Adjustments` (brightness,contrast,saturation,hue,exposure,blur,invert,curves)
- [x] `TextProps` (content,fontFamily,fontSize,color,bold,italic,align)
- [x] Events (LayerAdded/Updated/Deleted, LayersReordered, Member*, DocumentUpdated, CursorMoved, RoleUpdated, OwnerTransferred)
- [x] RPC document/roles/members/layers/cursors (full surface incl. move_layer,
      reorder_layers, bring_to_front, send_to_back, update_layer_content,
      update_layer_mask, update_adjustments, update_text, clear_layers)
- [x] Blob announce on content/mask/image layers
- [x] Unit tests (roles, ownership, doc resize, layer LWW, group reparent, viewer gate)

## 2. Frontend — app shell & infra (`app/`)  ✓ DONE

- [ ] `package.json` (mero-js/react/ui, react 19, vite 6, vitest 4, playwright,
      zustand, react-router 7, uuid, axios, clsx)
- [ ] `vite.config.ts` (port 5176, vitest jsdom), `tsconfig*.json`, `eslint`, `index.html`
- [ ] `playwright.config.ts` (mocked + integration projects, PW_PORT default 5176)
- [ ] `src/main.tsx` (MeroProvider, Tauri-hash SSO), `src/App.tsx` (routes + guards)
- [ ] `src/index.css` — Calimero dark theme tokens
- [ ] `src/api/rpc.ts` (rpcCall, admin*, blobs), `src/api/appId.ts`, `src/api/namespaces`
- [ ] `src/hooks/useSse.ts`, `src/contexts/ToastContext.tsx`
- [ ] `src/types/index.ts` (Layer, Adjustments, TextProps, Member, Project, Team)
- [ ] Pages: Landing, Login, Teams, Projects (+gallery), Editor

## 3. Frontend — editor core  ✓ DONE

- [ ] `store/editorStore.ts` (zustand: layers, selection, activeTool, zoom/pan,
      color, brush settings, undo/redo history, clipboard)
- [ ] **Compositor** `components/CanvasStage.tsx` — stacked layer render w/ blend
      mode, opacity, mask, adjustments, transform; pan/zoom; selection overlay
- [ ] `utils/raster.ts` — offscreen render, PNG export, adjustment→canvas filter,
      mask apply, blob round‑trip; `utils/blobCache.ts` (IndexedDB)
- [ ] **Toolbar** `components/Toolbar.tsx` — move, marquee/lasso select, crop,
      brush, eraser, bucket fill, eyedropper, text, shapes, gradient, transform,
      warp, clone stamp, zoom/hand
- [ ] **LayersPanel** `components/LayersPanel.tsx` — list + folders (drag‑nest),
      reorder, visibility, lock, opacity, blend mode, mask add/edit, group/ungroup,
      add/delete/duplicate, rename
- [ ] **AdjustmentsPanel** — brightness/contrast/saturation/hue/exposure/invert
      sliders + **CurvesEditor** (canvas spline UI) + Levels
- [ ] **ColorPicker**, brush size/hardness/opacity controls
- [ ] **TopBar** — new/open/export(PNG·JPG), undo/redo, zoom, doc size, members, settings
- [ ] **HistoryPanel** (undo/redo stack)
- [ ] Collab: `CursorsOverlay`, presence, SSE refetch wiring
- [ ] Image **upload** → new raster layer (blob); **export** flatten → download
- [ ] Governance UI: `InviteModal`, `SettingsModal` (roles), `UsernameModal`

## 4. Tools — image editing feature matrix  ◐ CORE DONE

- [x] Brush / pencil (size, hardness, opacity, color) — destructive to active raster layer
- [x] Eraser (destination-out)
- [x] Bucket fill (flood fill w/ tolerance)
- [x] Eyedropper (samples composited pixel)
- [x] Move (translate via drag)
- [x] Transform (scale + rotate handles on bounding box)
- [x] Text layers (content, font, size, color, bold/italic, align)
- [x] Fill layers (solid color)
- [x] Layer masks (paint black=hide / white=reveal, grayscale blob)
- [x] Blend modes (all 16 via globalCompositeOperation)
- [x] Non-destructive adjustments (brightness/contrast/saturation/hue/exposure/blur/invert) — live CSS filter
- [x] Curves (per-channel RGB/R/G/B spline editor, baked via LUT) + filter presets (grayscale/sepia/blur)
- [x] Layer folders / groups (nesting, inherited visibility + opacity)
- [x] Canvas resize (via Settings → update_document width/height)
- [x] Image upload → raster layer; export flatten → PNG / JPG download
- [ ] Marquee / lasso selection → crop-to-selection (FOLLOW-UP)
- [ ] Dedicated crop tool (FOLLOW-UP — resize works via Settings)
- [ ] Warp / free-transform mesh (FOLLOW-UP)
- [ ] Gradient tool, Clone stamp, Shape-draw tool (FOLLOW-UP — shapes available as fill layers)
- [ ] Standalone Levels UI + adjustment layers (FOLLOW-UP — curves covers tone)

## 5. Scripts (`scripts/`)  ✓ DONE (dev-node verified on real merod rc.4)

- [ ] `setup.sh` — prereqs, wasm target, build logic, install app deps
- [ ] `dev-node.sh` — node1 on 2460/2560: build, init, CORS, install app, namespace+subgroup+context, write `app/.env.integration`
- [ ] `dev-node2.sh` — node2 on 2461/2561: bootstrap‑to‑node1, install app
- [ ] `dev-invite.sh` — invite node2 → join namespace + project context
- [ ] `workflows.sh` — run merobox YAMLs with full pre/post cleanup

## 6. Makefile  ✓ DONE

- [ ] Targets: `help setup install build bundle dev restart frontend dev-node
      dev-node2 dev-invite stop logic-build logic-bundle app-build
      app-typecheck app-lint test unit e2e e2e-ui workflows logic-test clean`

## 7. Merobox workflows (`workflows/`)  ✓ WRITTEN (run needs Docker — not available in this env)

- [ ] `e2e.yml` — 2‑node: install, namespace, project context, invite/join, sync,
      add layer from node1, verify layers on node2
- [ ] `integration-setup.yml` — 2‑node seed for Playwright integration (nodes stay up)
- [ ] `logic-test.yml` — single‑node RPC assertions over the contract surface

## 8. CI (`.github/workflows/`)  ✓ DONE

- [ ] `ci.yml` — typecheck + lint + vitest + build + mocked Playwright
- [ ] `integration-ci.yml` — build wasm → merobox integration-setup → integration Playwright
- [ ] `workflow-tests.yml` — build wasm → merobox e2e.yml + logic-test.yml (retries)

## 9. Tests  ◐ (unit + mocked e2e green; integration/merobox need Docker)

- [x] Rust unit tests (contract) — 10/10 `cargo test` pass
- [x] Live-node RPC smoke test — get_document/my_role/join/get_members/add_layer/update_adjustments/get_layers all verified against real merod rc.4
- [x] Vitest unit tests — 17/17 pass (raster math, color, curves, blend, store actions, undo/redo, role gate)
- [x] Playwright **mocked** e2e — 11/11 pass (landing + editor: tools, brush controls, layers panel, role badge, doc name, canvas, colors)
- [ ] Playwright **integration** e2e — FOLLOW-UP (dir scaffolded; needs 2 live nodes + seed)
- [ ] Merobox workflow run — FOLLOW-UP (YAMLs written + YAML-valid; needs Docker)

## 10. Docs  ✓ DONE

- [x] `README.md` (rewritten for the editor), `.gitignore`, `.editorconfig`
- [x] `TRACKER.md` (this file)

---

## Build status (verified this session)

| Check | Result |
|-------|--------|
| `cargo test` (contract) | ✅ 10/10 |
| WASM build | ✅ `res/meropixart.wasm` (~1.16 MB) |
| `pnpm build` (tsc + vite) | ✅ clean |
| `pnpm lint` | ✅ 0 errors (4 benign warnings) |
| `pnpm test` (vitest) | ✅ 17/17 |
| `pnpm e2e` (playwright mocked) | ✅ 11/11 |
| Live merod rc.4: install + create project + RPC | ✅ verified |

**SDK note:** pinned `0.11.0-rc.6` for all Calimero crates via git tag (crates.io
stops at rc.5; rc.6 is a git tag only). borsh `1.6.1`. Merod runtime image in
workflows = `merod:0.11.0-rc.6`. Contract verified live (the rc.6 build also runs
on the locally-installed `merod 0.11.0-rc.4` — the host ABI is stable across RCs).

## Remaining work / follow-ups
- Advanced tools: marquee/lasso selection, crop tool, warp mesh, gradient, clone stamp, shape-draw, standalone Levels + adjustment layers.
- Playwright integration suite + merobox workflow execution (need Docker / live nodes).
- Group compositing isolation (currently approximated via inherited opacity/visibility, flat paint order).
- Project thumbnails in the gallery (placeholder checkerboard today).

---

## Build / test commands

```bash
make setup            # prereqs + build wasm + install app deps
make dev              # 2 nodes + invite + frontend (http://localhost:5176)
make build            # logic wasm + frontend dist
make unit             # vitest
make e2e              # playwright (mocked)
make workflows        # merobox e2e + logic-test
make logic-test       # cargo-side contract assertions via merobox
make stop             # kill dev nodes, free ports 2460/2461/2560/2561
cd logic && cargo test
```

## Status legend
▢ not started · ◐ in progress · ✓ done. Update this file as phases complete.
