// WorkspaceDriver — Page Object wrapping the mero-drive workspace
// UI surface for e2e tests.
//
// The driver gives specs a vocabulary that reads like a user story:
//   await alice.createNamespace('Project Phoenix');
//   await alice.createFolder({ name: 'Specs', visibility: 'Open' });
//   await alice.tree.openFolder('Specs');
//   await alice.createDoc('Sync Test');
//
// rather than bleeding raw locators into every spec. When the UI
// changes, this file is the single place that needs updating.
//
// Convention: every method awaits the post-action settle state before
// returning, so the next call in a sequence doesn't race the UI.

import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';

export type Visibility = 'Open' | 'Restricted';

export interface CreateFolderOptions {
  name: string;
  visibility: Visibility;
  parent?: string;
}

interface DriverOptions {
  label?: string;
}

export class WorkspaceDriver {
  readonly page: Page;
  readonly label: string;
  readonly tree: FolderTreeDriver;
  readonly restrictedCard: RestrictedCardDriver;
  readonly sharing: SharingDriver;
  readonly docs: DocListDriver;
  readonly editor: EditorDriver;
  readonly settings: SettingsDriver;

  constructor(page: Page, opts: DriverOptions = {}) {
    this.page = page;
    this.label = opts.label ?? 'user';
    this.tree = new FolderTreeDriver(page);
    this.restrictedCard = new RestrictedCardDriver(page);
    this.sharing = new SharingDriver(page);
    this.docs = new DocListDriver(page);
    this.editor = new EditorDriver(page);
    this.settings = new SettingsDriver(page);
  }

  async goToWorkspace(): Promise<void> {
    await this.page.goto('/app');
    // Wait for either the top bar (workspace shell) or a redirect to
    // landing/login. The Settings button only renders when a
    // namespace is selected; the NamespaceSwitcher select renders as
    // soon as the shell mounts.
    await expect(this.page.locator('select').first()).toBeVisible({
      timeout: 30_000,
    });
  }

  // Private: performs the dialog steps only (no gate dismiss).
  private async createNamespaceRaw(name: string): Promise<void> {
    await this.page
      .getByRole('button', { name: /New workspace/i })
      .click();
    // Scope to the creation dialog specifically (the one holding the
    // "Workspace name" input). The instant Create succeeds, the
    // DisplayNameGate — also role="dialog" — appears, so an unscoped
    // getByRole('dialog') matches TWO elements and the toBeHidden below
    // hits a strict-mode violation. Filtering by the input it contains
    // pins this to the creation dialog, which has no name input once it
    // closes (so toBeHidden resolves while the gate is up).
    const dialog = this.page
      .getByRole('dialog')
      .filter({ has: this.page.getByPlaceholder(/Workspace name/i) });
    await dialog.getByPlaceholder(/Workspace name/i).fill(name);
    await dialog.getByRole('button', { name: /^Create$/ }).click();
    // Creation dialog closes (the name gate may now be showing).
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await expect(this.page.locator('select').first()).toContainText(name, {
      timeout: 15_000,
    });
  }

  // Dismiss the required display-name gate by setting a name. The gate
  // blocks the sidebar + main pane after create/join until a name is set.
  async dismissNameGate(displayName = this.label): Promise<void> {
    const gate = this.page.getByRole('dialog', { name: /Set your name/i });
    await expect(gate).toBeVisible({ timeout: 20_000 });
    await gate.getByPlaceholder('Your display name').fill(displayName);
    await gate.getByRole('button', { name: /^Continue$/ }).click();
    await expect(gate).toBeHidden({ timeout: 20_000 });
  }

  // Dismiss the gate only if it appears (joiner may already be named,
  // e.g. re-join / future scenario). Falls back silently if no gate.
  async dismissNameGateIfPresent(displayName = this.label): Promise<void> {
    const gate = this.page.getByRole('dialog', { name: /Set your name/i });
    try {
      await expect(gate).toBeVisible({ timeout: 20_000 });
    } catch {
      return; // no gate — already named
    }
    await gate.getByPlaceholder('Your display name').fill(displayName);
    await gate.getByRole('button', { name: /^Continue$/ }).click();
    await expect(gate).toBeHidden({ timeout: 20_000 });
  }

  async createNamespace(name: string): Promise<void> {
    await this.createNamespaceRaw(name);
    await this.dismissNameGate();
  }

  // Like createNamespace but does NOT dismiss the gate — used by the
  // gate spec to assert the gate is blocking.
  async createNamespaceKeepGate(name: string): Promise<void> {
    await this.createNamespaceRaw(name);
  }

  // Selects a namespace from the top-bar select. Use the namespace
  // name (matched as the visible option label) — switching by id is
  // brittle since ids are minted at runtime. `selectOption({ label })`
  // wants a literal string; regex is rejected with "expected string,
  // got object".
  async switchNamespace(name: string): Promise<void> {
    await this.page
      .locator('select')
      .first()
      .selectOption({ label: name });
  }

  // Open the invite like the deep-link landing does, accept, land on
  // /app. Invite URLs are links.calimero.network deep links; the landing
  // forwards the full query string to the frontend ROOT, where
  // InviteRedirect funnels it to /join. We reproduce that hand-off
  // against the local dev server (auth tokens are already injected, so
  // the page renders the accept CTA directly, no ConnectButton detour).
  async joinNamespace(inviteUrl: string): Promise<void> {
    const parsed = new URL(inviteUrl, 'http://placeholder');
    await this.page.goto(`/${parsed.search}`);
    await this.page
      .getByRole('button', { name: /Accept & join/i })
      .click();
    await expect(this.page).toHaveURL(/\/app/, { timeout: 30_000 });
    await this.dismissNameGateIfPresent();
  }

  // Opens the namespace settings pane.
  async openSettings(): Promise<void> {
    await this.page.getByRole('button', { name: /Settings/i }).click();
    await expect(
      this.page.getByText(/Your display name/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  }

  async closeSettings(): Promise<void> {
    // Settings button is a toggle; clicking again collapses.
    await this.page.getByRole('button', { name: /Settings/i }).click();
  }

  async logout(): Promise<void> {
    await this.page.getByRole('button', { name: /Log out/i }).click();
  }

  // ─── folder creation ───────────────────────────────────────────

  async createFolder(opts: CreateFolderOptions): Promise<void> {
    if (opts.parent) {
      // Nested: open parent's "Folder actions" menu and click
      // "New subfolder". Dialog shape is identical to the
      // tree-level create.
      await this.tree.openContextMenu(opts.parent);
      await this.page
        .getByRole('menuitem', { name: /New subfolder/i })
        .click();
    } else {
      // Scope the "New" button to the FolderTree's <aside>. There
      // are multiple "New" buttons in the workspace shell (folder
      // tree, doc list); the role+name locator would otherwise
      // match the first DOM occurrence non-deterministically.
      await this.page
        .locator('aside')
        .getByRole('button', { name: /^New$/ })
        .click();
    }
    const dialog = this.page.getByRole('dialog');
    await dialog.getByPlaceholder(/Folder name/i).fill(opts.name);
    // NewFolderDialog renders visibility as a pair of toggle
    // BUTTONS, not radios. "Open" is pressed by default; only
    // click when the caller asked for Restricted.
    if (opts.visibility === 'Restricted') {
      await dialog.getByRole('button', { name: /^Restricted/i }).click();
    }
    await dialog.getByRole('button', { name: /^Create$/ }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await this.tree.expectFolderVisible(opts.name);
  }

  async renameFolder(currentName: string, newName: string): Promise<void> {
    await this.tree.openContextMenu(currentName);
    await this.page.getByRole('menuitem', { name: /Rename/i }).click();
    // FolderTreeItem renders the inline rename input as a plain
    // <input> with no explicit `type` attribute (defaults to text
    // per the HTML spec, but `input[type="text"]` CSS selector
    // requires the literal attribute). The autoFocus + the fact it
    // appears inside an <aside> li are stable signals.
    const input = this.page.locator('aside li input:focus').first();
    await input.fill(newName);
    await input.press('Enter');
    await this.tree.expectFolderVisible(newName);
  }

  async deleteFolder(name: string): Promise<void> {
    await this.tree.openContextMenu(name);
    await this.page.getByRole('menuitem', { name: /Delete/i }).click();
    const confirm = this.page.getByRole('dialog');
    await confirm.getByRole('button', { name: /Delete|Confirm/i }).click();
    await expect(confirm).toBeHidden({ timeout: 15_000 });
    await this.tree.expectFolderHidden(name);
  }

  // Opens the Info modal for a folder via the ⋯ context menu.
  async openFolderInfo(folderName: string): Promise<void> {
    await this.tree.openContextMenu(folderName);
    await this.page.getByRole('menuitem', { name: /^Info$/ }).click();
    await expect(
      this.page.getByRole('dialog', { name: folderName }),
    ).toBeVisible({ timeout: 15_000 });
  }

  async closeFolderInfo(): Promise<void> {
    // Close button inside the Info dialog.
    await this.page
      .getByRole('dialog')
      .getByRole('button', { name: /^Close$/ })
      .click();
  }

  async toggleVisibility(folderName: string): Promise<void> {
    await this.openFolderInfo(folderName);
    // FolderVisibilityToggle renders a button: "Make restricted" (Open→) or "Make open" (Restricted→).
    await this.page
      .getByRole('dialog')
      .getByRole('button', { name: /Make (open|restricted)/i })
      .click();
    await this.closeFolderInfo();
  }

  // ─── docs ──────────────────────────────────────────────────────

  async createDoc(title: string): Promise<void> {
    // DocumentList's "New document" button creates a doc named "Untitled" and
    // opens the editor immediately — there's no create-dialog with a
    // title input. To get a named doc we click New document, wait for the
    // editor to mount, rename via the EditorHeader's editable title,
    // close the editor, and assert the row.
    //
    // Scope New document to <main> so we don't match the FolderTree's "New"
    // (aside) button.
    await this.page
      .locator('main')
      .getByRole('button', { name: /^New document$/ })
      .click();
    await this.editor.expectMounted();
    await this.editor.renameTitle(title);
    await this.editor.close();
    await this.docs.expectDocVisible(title);
  }

  async openDoc(title: string): Promise<void> {
    await this.docs.clickDoc(title);
    await this.editor.expectMounted();
  }

  // ─── namespace settings helpers ────────────────────────────────

  async setMyDisplayName(name: string): Promise<void> {
    await this.openSettings();
    await this.settings.setMyDisplayName(name);
    await this.closeSettings();
  }
}

// ─── sub-drivers ────────────────────────────────────────────────

export class FolderTreeDriver {
  constructor(private page: Page) {}

  folderRow(name: string): Locator {
    // Target the row <div> (direct child of <li>), not the <li> itself.
    // When a folder is expanded, the <li>'s textContent accumulates all
    // descendant doc/subfolder names — the anchored regex would no longer
    // match. The row <div> holds only the chevron, icon, name span, and
    // actions button, so its textContent stays stable regardless of
    // expansion state.
    return this.page
      .locator('aside li > div')
      .filter({ hasText: new RegExp(`^\\s*${escapeRegex(name)}\\s*$`, 'i') });
  }

  async expectFolderVisible(name: string, opts: { timeout?: number } = {}) {
    await expect(this.folderRow(name).first()).toBeVisible({
      timeout: opts.timeout ?? 30_000,
    });
  }

  async expectFolderHidden(name: string, opts: { timeout?: number } = {}) {
    await expect(this.folderRow(name).first()).toBeHidden({
      timeout: opts.timeout ?? 15_000,
    });
  }

  // Expand a folder so its document leaves render. Selecting (clicking the
  // row) does NOT expand — expansion is the chevron. No-op if already expanded.
  async expandFolder(name: string): Promise<void> {
    const row = this.folderRow(name).first();
    const expandBtn = row.getByRole('button', { name: 'Expand' });
    if (await expandBtn.count()) {
      await expandBtn.click();
    }
  }

  // Select a folder AND ensure it is expanded so its doc leaves render.
  async openFolder(name: string): Promise<void> {
    await this.folderRow(name).first().click(); // select → FolderEmptyState in <main>
    await this.expandFolder(name);              // expand → doc leaves in sidebar
  }

  async openContextMenu(name: string): Promise<void> {
    // FolderTreeItem renders a 3-dot "Folder actions" button on the
    // row; clicking it opens the radix DropdownMenu. (Right-click is
    // NOT bound — the row uses the dropdown trigger pattern, not a
    // native context menu.)
    //
    // FolderVisibilityToggle gates its menuitem on `current !==
    // undefined`, and `current` is loaded asynchronously by the
    // parent's per-folder getGroupInfo fetch. If we open the menu
    // before that resolves the menuitem just isn't rendered (the
    // menu is a snapshot at open time). So wait for the trigger
    // button to be ready AND give the menu a brief settle window
    // — `openFolder` having been called should already have queued
    // the visibility fetch, this is the courtesy poll.
    const trigger = this.folderRow(name)
      .first()
      .getByRole('button', { name: /Folder actions/i });
    await expect(trigger).toBeVisible({ timeout: 30_000 });
    await trigger.click();
  }
}

export class RestrictedCardDriver {
  constructor(private page: Page) {}

  async expectAskAdmin(opts: { timeout?: number } = {}) {
    await expect(
      this.page.getByRole('heading', { name: /This folder is restricted/i }),
    ).toBeVisible({ timeout: opts.timeout ?? 30_000 });
  }

  async expectSyncing(opts: { timeout?: number } = {}) {
    await expect(
      this.page.getByRole('heading', { name: /Workspace is still syncing/i }),
    ).toBeVisible({ timeout: opts.timeout ?? 30_000 });
  }

  async expectJoinCTA(opts: { timeout?: number } = {}) {
    await expect(
      this.page.getByRole('heading', { name: /Join this open folder/i }),
    ).toBeVisible({ timeout: opts.timeout ?? 30_000 });
  }

  async clickJoin(opts: { timeout?: number } = {}): Promise<void> {
    await this.page
      .getByRole('button', { name: /^(Join folder|Try joining)$/ })
      .click();
    // Wait for the card to unmount — useFolderPermissions
    // re-evaluates after RestrictedFolderCard's
    // `useJoinSubgroupInheritance` call (core PR #2360 — one HTTP
    // round-trip that materialises subgroup membership + receives
    // the subgroup key), then the parent swaps to the real folder UI.
    await expect(
      this.page.getByRole('heading', {
        name: /Join this open folder|Workspace is still syncing|This folder is restricted/i,
      }),
    ).toBeHidden({ timeout: opts.timeout ?? 60_000 });
  }

  async clickRefresh(): Promise<void> {
    await this.page.getByRole('button', { name: /^Refresh$/ }).click();
  }

  async copyIdentity(): Promise<string> {
    const input = this.page.locator('#restricted-identity-text');
    return await input.inputValue();
  }
}

export class SharingDriver {
  constructor(private page: Page) {}

  async addMember(identity: string): Promise<void> {
    const input = this.page.getByPlaceholder(/identity pubkey/i);
    await input.fill(identity);
    await this.page.getByRole('button', { name: /^Add$/ }).click();
    await expect(input).toHaveValue('', { timeout: 10_000 });
  }

  async removeMember(label: string): Promise<void> {
    await this.page
      .getByRole('button', { name: new RegExp(`Remove\\s+${escapeRegex(label)}`, 'i') })
      .click();
  }

  async expectMemberVisible(label: string, opts: { timeout?: number } = {}) {
    await expect(
      this.page.locator('li').filter({ hasText: label }).first(),
    ).toBeVisible({ timeout: opts.timeout ?? 30_000 });
  }

  // Returns the link-invite token via the "Invite to this folder
  // only" dialog. Uses the navigator.clipboard.readText shim from
  // tests (Playwright grants clipboard-read by default in Chromium).
  async copyFolderInvite(): Promise<string> {
    await this.page
      .getByRole('button', { name: /Invite to this folder only/i })
      .click();
    const dialog = this.page.getByRole('dialog', { name: /Invite to folder/i });
    await dialog.getByRole('button', { name: /Copy/i }).click();
    const token = await this.page.evaluate(() =>
      navigator.clipboard.readText(),
    );
    await dialog.getByRole('button', { name: /Close|Done/i }).click();
    return token;
  }
}

export class DocListDriver {
  constructor(private page: Page) {}

  docRow(title: string): Locator {
    return this.page
      .locator('aside li button')
      .filter({ hasText: new RegExp(`^${escapeRegex(title)}$`) });
  }

  async expectDocVisible(title: string, opts: { timeout?: number } = {}) {
    await expect(this.docRow(title).first()).toBeVisible({
      timeout: opts.timeout ?? 30_000,
    });
  }

  async expectDocHidden(title: string, opts: { timeout?: number } = {}) {
    await expect(this.docRow(title).first()).toBeHidden({
      timeout: opts.timeout ?? 15_000,
    });
  }

  async clickDoc(title: string): Promise<void> {
    await this.docRow(title).first().click();
  }
}

export class EditorDriver {
  constructor(private page: Page) {}

  async expectMounted(opts: { timeout?: number } = {}) {
    // BlockNote renders its ProseMirror surface inside `.bn-container`.
    // `.first()` guards against the transient aux ProseMirror instances
    // BlockNote spawns for popups (link edit, etc.).
    await expect(this.page.locator('.ProseMirror').first()).toBeVisible({
      timeout: opts.timeout ?? 30_000,
    });
  }

  async type(content: string): Promise<void> {
    const editor = this.page.locator('.ProseMirror').first();
    await editor.click();
    // pressSequentially sends real keystrokes through ProseMirror's input
    // pipeline so BlockNote's onChange (and therefore autosave) fires —
    // fill() sets the DOM directly and the editor may not observe it.
    await editor.pressSequentially(content);
  }

  async expectContent(content: string, opts: { timeout?: number } = {}) {
    await expect(this.page.locator('.ProseMirror').first()).toContainText(
      content,
      { timeout: opts.timeout ?? 30_000 },
    );
  }

  async close(): Promise<void> {
    await this.page.getByRole('button', { name: /^Documents$/ }).click();
  }

  // EditorHeader renders the doc name as a <button>; clicking flips
  // it into an inline <input type="text"> (with autoFocus). Enter
  // commits the rename via the onKeyDown handler.
  async renameTitle(next: string): Promise<void> {
    // A fresh doc is named "Untitled". It renders in TWO places at once:
    // the editor-header title button (in <main>) AND a doc-leaf button in
    // the sidebar tree (in <aside>, role="complementary"). Scope to <main>
    // so the exact-name match resolves to the header title button only —
    // otherwise it's a strict-mode violation against the sidebar leaf.
    await this.page
      .getByRole('main')
      .getByRole('button', { name: 'Untitled', exact: true })
      .click();
    const input = this.page.locator('main input[type="text"]:focus');
    await input.fill(next);
    await input.press('Enter');
  }

  async deleteDocument(): Promise<void> {
    // EditorHeader renders a 3-dot trigger with an explicit
    // aria-label="Document actions"; that's the only consumer of
    // the dropdown so the literal match is safe.
    await this.page
      .getByRole('button', { name: /Document actions/i })
      .click();
    await this.page
      .getByRole('menuitem', { name: /Delete Document/i })
      .click();
    const confirm = this.page.getByRole('dialog');
    if (await confirm.count()) {
      await confirm.getByRole('button', { name: /Delete|Confirm/i }).click();
    }
  }
}

export class SettingsDriver {
  constructor(private page: Page) {}

  async setMyDisplayName(name: string): Promise<void> {
    const panel = this.page.locator('[data-testid="my-display-name-panel"]');
    await expect(panel).toBeVisible({ timeout: 10_000 });
    const input = panel.locator('input[type="text"]');
    await input.fill(name);
    const saveBtn = panel.getByRole('button', { name: /^Save$/ });
    // Wait for the actual PUT round-trip to complete before
    // returning, otherwise a follow-up closeSettings() can unmount
    // the panel mid-write and the next mount races mero-react's
    // cache. Wait both for the network response AND for the dirty
    // flag to clear (Save disables when refetched name === draft).
    const savePromise = this.page.waitForResponse(
      (r) =>
        r.request().method() === 'PUT' &&
        /\/members\/[^/]+\/metadata$/.test(r.url()) &&
        r.status() < 400,
      { timeout: 15_000 },
    );
    await saveBtn.click();
    await savePromise;
    await expect(saveBtn).toBeDisabled({ timeout: 15_000 });
    await expect(input).toHaveValue(name, { timeout: 15_000 });
  }

  // Open the namespace InviteDialog (path: Settings → MembersPanel →
  // "Invite" button → "Generate invite link" → read input), return
  // the produced /join URL. Caller responsible for opening Settings
  // first.
  async copyNamespaceInvite(): Promise<string> {
    await this.page.getByRole('button', { name: /^Invite$/ }).click();
    const dialog = this.page.getByRole('dialog', {
      name: /Invite to workspace/i,
    });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await dialog
      .getByRole('button', { name: /Generate invite link/i })
      .click();
    const urlInput = dialog.locator('#invite-url-text');
    await expect(urlInput).toBeVisible({ timeout: 30_000 });
    const url = (await urlInput.inputValue()).trim();
    if (!url) throw new Error('copyNamespaceInvite: dialog produced empty URL');
    await dialog.getByRole('button', { name: /^Close$/ }).click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });
    return url;
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
