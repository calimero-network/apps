// One browser context per rig node, one freshly seeded document, and the
// node-side handle (context id + doc id) every assertion reads through.

import { randomBytes } from 'node:crypto';
import { test as base, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { WorkspaceDriver } from '../../fixtures/workspace';
import { rigAvailable, rigNodes } from '../helpers/nodes';
import { goOnline, waitForHealth } from '../helpers/rig';
import { findDoc, type DocRef } from '../helpers/rpc';


export interface RichWindow {
  node: number;
  page: Page;
  ws: WorkspaceDriver;
  /** Re-opens the document after a node restart, which kills the page's event stream. */
  reopen: () => Promise<void>;
}

export class RichRig {
  readonly title: string;
  /** One folder per test inside the rig's own namespace, which every node has already joined. */
  readonly folder: string;
  private readonly contexts: BrowserContext[] = [];
  private docRef: DocRef | null = null;

  constructor(
    private readonly browser: Browser,
    private readonly tag: string,
  ) {
    this.title = `Rich ${tag}`;
    this.folder = `Folder ${tag}`;
  }

  get doc(): DocRef {
    if (!this.docRef) throw new Error('seed() first');
    return this.docRef;
  }

  /** A window pointed at rig node `node`; `?node=` supplies its session. */
  private async open(node: number): Promise<RichWindow> {
    // A window opened against a node that is still restarting boots unauthed
    // and lands on the landing page instead of the workspace.
    await waitForHealth(node, true);
    const context = await this.browser.newContext();
    this.contexts.push(context);
    const page = await context.newPage();
    await page.goto(`/app?node=${node}`);
    const ws = new WorkspaceDriver(page, { label: `node${node}` });
    await expect(page.locator('select').first()).toBeVisible({ timeout: 30_000 });
    // A fresh member is asked for a display name before the workspace is usable.
    await ws.dismissNameGateIfPresent(`node${node}`);
    const window: RichWindow = {
      node,
      page,
      ws,
      reopen: async () => {
        await page.reload();
        await expect(page.locator('select').first()).toBeVisible({ timeout: 60_000 });
        await ws.dismissNameGateIfPresent(`node${node}`);
        // A node that has just restarted serves the folder tree slowly.
        await ws.tree.expectFolderVisible(this.folder, { timeout: 120_000 });
        await ws.tree.openFolder(this.folder);
        // By id, not title: the scenarios rename the document.
        const row = page.locator(`[data-testid="doc-row"][data-doc-id="${this.doc.docId}"]`);
        await expect(row).toBeVisible({ timeout: 120_000 });
        await row.click();
        await ws.editor.expectMounted();
      },
    };
    return window;
  }

  /** Creates the folder and document on the first node, then opens them on the rest. */
  async seed(nodes: number[]): Promise<RichWindow[]> {
    const [first, ...rest] = nodes;
    const owner = await this.open(first);
    await owner.ws.createFolder({ name: this.folder, visibility: 'Open' });
    await owner.ws.tree.openFolder(this.folder);
    await owner.ws.createDoc(this.title);

    // Others join before the owner opens the document: a membership change
    // arriving mid-edit drops the window back to the folder list.
    this.docRef = await findDoc(first, this.title);
    const joined: RichWindow[] = [];
    for (const node of rest) joined.push(await this.join(node));
    await owner.reopen();
    return [owner, ...joined];
  }

  /** A node opening the document after it exists; also the late-joiner scenario. */
  async join(node: number): Promise<RichWindow> {
    const window = await this.open(node);
    await window.ws.tree.expectFolderVisible(this.folder, { timeout: 120_000 });
    await window.ws.tree.openFolder(this.folder);
    await window.ws.restrictedCard.joinIfPrompted();
    await window.ws.docs.expectDocVisible(this.title, { timeout: 120_000 });
    await window.ws.openDoc(this.title);
    return window;
  }

  async close(): Promise<void> {
    for (const context of this.contexts) await context.close();
  }
}

export const test = base.extend<{ rig: RichRig }>({
  rig: async ({ browser }, use, testInfo) => {
    if (!rigAvailable(3)) {
      testInfo.skip(true, 'the rich suite needs three rig nodes (scripts/local-rig.sh up)');
      // Unreachable, but TS needs a value.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await use(undefined as any);
      return;
    }
    const rig = new RichRig(browser, randomBytes(3).toString('hex'));
    await use(rig);
    // A spec that failed mid-partition must not leave a node down for the next.
    for (const node of rigNodes()) await goOnline(node.index);
    await rig.close();
  },
});

export { expect } from '@playwright/test';
