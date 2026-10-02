import { expect, type Locator, type Page } from "@playwright/test";
import { defaultLogin, type Actor, type AppDriver, type Feature } from "@calimero-apps/e2e-node/journey";

const SYNC = 90_000;

function firstAgreement(actor: Actor): string {
  return `first-${actor.run}`;
}

function heading(page: Page, name: string): Locator {
  return page.getByRole("heading", { level: 1, name, exact: true });
}

function agreementCard(page: Page, name: string): Locator {
  return page.getByTestId("agreement-card").filter({ hasText: name });
}

function documentCard(page: Page, name: string): Locator {
  return page.getByTestId("document-card").filter({ hasText: name });
}

async function until(
  page: Page,
  check: () => Promise<boolean>,
  refresh: () => Promise<void>,
  message: string,
): Promise<void> {
  const deadline = Date.now() + SYNC;
  for (;;) {
    const settle = Date.now() + Math.min(15_000, Math.max(1_000, deadline - Date.now()));
    while (Date.now() < settle) {
      if (await check().catch(() => false)) return;
      await page.waitForTimeout(1_000);
    }
    if (Date.now() >= deadline) throw new Error(`timed out: ${message}`);
    await page.reload();
    await refresh();
  }
}

async function gotoWorkspace(page: Page): Promise<void> {
  await page.goto("/agreements");
  await expect(heading(page, "Agreements")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("new-agreement-name")).toBeVisible();
}

async function openAgreement(actor: Actor, name: string): Promise<void> {
  const page = actor.page;
  const title = page.getByTestId("agreement-title");
  if (/\/agreements\/[^/]+/.test(page.url()) && (await title.count()) > 0 && (await title.innerText()).trim() === name) {
    return;
  }
  await gotoWorkspace(page);
  const open = agreementCard(page, name).getByRole("button").first();
  await until(
    page,
    async () => (await open.count()) > 0 && (await open.isEnabled()),
    async () => {
      await expect(heading(page, "Agreements")).toBeVisible({ timeout: 30_000 });
    },
    `agreement ${name} is listed and openable`,
  );
  await open.click();
  await expect(page).toHaveURL(/\/agreements\/[^/]+/, { timeout: 60_000 });
  await expect(title).toHaveText(name, { timeout: SYNC });
}

async function waitForAgreement(page: Page): Promise<void> {
  await expect(page.getByTestId("agreement-title")).toBeVisible({ timeout: 30_000 });
}

function tinyPdf(label: string): Buffer {
  const text = label.replace(/[^A-Za-z0-9 -]/g, "");
  const content = `BT /F1 12 Tf 20 50 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

let workspaceName = "";

const uploaded: Record<string, string> = {};
let uploads = 0;

const uploadPdf: Feature = {
  name: "upload a PDF and open the other signer's copy",
  async do(actor) {
    const page = actor.page;
    const name = `${actor.name}-${actor.run}-${++uploads}.pdf`;
    uploaded[actor.name] = name;
    await openAgreement(actor, firstAgreement(actor));
    await page.getByTestId("tab-documents").click();
    await page.getByTestId("open-upload").click();
    await page.getByTestId("upload-input").setInputFiles({
      name,
      mimeType: "application/pdf",
      buffer: tinyPdf(name),
    });
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(documentCard(page, name)).toBeVisible({ timeout: 60_000 });
  },
  async seen(actor, by) {
    const name = uploaded[by.name];
    if (!name) throw new Error(`${by.name} has not uploaded anything yet`);
    const page = actor.page;
    await openAgreement(actor, firstAgreement(actor));
    await until(
      page,
      async () => (await documentCard(page, name).count()) > 0,
      () => waitForAgreement(page),
      `document ${name} is listed`,
    );
    await documentCard(page, name).getByRole("button").first().click();
    await expect(page.getByTestId("document-backdrop")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("document-loading")).toHaveCount(0, { timeout: SYNC });
    await expect(page.getByTestId("document-error")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("document-backdrop")).toHaveCount(0, { timeout: 15_000 });
  },
};

const people: Feature = {
  name: "both signers are listed on the agreement",
  async do(actor) {
    const page = actor.page;
    await openAgreement(actor, firstAgreement(actor));
    await page.getByTestId("tab-people").click();
    await expect(page.getByTestId("person-row").filter({ hasText: "(you)" })).toBeVisible({ timeout: 30_000 });
  },
  async seen(actor) {
    const page = actor.page;
    await openAgreement(actor, firstAgreement(actor));
    await page.getByTestId("tab-people").click();
    await until(
      page,
      async () => (await page.getByTestId("person-row").count()) >= 2,
      async () => {
        await waitForAgreement(page);
        await page.getByTestId("tab-people").click();
      },
      "two people on the agreement",
    );
  },
};

const created: Record<string, string> = {};

const createAgreement: Feature = {
  name: "create another agreement in the workspace",
  oneWay: true,
  async do(actor) {
    const page = actor.page;
    const name = `agr-${actor.name}-${actor.run}`;
    created[actor.name] = name;
    await gotoWorkspace(page);
    await page.getByTestId("new-agreement-name").fill(name);
    await page.getByTestId("create-agreement").click();
    await expect(agreementCard(page, name)).toBeVisible({ timeout: 60_000 });
  },
  async seen(actor, by) {
    const name = created[by.name];
    if (!name) throw new Error(`${by.name} has not created an agreement`);
    const page = actor.page;
    await gotoWorkspace(page);
    await until(
      page,
      async () => (await agreementCard(page, name).count()) > 0,
      async () => {
        await expect(heading(page, "Agreements")).toBeVisible({ timeout: 30_000 });
      },
      `agreement ${name} is listed`,
    );
  },
};

export const driver: AppDriver = {
  app: "mero-sign",

  async login(actor) {
    await defaultLogin(actor);
    await expect(heading(actor.page, "Your workspaces")).toBeVisible({ timeout: 60_000 });
  },

  async createNamespace(actor, name) {
    const page = actor.page;
    workspaceName = name;
    await expect(heading(page, "Your workspaces")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("new-workspace-name").fill(name);
    await expect(page.getByTestId("create-workspace")).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId("create-workspace").click();
    await expect(page).toHaveURL(/\/workspaces\/[^/]+/, { timeout: 60_000 });
    await expect(heading(page, "Agreements")).toBeVisible({ timeout: 30_000 });
  },

  async createSpace(actor, name) {
    const page = actor.page;
    await gotoWorkspace(page);
    await page.getByTestId("new-agreement-name").fill(name);
    await page.getByTestId("create-agreement").click();
    await expect(agreementCard(page, name)).toBeVisible({ timeout: 60_000 });
    await openAgreement(actor, name);
  },

  async openSpace(actor, name) {
    await openAgreement(actor, name);
  },

  async invite(actor) {
    const page = actor.page;
    await page.goto("/workspaces");
    await expect(heading(page, "Your workspaces")).toBeVisible({ timeout: 30_000 });
    const card = page.getByTestId("workspace-card").filter({ hasText: workspaceName });
    await expect(card).toBeVisible({ timeout: 30_000 });
    await card.getByTitle("More options").click();
    await page.getByTestId("invite-to-workspace").click();
    const link = page.getByTestId("invite-link");
    await expect(link).toHaveValue(/\S/, { timeout: 30_000 });
    const value = (await link.inputValue()).trim();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    return value;
  },

  async acceptInvite(actor, link) {
    const page = actor.page;
    await expect(heading(page, "Your workspaces")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("join-code").fill(link);
    await page.getByTestId("join-workspace").click();
    const landed = page.waitForURL(/\/(agreements|workspaces)\/[^/]+/, { timeout: SYNC });
    const failed = page
      .getByTestId("list-error")
      .waitFor({ state: "visible", timeout: SYNC })
      .then(async () => {
        throw new Error(`join refused: ${await page.getByTestId("list-error").innerText()}`);
      });
    landed.catch(() => undefined);
    failed.catch(() => undefined);
    await Promise.race([landed, failed]);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 30_000 });
  },

  async afterReload(actor) {
    await expect(actor.page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 30_000 });
  },

  features: [uploadPdf, people, createAgreement],
};
