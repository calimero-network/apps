# Frontend rewrite: battleships-aligned, clean cut

> **For agentic workers:** use `superpowers:executing-plans` or `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Rewrite the mero-drive frontend to match the battleships architecture exactly — single `MeroProvider`, mero-react hooks end-to-end, no bespoke admin-api workarounds. Prune everything that diverged.

**Architecture:**
- One `MeroProvider` at the root, `AppMode.MultiContext`
- `<ConnectButton />` is the only auth UI
- All admin-api calls go through `mero.admin.<method>()` — no `adminRequest` bridge
- One feature-scoped hook per surface area (`useDriveWorkspace`, `useFolderTree`, `useDocs`), each composed from mero-react primitives
- Minimal localStorage — preferences only, never tokens (mero-react owns those)
- React 19 + vite's `build/` out-dir to match battleships exactly

**Tech stack:** `@calimero-network/mero-react@^1.1.0`, `@calimero-network/mero-ui`, React 19, vite, react-router-dom 6

---

## Reference audit (why these phases)

Comparison of the two apps surfaced these structural deltas that the plan fixes:

| dimension | battleships | mero-drive (now) | action |
|---|---|---|---|
| provider stack | `MeroProvider` only | `MeroProvider` + `WorkspaceProvider` + `RegistryProvider` | collapse the two app-level providers into a single feature hook |
| auth UI | `<ConnectButton />` | `<ConnectButton />` (✓) | keep |
| admin-api access | `mero.admin.*` exclusively | 5 `adminRequest` sites | replace each, bridge remaining gaps via filed mero-js issues |
| namespace bootstrap | one `useNamespaceBootstrap` hook, ~80 lines | `useWorkspaceBootstrap` ~258 lines + cross-tab race dance | collapse + simplify |
| per-namespace identity | `useGroupMembers(ns).selfIdentity` | custom `useSelfIdentity` + localStorage cache + unwrap workaround | use mero-react's primitive |
| feature hook pattern | `useBattleshipsLobby` wraps the whole lobby API | folder/doc logic scattered across 10+ hooks + 2 contexts | consolidate into `useDriveWorkspace` |
| dependencies | `mero-react`, `mero-ui` (no calimero-client) | ✓ (removed earlier today) | keep; dedupe dev-deps |
| React version | 19 | 18 | upgrade |
| vite output | `build/` | `dist/` | match battleships |
| env config | `.env.example` w/ `VITE_PACKAGE_NAME` + `VITE_APPLICATION_ID` + `VITE_REGISTRY_URL` | hard-coded `DEFAULT_APPLICATION_ID` constant + URL-param override | switch to env-based |

---

## File structure (target state)

```
app/
├── .env.example                           # NEW — VITE_PACKAGE_NAME + VITE_APPLICATION_ID + VITE_REGISTRY_URL
├── vite.config.js                         # MODIFIED — outDir: 'build'
├── package.json                           # MODIFIED — react 19, drop stale dev-deps
└── src/
    ├── index.tsx                          # REWRITE — mount MeroProvider only, no bootstrap IIFEs
    ├── App.tsx                            # REWRITE — routing + auth guard, no custom session-timeout logic
    ├── pages/
    │   ├── login/Authenticate.tsx         # KEEP — already uses ConnectButton
    │   ├── landing/index.tsx              # KEEP — pure presentational
    │   └── workspace/index.tsx            # NEW — thin page that mounts WorkspaceLayout
    ├── hooks/
    │   ├── useDriveWorkspace.ts           # NEW — replaces WorkspaceContext + RegistryContext + useWorkspaceBootstrap + useSelfIdentity
    │   ├── useFolderTree.ts               # NEW — replaces useWorkspaceTree + useSubgroups composition
    │   ├── useFolderOperations.ts         # REWRITE — drop adminRequest, use mero.admin.*
    │   ├── useFolderPermissions.ts        # KEEP — already thin
    │   ├── useNamespacePermissions.ts     # KEEP
    │   ├── useMemberCaps.ts               # REWRITE — drop adminRequest
    │   ├── useDocs.ts                     # KEEP
    │   └── useDocEvents.ts                # KEEP
    ├── api/
    │   ├── registry/RegistryClient.ts     # KEEP (generated)
    │   ├── docs/DocsClient.ts             # KEEP (generated)
    │   └── adminApi.ts                    # DELETE — zero callers after phases 3-4
    ├── context/
    │   ├── WorkspaceContext.tsx           # DELETE — folded into useDriveWorkspace
    │   └── RegistryContext.tsx            # DELETE — folded into useDriveWorkspace
    └── components/                        # mostly UNTOUCHED — consume new hook
```

Net: ~440 lines of bootstrap code → ~100 lines; adminApi.ts + its 5 callers gone; one context instead of two.

---

## Phase 1: Scaffolding parity

**Goal:** Match battleships' package.json, vite config, and env surface. Foundation for the rewrite.

**Files:**
- Modify: `app/package.json`
- Modify: `app/vite.config.js`
- Create: `app/.env.example`

- [ ] **Step 1.1: Upgrade React to 19**

  Battleships uses React 19. Many mero-react internals assume 19-era behavior (refs returning void, etc.) and we've seen rendering quirks on 18. Upgrade:

  ```bash
  pnpm --dir app add react@^19.1.1 react-dom@^19.1.1
  pnpm --dir app add -D @types/react@^19 @types/react-dom@^19
  ```

- [ ] **Step 1.2: Change vite outDir to `build`**

  `app/vite.config.js`:
  ```js
  export default defineConfig({
    base: '/',
    build: {
      outDir: 'build',        // was: implicit 'dist'
    },
    plugins: [nodePolyfills(), react()],
    resolve: {
      alias: { '@': resolve(__dirname, './src') },
    },
  });
  ```

- [ ] **Step 1.3: Create `app/.env.example`**

  ```
  VITE_PACKAGE_NAME=com.calimero.mero-drive-docs
  VITE_APPLICATION_ID=GfksPg4kLyLEkN5cRKvZ69rMRgD4gaM8VLxJAWQitDCq
  VITE_REGISTRY_URL=https://apps.calimero.network
  ```

- [ ] **Step 1.4: Verify build + test still pass**

  ```bash
  pnpm --dir app install
  pnpm --dir app lint
  pnpm --dir app test
  pnpm --dir app build
  ```
  Expected: all green.

- [ ] **Step 1.5: Commit**

  ```bash
  git add app/package.json app/vite.config.js app/.env.example app/pnpm-lock.yaml
  git commit -m "chore(app): scaffolding parity with battleships (react 19 + build outDir)"
  ```

---

## Phase 2: Simplify index.tsx + App.tsx to battleships shape

**Goal:** One provider, nothing fancy. No pre-mount IIFEs, no session-timeout in `App.tsx`. All config comes from env vars.

**Files:**
- Rewrite: `app/src/index.tsx`
- Rewrite: `app/src/App.tsx`
- Modify: `app/src/constants/config.ts` (strip `getApplicationId` — env vars replace it)

- [ ] **Step 2.1: Rewrite `app/src/index.tsx`**

  ```tsx
  import React, { StrictMode } from 'react';
  import ReactDOM from 'react-dom/client';
  import '@calimero-network/mero-ui/styles.css';
  import './index.css';
  import App from './App';

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  ```

  Delete: bootstrap IIFEs, `setMeroApplicationId` call, service-worker cleanup (move to App.tsx if kept).

- [ ] **Step 2.2: Rewrite `app/src/App.tsx`**

  ```tsx
  import React from 'react';
  import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
  import { AppMode, MeroProvider } from '@calimero-network/mero-react';
  import { ToastProvider } from '@calimero-network/mero-ui';
  import { TooltipProvider } from '@/components/ui/tooltip';
  import { ConfirmProvider } from '@/components/ui/confirm-dialog';

  import LandingPage from './pages/landing';
  import Authenticate from './pages/login/Authenticate';
  import WorkspacePage from './pages/workspace';

  export default function App() {
    const packageName = import.meta.env.VITE_PACKAGE_NAME?.trim() || undefined;
    const registryUrl = import.meta.env.VITE_REGISTRY_URL?.trim() || undefined;

    return (
      <MeroProvider
        mode={AppMode.MultiContext}
        packageName={packageName}
        registryUrl={registryUrl}
      >
        <ToastProvider>
          <TooltipProvider>
            <ConfirmProvider>
              <BrowserRouter>
                <Routes>
                  <Route path="/" element={<LandingPage />} />
                  <Route path="/login" element={<Authenticate />} />
                  <Route path="/app/*" element={<WorkspacePage />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </BrowserRouter>
            </ConfirmProvider>
          </TooltipProvider>
        </ToastProvider>
      </MeroProvider>
    );
  }
  ```

  Removed: `AuthedRoute` (moved inside `WorkspacePage`), session-timeout logic, cache-clearing on logout (moved into `useDriveWorkspace`).

- [ ] **Step 2.3: Create `app/src/pages/workspace/index.tsx` with auth guard**

  Mirrors battleships' per-page guard pattern (avoids transient redirects during mero-react init):

  ```tsx
  import React, { useEffect } from 'react';
  import { useLocation, useNavigate } from 'react-router-dom';
  import { useMero } from '@calimero-network/mero-react';
  import { WorkspaceLayout } from '@/components/workspace/WorkspaceLayout';

  export default function WorkspacePage() {
    const { isAuthenticated, isLoading } = useMero();
    const navigate = useNavigate();
    const location = useLocation();

    useEffect(() => {
      if (!isLoading && !isAuthenticated) {
        navigate('/login', { state: { returnTo: location.pathname } });
      }
    }, [isLoading, isAuthenticated, navigate, location]);

    if (isLoading || !isAuthenticated) return null;
    return <WorkspaceLayout />;
  }
  ```

- [ ] **Step 2.4: Simplify `app/src/constants/config.ts`**

  Strip `getApplicationId`, `getUrlParam` — env vars are read directly in `App.tsx` and hooks. Keep only `REGISTRY_SERVICE_ID`, `DOCS_SERVICE_ID`, `REGISTRY_CONTEXT_ALIAS`, `MAX_ALIAS_LENGTH`, `MAX_FOLDER_DEPTH`, `CAP` bits.

- [ ] **Step 2.5: Verify lint/test/build**

  ```bash
  pnpm --dir app lint && pnpm --dir app test && pnpm --dir app build
  ```
  Expected: all green. App loads, ConnectButton works, `/app/*` redirects to `/login` when unauthenticated.

- [ ] **Step 2.6: Commit**

  ```bash
  git add app/src/
  git commit -m "refactor(app): single MeroProvider + env-based config (matches battleships root shape)"
  ```

---

## Phase 3: Collapse bootstrap chain into `useDriveWorkspace`

**Goal:** Delete `WorkspaceContext`, `RegistryContext`, `useSelfIdentity`, `useWorkspaceBootstrap`. Replace with one hook that mirrors battleships' `useBattleshipsLobby` pattern. This is the biggest change and the one where most of the current bugs live.

**Files:**
- Create: `app/src/hooks/useDriveWorkspace.ts`
- Delete: `app/src/context/WorkspaceContext.tsx`
- Delete: `app/src/context/RegistryContext.tsx`
- Delete: `app/src/hooks/useWorkspaceBootstrap.ts`
- Delete: `app/src/hooks/useSelfIdentity.ts`
- Modify: every consumer of `useWorkspace()` / `useRegistry()` / `useSelfIdentity()` to use the new hook

- [ ] **Step 3.1: Write failing integration test**

  `app/src/hooks/__tests__/useDriveWorkspace.test.tsx`:

  ```tsx
  import { describe, it, expect, vi } from 'vitest';
  import { renderHook, waitFor } from '@testing-library/react';
  import { useDriveWorkspace } from '../useDriveWorkspace';

  vi.mock('@calimero-network/mero-react', () => ({
    useMero: () => ({
      mero: {
        admin: {
          createNamespace: vi.fn().mockResolvedValue({ namespaceId: 'ns-new' }),
          getNamespaceIdentity: vi.fn().mockResolvedValue({ publicKey: 'pk-1', namespaceId: 'ns-new' }),
        },
      },
      applicationId: 'app-1',
      contextIdentity: 'pk-1',
      isAuthenticated: true,
      isLoading: false,
    }),
    useNamespacesForApplication: () => ({ namespaces: [{ id: 'ns-new' }], refetch: vi.fn() }),
    useGroupMembers: () => ({ members: [], selfIdentity: 'pk-1', loading: false }),
    useSubgroups: () => ({ subgroups: [], loading: false, refetch: vi.fn() }),
  }));

  describe('useDriveWorkspace', () => {
    it('creates a namespace and switches to it', async () => {
      const { result } = renderHook(() => useDriveWorkspace());
      await waitFor(() => expect(result.current.loading).toBe(false));
      await result.current.createWorkspace('alpha');
      await waitFor(() => expect(result.current.selectedNamespaceId).toBe('ns-new'));
      expect(result.current.selfIdentity).toBe('pk-1');
    });
  });
  ```

- [ ] **Step 3.2: Run the test — verify it fails**

  Expected: "Cannot find module '../useDriveWorkspace'". Proves the test runs.

- [ ] **Step 3.3: Write `app/src/hooks/useDriveWorkspace.ts` (minimum to pass)**

  Modeled on battleships' `useBattleshipsLobby`. Key surface:

  ```ts
  export interface DriveWorkspace {
    // identity
    selfIdentity: string | null;

    // namespace list + selection
    namespaces: Namespace[];
    selectedNamespaceId: string | null;
    selectNamespace: (id: string | null) => void;

    // creation
    createWorkspace: (alias: string) => Promise<string | null>;

    // status
    loading: boolean;
    error: Error | null;
  }
  ```

  Implementation (abbreviated — see battleships' `useBattleshipsLobby.ts` for the full pattern):

  ```ts
  export function useDriveWorkspace(): DriveWorkspace {
    const { mero, applicationId, contextIdentity } = useMero();
    const { namespaces, refetch } = useNamespacesForApplication(applicationId ?? '');
    const [selected, setSelected] = useLocalStorage<string | null>('mero-drive:activeNs', null);
    const { selfIdentity } = useGroupMembers(selected ?? '');

    const createWorkspace = useCallback(async (alias: string) => {
      if (!mero || !applicationId) return null;
      const ns = await mero.admin.createNamespace({
        applicationId,
        upgradePolicy: 'Automatic',
        alias,
      });
      await refetch();
      setSelected(ns.namespaceId);
      return ns.namespaceId;
    }, [mero, applicationId, refetch, setSelected]);

    return {
      selfIdentity: selfIdentity ?? contextIdentity,
      namespaces,
      selectedNamespaceId: selected,
      selectNamespace: setSelected,
      createWorkspace,
      loading: !applicationId || !mero,
      error: null,
    };
  }
  ```

  **No `adminRequest`, no `mero-drive:selfId:*` cache, no cross-tab race dance.** Per-namespace identity comes from `useGroupMembers(namespaceId).selfIdentity` — which is the pattern battleships uses and is documented in the mero-react API.

- [ ] **Step 3.4: Run the test — verify it passes**

- [ ] **Step 3.5: Add `useLocalStorage` helper**

  `app/src/hooks/useLocalStorage.ts` — a tiny SSR-safe wrapper:

  ```ts
  export function useLocalStorage<T>(key: string, initial: T): [T, (v: T) => void] {
    const [value, setValue] = useState<T>(() => {
      if (typeof window === 'undefined') return initial;
      try {
        const raw = localStorage.getItem(key);
        return raw !== null ? (JSON.parse(raw) as T) : initial;
      } catch {
        return initial;
      }
    });
    const set = useCallback((v: T) => {
      setValue(v);
      try {
        if (v === null || v === undefined) localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify(v));
      } catch { /* ignore */ }
    }, [key]);
    return [value, set];
  }
  ```

- [ ] **Step 3.6: Migrate consumers**

  Replace `useWorkspace()` and `useRegistry()` imports across the app with `useDriveWorkspace()`. Affected files (exhaustive list — derive from `grep -rln "useWorkspace\|useRegistry" app/src`):

  - `components/workspace/WorkspaceLayout.tsx`
  - `components/workspace/NamespaceSwitcher.tsx`
  - `components/workspace/NamespaceCreateDialog.tsx` (use `createWorkspace` instead of direct `mero.admin.createNamespace`)
  - `components/workspace/NamespaceMembersPanel.tsx`
  - `components/workspace/NamespaceSettingsPanel.tsx`
  - `components/folders/FolderTree.tsx`
  - `components/folders/FolderBreadcrumb.tsx`
  - `components/folders/FolderSharingPanel.tsx`
  - `components/docs/DocumentList.tsx`
  - `components/docs/DocumentEditor.tsx`
  - `components/admin/*`
  - any hook that currently depends on `WorkspaceContext` (useFolderOperations, useReconcile, etc.)

- [ ] **Step 3.7: Delete the orphaned files**

  ```bash
  git rm app/src/context/WorkspaceContext.tsx
  git rm app/src/context/RegistryContext.tsx
  git rm app/src/hooks/useWorkspaceBootstrap.ts
  git rm app/src/hooks/useSelfIdentity.ts
  git rm app/src/hooks/__tests__/useSelfIdentity.test.ts
  rmdir app/src/context 2>/dev/null || true
  ```

- [ ] **Step 3.8: Verify full suite**

  ```bash
  pnpm --dir app lint && pnpm --dir app test && pnpm --dir app build
  ```

- [ ] **Step 3.9: Commit**

  ```bash
  git add -A
  git commit -m "refactor(app): single useDriveWorkspace hook — drop WorkspaceContext + RegistryContext + custom bootstrap"
  ```

---

## Phase 4: Eliminate `adminRequest` bridge

**Goal:** Every admin-api call goes through `mero.admin.*`. Delete `app/src/api/adminApi.ts`.

**Files:**
- Delete: `app/src/api/adminApi.ts`
- Modify: `app/src/hooks/useFolderOperations.ts` (1 call)
- Modify: `app/src/hooks/useMemberCaps.ts` (1 call)
- Modify: `app/src/hooks/useReconcile.ts` (if present)

(Phase 3 already removed the identity + alias callers.)

- [ ] **Step 4.1: Port `useFolderOperations` reparent call**

  Current:
  ```ts
  await adminRequest(`/groups/reparent`, { method: 'POST', body: JSON.stringify({ ... }) });
  ```

  Replace with mero-react's `useNestGroup` / `useUnnestGroup` (already imported elsewhere in the app) or `mero.admin.nestGroup(...)` / `unnestGroup(...)`. Verify the hook exists — if not, file a mero-js issue and keep a single temporary escape hatch with a clear comment.

- [ ] **Step 4.2: Port `useMemberCaps` identity → cap bitmask call**

  Current: `adminRequest<{ capabilities: number }>('/groups/:id/members/:identity')`.

  Replace with `useGroupCapabilities(groupId, memberId)` from mero-react (returns `{ capabilities, loading, setCapabilities }`). Already imported in `MemberRoleSelect`.

- [ ] **Step 4.3: Delete `adminApi.ts`**

  ```bash
  git rm app/src/api/adminApi.ts
  ```

- [ ] **Step 4.4: Verify no callers remain**

  ```bash
  grep -rn "adminRequest" app/src && echo "FAIL: stragglers" || echo "OK: clean"
  ```

- [ ] **Step 4.5: Verify full suite**

- [ ] **Step 4.6: Commit**

  ```bash
  git add -A
  git commit -m "refactor(app): drop adminApi.ts bridge — every admin call via mero.admin.*"
  ```

---

## Phase 5: Feature-hook consolidation (folder + doc)

**Goal:** Collapse the folder hook family (`useFolderTree`, `useFolderOperations`, `useFolderCascade`, `useFolderMembership`) into two hooks, mirroring battleships' feature-hook pattern.

**Files:**
- Rewrite: `app/src/hooks/useFolderTree.ts` — replaces `useWorkspaceTree` + in-line `useSubgroups` composition
- Rewrite: `app/src/hooks/useFolderOperations.ts`
- Delete: `app/src/hooks/useWorkspaceTree.ts`, `useFolderCascade.ts` (fold into `useFolderOperations`)

- [ ] **Step 5.1: Write `useFolderTree(rootGroupId, registryClient)` returning `{ folders, loading, error }`**

- [ ] **Step 5.2: Write `useFolderOperations(rootGroupId, registryClient)` exposing `{ create, rename, remove, move, setVisibility }`**

- [ ] **Step 5.3: Migrate consumers** (FolderTree.tsx, FolderContextMenu.tsx, NewFolderButton.tsx, NewFolderDialog.tsx, FolderVisibilityToggle.tsx, FolderSharingPanel.tsx)

- [ ] **Step 5.4: Delete orphaned hooks**

- [ ] **Step 5.5: Verify + commit**

  ```bash
  git commit -m "refactor(app): feature-scoped folder hooks (battleships pattern)"
  ```

---

## Phase 6: Stale-code + stale-comment pass

**Goal:** Final sweep. Remove every comment referencing deleted modules; prune `scripts/` leftovers.

- [ ] **Step 6.1: Search for stale comments**

  ```bash
  grep -rn "CalimeroProvider\|calimero-client\|useCalimero\|getAppEndpointKey\|WorkspaceContext\|RegistryContext\|useSelfIdentity\|useWorkspaceBootstrap\|adminRequest" app/src docs/
  ```

  Each hit → either fix the reference or delete the comment.

- [ ] **Step 6.2: Audit `scripts/`** — `sync-wasm.sh`, `registry-sync.sh`, `on-res-change.mjs` all reference pre-v9 single-service layout paths (`logic/res/kv_store.wasm`, `res/abi.json`). Either update to per-crate v9 paths or delete if unused.

- [ ] **Step 6.3: Update README** to reflect env-based config + new hook surface.

- [ ] **Step 6.4: Final verify**

  ```bash
  pnpm --dir app lint && pnpm --dir app test && pnpm --dir app build
  pnpm run logic:build
  ```

- [ ] **Step 6.5: Commit**

  ```bash
  git commit -m "chore(app): stale-comment + stale-script cleanup pass"
  ```

---

## Phase 7: PR + manual verification

- [ ] **Step 7.1: Open PR** stacked on the current `chore/drop-orphan-logic-manifest` branch (or a new branch off master if the current one is merged first). PR body enumerates each phase + before/after LOC counts.

- [ ] **Step 7.2: Manual test plan** (user runs these):
  - Fresh checkout → `pnpm install` → `pnpm --dir app dev` → click Connect → OAuth → land on `/app`
  - Create workspace "alpha" → folder tree loads without spinner stall
  - Create a folder inside alpha → appears in tree
  - Create a document → edit → autosave indicator reaches 'saved'
  - Log out → lands back on `/` → re-login → state restored

- [ ] **Step 7.3: File upstream bugs for the two mero-js issues we're working around:**
  - `unwrap()` assumes `{data}` wrapper but core serializes at top level
  - `useAsyncMutation.run` swallows real errors into `null` return (also filed? check)

---

## Out of scope

- Logic-layer changes (Rust crates untouched this round)
- E2E workflow changes
- Visual redesign
- Registry-alias race handling (dropped — battleships doesn't need it because every namespace has exactly one lobby context, created at namespace-creation time, not lazily)

## Expected outcome

- Source LOC in `app/src/context/` + `app/src/hooks/{useWorkspaceBootstrap,useSelfIdentity,useWorkspaceTree,useFolderCascade}.ts` + `app/src/api/adminApi.ts`: ~700 lines deleted
- New code in `app/src/hooks/{useDriveWorkspace,useFolderTree,useLocalStorage}.ts`: ~250 lines
- Net: **~450 LOC removed**, behavioral parity with current happy path, fewer failure modes
- Matches battleships' provider shape, hook shape, env-config pattern, and vite output exactly — future mero-react updates land cleanly in both apps
