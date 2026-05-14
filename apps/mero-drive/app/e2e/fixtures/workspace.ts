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

  async createNamespace(name: string): Promise<void> {
    await this.page
      .getByRole('button', { name: /New workspace/i })
      .click();
    const dialog = this.page.getByRole('dialog');
    await dialog.getByPlaceholder(/Workspace name/i).fill(name);
    await dialog.getByRole('button', { name: /^Create$/ }).click();
    // Dialog closes; namespace select shows the new value.
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await expect(this.page.locator('select').first()).toContainText(name, {
      timeout: 15_000,
    });
  }

  // Selects a namespace from the top-bar select. Use the namespace
  // name (matched as the visible option label) — switching by id is
  // brittle since ids are minted at runtime.
  async switchNamespace(name: string): Promise<void> {
    await this.page
      .locator('select')
      .first()
      .selectOption({ label: new RegExp(name, 'i') });
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
      // Open the parent folder's context menu and click "New
      // subfolder". Without a parent we use the tree-level "New"
      // button.
      throw new Error('Nested folder creation not yet implemented in driver');
    }
    await this.page.getByRole('button', { name: /^New$/ }).click();
    const dialog = this.page.getByRole('dialog');
    await dialog.getByPlaceholder(/Folder name/i).fill(opts.name);
    // Visibility radio/toggle within the dialog. Implementation
    // detail of NewFolderDialog — assume a labelled control. If this
    // fails, NewFolderDialog probably doesn't expose visibility at
    // creation time and we need to set it post-create via
    // `toggleVisibility`.
    const visibilityRadio = dialog.getByRole('radio', {
      name: new RegExp(`^${opts.visibility}$`, 'i'),
    });
    if (await visibilityRadio.count()) {
      await visibilityRadio.click();
    }
    await dialog.getByRole('button', { name: /^Create$/ }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await this.tree.expectFolderVisible(opts.name);
  }

  async renameFolder(currentName: string, newName: string): Promise<void> {
    await this.tree.openContextMenu(currentName);
    await this.page.getByRole('menuitem', { name: /Rename/i }).click();
    // Inline rename input is the only visible text input in the row.
    const input = this.page.locator('input[type="text"]:visible').first();
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

  async toggleVisibility(folderName: string): Promise<void> {
    await this.tree.openFolder(folderName);
    await this.tree.openContextMenu(folderName);
    // Either 'Make restricted' or 'Make open' — both are valid.
    await this.page
      .getByRole('menuitem', { name: /Make (open|restricted)/i })
      .click();
  }

  // ─── docs ──────────────────────────────────────────────────────

  async createDoc(title: string): Promise<void> {
    await this.page.getByRole('button', { name: /^New$/ }).click();
    const dialog = this.page.getByRole('dialog');
    // NewDocDialog has a title input; placeholder may be 'Document
    // title' or similar. Use first visible textbox in dialog.
    const titleInput = dialog.locator('input[type="text"]').first();
    await titleInput.fill(title);
    await dialog.getByRole('button', { name: /^Create$/ }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
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
    // Folder rows are <li> with a span/text node carrying the alias.
    // Filter the tree-rail <li>s by visible text.
    return this.page
      .locator('aside li')
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

  async openFolder(name: string): Promise<void> {
    await this.folderRow(name).first().click();
  }

  async openContextMenu(name: string): Promise<void> {
    // Right-click on the row opens the FolderContextMenu.
    await this.folderRow(name).first().click({ button: 'right' });
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
    // Wait for the card to unmount — the upstream folder UI takes
    // over once joinContext + materialization complete.
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
      .locator('ul li button')
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
    await expect(this.page.locator('.ProseMirror')).toBeVisible({
      timeout: opts.timeout ?? 30_000,
    });
  }

  async type(content: string): Promise<void> {
    const editor = this.page.locator('.ProseMirror');
    await editor.click();
    await editor.fill(content);
  }

  async expectContent(content: string, opts: { timeout?: number } = {}) {
    await expect(this.page.locator('.ProseMirror')).toContainText(content, {
      timeout: opts.timeout ?? 30_000,
    });
  }

  async close(): Promise<void> {
    await this.page.getByRole('button', { name: /^Documents$/ }).click();
  }

  async deleteDocument(): Promise<void> {
    await this.page.getByRole('button', { name: /^More|menu/i }).click();
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
    await panel.getByRole('button', { name: /^Save$/ }).click();
    await expect(panel.getByRole('button', { name: /^Saving/i })).toBeHidden({
      timeout: 15_000,
    });
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
