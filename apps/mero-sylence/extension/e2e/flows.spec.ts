/**
 * The extension's flows end to end, in the built extension:
 *
 * - sign-in in a small popup window, cancelled and completed (the stand-in
 *   page seals a real session as the served page does);
 * - workspaces listed from a real node (`merod local`), chosen, and a new one
 *   created through the window's create step;
 * - two recordings in one workspace: lines saved to the node, the meeting
 *   ended, its action items found and added, Saved → Done → Ready;
 * - settings: styled selects, switches that persist, diagnostics, Log out.
 *
 * Recording goes through the real service worker and popup; only the
 * offscreen page is stood in for (harness.ts), since Chrome gives a tab's
 * stream only after a toolbar click. The node-backed steps skip, with the
 * reason, when there is no merod to run (node.ts).
 */
import { expect, test, type BrowserContext, type Page, type Worker } from "@playwright/test";
import type { Server } from "node:http";
import {
  MEET_URL,
  authWindows,
  fakeOffscreen,
  getStorage,
  launch,
  openPopup,
  say,
  serviceWorker,
  setStorage,
  startPage,
} from "./harness";
import { seed, unavailable, type Seeded } from "./node";

test.describe.configure({ mode: "serial" });
test.setTimeout(90_000);

let context: BrowserContext;
let worker: Worker;
let page: { origin: string; server: Server };
let node: Seeded | null = null;
let noNode: string | null = null;

interface Auth {
  accountId: string;
  workspace: { appId: string; name: string } | null;
}
interface Meeting {
  id: string;
  title: string;
  platform: string;
  endedAt: unknown;
  durationMs: number;
}

test.beforeAll(async () => {
  test.setTimeout(240_000);
  ({ context, worker } = await launch());
  page = await startPage();
  await setStorage(worker, "local", {
    "sylence:settings": { tier: "ultralight", language: "en", mic: false, pageOverride: page.origin, autoActions: true },
  });
  noNode = await unavailable();
  if (!noNode) node = await seed();
});

test.afterAll(async () => {
  await context?.close();
  page?.server.close();
  node?.stop();
});

/** The stand-in Sylence page the next sign-in window opens. */
async function nextSignInPage(): Promise<Page> {
  const opened = await context.waitForEvent("page", { predicate: (p) => p.url().startsWith(page.origin), timeout: 15_000 });
  await opened.waitForFunction(() => (window as unknown as { handoff?: unknown }).handoff !== undefined);
  return opened;
}

test("sign-in opens a small popup window on the page, and closing it cancels", async () => {
  const popup = await openPopup(context);
  const waiting = nextSignInPage();
  await popup.getByRole("button", { name: "Sign in with Calimero" }).click();
  const signInPage = await waiting;
  await expect(popup.getByRole("button", { name: /Waiting for sign-in/ })).toBeDisabled();

  const [win] = await authWindows(worker);
  expect(win).toBeDefined();
  expect(win!.type).toBe("popup");
  // Not full screen: the size the extension asks for (the OS may add a frame).
  expect(win!.width).toBeGreaterThanOrEqual(440);
  expect(win!.width).toBeLessThanOrEqual(500);
  expect(win!.height).toBeGreaterThanOrEqual(680);
  expect(win!.height).toBeLessThanOrEqual(760);

  const req = await signInPage.evaluate(() => (window as unknown as { __req: Record<string, string | null> }).__req);
  expect(req.fragment).toBe("native-sign-in");
  expect(req.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(req.key).toMatch(/^[A-Za-z0-9_-]{87}$/);
  expect(req.intent).toBeNull();

  await worker.evaluate((id) => chrome.windows.remove(id), win!.id);
  await expect(popup.getByRole("alert")).toHaveText("Sign-in was cancelled.");
  expect(await getStorage(worker, "local", "sylence:auth")).toBeFalsy();
  await popup.close();
});

test("the page saying cancel also cancels, and closes its window", async () => {
  const popup = await openPopup(context);
  const waiting = nextSignInPage();
  await popup.getByRole("button", { name: "Sign in with Calimero" }).click();
  const signInPage = await waiting;
  await signInPage.evaluate(() => (window as unknown as { cancel: () => void }).cancel());
  await expect(popup.getByRole("alert")).toHaveText("Sign-in was cancelled.");
  await expect.poll(() => authWindows(worker)).toEqual([]);
  await popup.close();
});

test("signing in on the page hands the session over, closes the window and lists the workspaces", async () => {
  test.skip(!node, noNode ?? "");
  const popup = await openPopup(context);
  const waiting = nextSignInPage();
  await popup.getByRole("button", { name: "Sign in with Calimero" }).click();
  const signInPage = await waiting;
  await signInPage.evaluate((s) => (window as unknown as { handoff: (s: unknown) => Promise<void> }).handoff(s), await node!.session());

  await expect(popup.getByRole("heading", { name: "Choose a workspace" })).toBeVisible();
  await expect.poll(() => authWindows(worker)).toEqual([]);
  const auth = await getStorage<Auth>(worker, "local", "sylence:auth");
  expect(auth.accountId).toBe(node!.person.accountId);
  expect(auth.workspace).toBeNull();

  const radios = popup.getByRole("radiogroup", { name: "Workspaces" }).getByRole("radio");
  await expect(radios).toHaveCount(2);
  await expect(popup.getByRole("radio", { name: "Team", exact: true })).toBeVisible();
  await expect(popup.getByRole("radio", { name: "Sales", exact: true })).toBeVisible();
  await popup.getByRole("radio", { name: "Sales" }).click();
  await expect(popup.getByRole("button", { name: "Change workspace" })).toContainText("Sales");
  expect((await getStorage<Auth>(worker, "local", "sylence:auth")).workspace).toEqual(node!.workspaces[1]);
  await popup.close();
});

test("create another workspace: the window opens the create step, and the new workspace is chosen", async () => {
  test.skip(!node, noNode ?? "");
  const popup = await openPopup(context);
  await popup.getByRole("button", { name: "Change workspace" }).click();
  await expect(popup.getByRole("radio", { name: "Sales" })).toHaveAttribute("aria-checked", "true");

  const waiting = nextSignInPage();
  await popup.getByRole("button", { name: "Create another workspace" }).click();
  const signInPage = await waiting;
  const req = await signInPage.evaluate(() => (window as unknown as { __req: Record<string, string | null> }).__req);
  expect(req.intent).toBe("create");
  expect(signInPage.url()).toContain("&intent=create");

  // What the page's create step does: a workspace in the account's organization.
  const made = await node!.createWorkspace("Design");
  await signInPage.evaluate((s) => (window as unknown as { handoff: (s: unknown) => Promise<void> }).handoff(s), await node!.session());

  await expect(popup.getByRole("button", { name: "Change workspace" })).toContainText("Design");
  expect((await getStorage<Auth>(worker, "local", "sylence:auth")).workspace).toEqual(made);
  await popup.close();
});

/** The stand-in Meet tab, as the popup sees it. */
async function meetTab(): Promise<{ id: number; url: string; title: string }> {
  const tab = await context.newPage();
  await tab.goto(MEET_URL);
  const sw = await serviceWorker(context);
  const found = await sw.evaluate(async (url) => (await chrome.tabs.query({ url: `${url}*` }))[0], MEET_URL);
  return { id: found!.id!, url: found!.url!, title: found!.title! };
}

/** One recording from the popup: lines said, Stop, Saved. Returns the popup on its Saved screen. */
async function record(lines: [speaker: "you" | "others", text: string][]): Promise<Page> {
  const control = await fakeOffscreen(context);
  const tab = await meetTab();
  const popup = await openPopup(context, tab);
  await expect(popup.getByText("Google Meet · in a call")).toBeVisible();
  await popup.getByRole("button", { name: "Record meeting" }).click();
  await expect(popup.getByRole("button", { name: /Stop/ })).toBeEnabled();
  expect(await control.evaluate(() => (window as unknown as { __commands: string[] }).__commands)).toEqual(["caps", "capture"]);

  for (const [i, [speaker, text]] of lines.entries()) await say(control, speaker, i * 4_000, text);
  await expect(popup.getByRole("region", { name: "Latest lines" })).toContainText(lines.at(-1)![1]);

  // The side panel (the control page is one) shows the live transcript.
  await expect(control.getByRole("main")).toContainText(lines.at(-1)![1]);

  await popup.getByRole("button", { name: /Stop/ }).click();
  await expect(popup.getByRole("heading", { name: "Meeting saved" })).toBeVisible();
  await control.close();
  return popup;
}

test("a recording saves its lines to the node, ends the meeting and adds the action items said in it", async () => {
  test.skip(!node, noNode ?? "");
  const workspace = node!.workspaces.length ? (await getStorage<Auth>(worker, "local", "sylence:auth")).workspace! : null;
  const popup = await record([
    ["you", "Okay. Ana, can you send the deck to the design team by Friday?"],
    ["others", "Sure. Can you hear me okay?"],
    ["others", "I'll update the pricing page tomorrow."],
  ]);

  await expect(popup.getByText("2 action items added from the transcript.")).toBeVisible();
  await expect(popup.getByRole("button", { name: /Open in Sylence/ })).toBeEnabled();

  const status = await getStorage<{ link: string; meeting: { id: string } }>(worker, "session", "sylence:status");
  expect(status.link).toBe(`${page.origin}/#/w/${encodeURIComponent(workspace!.appId)}/m/${encodeURIComponent(status.meeting.id)}`);

  const meeting = await node!.view<Meeting>(workspace!.appId, "getMeeting", { meetingId: status.meeting.id });
  expect(meeting).toMatchObject({ title: "Weekly sync", platform: "meet" });
  expect(meeting.endedAt).toBeTruthy();
  expect(meeting.durationMs).toBe(11_000);

  const page1 = await node!.view<{ segments: { seq: number; speaker: string; text: string }[] }>(workspace!.appId, "transcript", {
    meetingId: status.meeting.id,
    fromSeq: 0,
    limit: 50,
  });
  expect(page1.segments.map((s) => [s.seq, s.speaker, s.text])).toEqual([
    [0, "you", "Okay. Ana, can you send the deck to the design team by Friday?"],
    [1, "others", "Sure. Can you hear me okay?"],
    [2, "others", "I'll update the pricing page tomorrow."],
  ]);

  const actions = await node!.view<{ text: string; assignee: string; sourceSeq: number | null; done: boolean }[]>(
    workspace!.appId,
    "listActions",
    { meetingId: status.meeting.id },
  );
  expect(actions.map((a) => ({ text: a.text, assignee: a.assignee, sourceSeq: a.sourceSeq, done: a.done }))).toEqual([
    { text: "Send the deck to the design team by Friday", assignee: "Ana", sourceSeq: 0, done: false },
    { text: "Update the pricing page tomorrow", assignee: "", sourceSeq: 2, done: false },
  ]);

  // Open in Sylence goes to the meeting's page.
  const opened = context.waitForEvent("page", { predicate: (p) => p.url().startsWith(page.origin) });
  await popup.getByRole("button", { name: /Open in Sylence/ }).click();
  expect((await opened).url()).toBe(status.link);
  await (await opened).close();

  // Done: ready for the next call.
  await popup.getByRole("button", { name: "Done" }).click();
  await expect(popup.getByRole("button", { name: "Record meeting" })).toBeEnabled();
  await popup.close();
});

test("a second call in the same workspace is its own meeting, and both are listed", async () => {
  test.skip(!node, noNode ?? "");
  const workspace = (await getStorage<Auth>(worker, "local", "sylence:auth")).workspace!;
  const popup = await record([
    ["others", "Quick one. We need to fix the login bug before the release."],
    ["you", "Agreed, nothing else from me."],
  ]);
  await expect(popup.getByText("1 action item added from the transcript.")).toBeVisible();
  await popup.getByRole("button", { name: "Done" }).click();
  await expect(popup.getByRole("button", { name: "Record meeting" })).toBeEnabled();
  await popup.close();

  const meetings = await node!.view<Meeting[]>(workspace.appId, "listMeetings");
  expect(meetings).toHaveLength(2);
  expect(meetings.every((m) => m.title === "Weekly sync" && m.endedAt)).toBe(true);
  expect(new Set(meetings.map((m) => m.id)).size).toBe(2);
  const second = meetings.find((m) => m.durationMs === 7_000)!;
  const actions = await node!.view<{ text: string }[]>(workspace.appId, "listActions", { meetingId: second.id });
  expect(actions.map((a) => a.text)).toEqual(["Fix the login bug before the release"]);
});

test("turning action items off adds none", async () => {
  test.skip(!node, noNode ?? "");
  const workspace = (await getStorage<Auth>(worker, "local", "sylence:auth")).workspace!;
  const settings = await getStorage<Record<string, unknown>>(worker, "local", "sylence:settings");
  await setStorage(worker, "local", { "sylence:settings": { ...settings, autoActions: false } });
  const popup = await record([["you", "Ana, can you book the room for Monday?"]]);
  await expect(popup.getByText(/action items? added/)).toHaveCount(0);
  const status = await getStorage<{ meeting: { id: string } }>(worker, "session", "sylence:status");
  expect(await node!.view<unknown[]>(workspace.appId, "listActions", { meetingId: status.meeting.id })).toEqual([]);
  await popup.getByRole("button", { name: "Done" }).click();
  await popup.close();
  await setStorage(worker, "local", { "sylence:settings": { ...settings, autoActions: true } });
});

test("a tab Chrome refuses to capture shows the error and leaves no empty meeting behind", async () => {
  test.skip(!node, noNode ?? "");
  const workspace = (await getStorage<Auth>(worker, "local", "sylence:auth")).workspace!;
  const before = (await node!.view<Meeting[]>(workspace.appId, "listMeetings")).length;
  const control = await fakeOffscreen(context);
  const sw = await serviceWorker(context);
  await sw.evaluate(() => {
    (chrome as unknown as { tabCapture: { getMediaStreamId: unknown } }).tabCapture.getMediaStreamId = async () => {
      throw new Error("Error starting tab capture");
    };
  });
  const popup = await openPopup(context, await meetTab());
  await popup.getByRole("button", { name: "Record meeting" }).click();
  await expect(popup.getByRole("alert")).toContainText("Error starting tab capture");
  await expect(popup.getByRole("button", { name: "Record meeting" })).toBeEnabled();
  expect(await node!.view<Meeting[]>(workspace.appId, "listMeetings")).toHaveLength(before);
  expect((await getStorage<{ phase: string }>(worker, "session", "sylence:status")).phase).toBe("error");
  // Dismiss clears it.
  await popup.getByRole("button", { name: "Dismiss" }).click();
  await expect(popup.getByRole("alert")).toHaveCount(0);
  await popup.close();
  await control.close();
});

test("settings: styled selects, switches that stick, diagnostics, and Log out at the bottom", async () => {
  if (!(await getStorage(worker, "local", "sylence:auth"))) {
    // Without a node the earlier sign-in skipped: a stored session is enough here.
    await setStorage(worker, "local", {
      "sylence:auth": {
        accountId: "acc-e2e",
        session: { accountId: "acc-e2e", sessionToken: "t", refreshToken: "r", expiresAt: Date.now() + 3.6e6 },
        nodeUrl: "http://127.0.0.1:2501",
        nodes: [],
        page: { origin: page.origin, version: null },
        workspace: { appId: "app-e2e", name: "Team" },
      },
    });
  }
  const popup = await openPopup(context);
  // What "Copy diagnostics" writes (headless Chromium has no clipboard to grant an extension).
  await popup.addInitScript(() => {
    navigator.clipboard.writeText = async (text: string) => {
      (window as unknown as { __copied: string }).__copied = text;
    };
  });
  await popup.reload();
  await popup.getByRole("button", { name: "Settings" }).click();

  // Selects drawn by the stylesheet, the chevron at the right edge.
  for (const label of ["Speech model", "Spoken language"]) {
    const select = popup.getByLabel(label);
    await expect(select).toBeVisible();
    const style = await select.evaluate((el) => {
      const s = getComputedStyle(el);
      return { appearance: s.appearance, image: s.backgroundImage, radius: s.borderTopLeftRadius, position: s.backgroundPositionX };
    });
    expect(style.appearance).toBe("none");
    expect(style.image).toContain("svg");
    expect(style.radius).toBe("8px");
  }

  // A choice and both switches persist across a reopen.
  await popup.getByLabel("Spoken language").selectOption({ label: "German" });
  const mic = popup.getByRole("switch", { name: "Transcribe my microphone" });
  const actions = popup.getByRole("switch", { name: "Find action items" });
  const micBefore = await mic.getAttribute("aria-checked");
  await mic.click();
  await actions.click();
  await expect(mic).toHaveAttribute("aria-checked", micBefore === "true" ? "false" : "true");
  await expect(actions).toHaveAttribute("aria-checked", "false");
  await popup.reload();
  await popup.getByRole("button", { name: "Settings" }).click();
  await expect(popup.getByLabel("Spoken language")).toHaveValue("de");
  await expect(popup.getByRole("switch", { name: "Find action items" })).toHaveAttribute("aria-checked", "false");
  const stored = await getStorage<{ language: string; autoActions: boolean; mic: boolean }>(worker, "local", "sylence:settings");
  expect(stored).toMatchObject({ language: "de", autoActions: false, mic: micBefore !== "true" });

  // Diagnostics: copies the recorder's log, no transcript.
  // Open already with a development sign-in page set.
  const advanced = popup.getByRole("button", { name: "Advanced", exact: true });
  if (await advanced.isVisible()) await advanced.click();
  await popup.getByRole("button", { name: "Copy diagnostics" }).click();
  await expect(popup.getByText(/^(Copied \d+ lines\.|Nothing logged yet in this browser session\.)$/)).toBeVisible();
  const copied = await popup.evaluate(() => (window as unknown as { __copied: string }).__copied);
  expect(copied).toMatch(/^Sylence \d+\.\d+\.\d+ on /);
  expect(copied).not.toContain("Ana, can you send the deck");
  await popup.getByRole("button", { name: "Hide advanced" }).click();

  // Log out is the last control, with no account id beside it.
  const main = popup.getByRole("main");
  const last = main.locator(":scope > *").last();
  await expect(last).toHaveText("Log out");
  await expect(main).not.toContainText("Signed in as");
  const auth = await getStorage<Auth>(worker, "local", "sylence:auth");
  await expect(main).not.toContainText(auth.accountId);
  const box = await last.boundingBox();
  const switches = await popup.getByRole("switch", { name: "Find action items" }).boundingBox();
  expect(box!.y).toBeGreaterThan(switches!.y + switches!.height);

  await last.click();
  await expect.poll(() => getStorage(worker, "local", "sylence:auth")).toBeFalsy();
  await popup.getByRole("button", { name: "Back" }).click();
  await expect(popup.getByRole("button", { name: "Sign in with Calimero" })).toBeVisible();
  await popup.close();
});

test("a session for an account the node no longer has signs the extension out when the popup opens", async () => {
  test.skip(!node, noNode ?? "");
  // What a wiped cluster leaves behind: a stored session the node has never heard of.
  await setStorage(worker, "local", {
    "sylence:auth": {
      accountId: "acc-gone",
      session: { accountId: "acc-gone", sessionToken: "x".repeat(40), refreshToken: "y".repeat(40), expiresAt: Date.now() + 3.6e6 },
      nodeUrl: "http://127.0.0.1:2501",
      nodes: [],
      page: { origin: page.origin, version: null },
      workspace: { appId: "app-gone", name: "Old team" },
    },
  });
  const popup = await openPopup(context);
  await expect(popup.getByRole("button", { name: "Sign in with Calimero" })).toBeVisible();
  await expect(popup.getByRole("status")).toContainText("no longer exists");
  expect(await getStorage(worker, "local", "sylence:auth")).toBeFalsy();
  await popup.close();
});
