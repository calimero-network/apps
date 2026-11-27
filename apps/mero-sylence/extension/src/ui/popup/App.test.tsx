import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, IDLE, KEYS, type AuthState, type RecorderStatus } from "../../lib/messages";
import { installFakeChrome, type FakeChrome } from "../../test/fakeChrome";
import { App } from "./App";

const AUTH: AuthState = {
  accountId: "acc-1",
  session: { accountId: "acc-1", sessionToken: "t", refreshToken: "r", expiresAt: 2e12 },
  nodeUrl: "https://node.example",
  nodes: [],
  page: { origin: "https://sylence.example", version: "0.1.0" },
  workspace: { appId: "app-1", name: "Design team" },
};
const MEET = { id: 7, url: "https://meet.google.com/abc-defg-hij", title: "Roadmap review - Google Meet" };

let chrome: FakeChrome;
/** The speech models in this browser's cache, by repository (both halves each). */
function modelsCached(repos: string[]) {
  const urls = repos.flatMap((r) => [`https://huggingface.co/${r}/resolve/main/onnx/encoder_model.onnx`, `https://huggingface.co/${r}/resolve/main/onnx/decoder_model_merged.onnx`]);
  Object.defineProperty(globalThis, "caches", {
    configurable: true,
    value: { open: async () => ({ keys: async () => urls.map((url) => ({ url })) }) },
  });
}
/** The microphone permission, as `navigator.permissions` answers it. */
function micPermission(state: "granted" | "denied" | "prompt") {
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: { query: async () => ({ state, onchange: null }) },
  });
}
/** A laptop that may run the big model: a GPU that takes big buffers, 8 GB, 10 cores. */
function strongLaptop() {
  Object.defineProperty(navigator, "gpu", { configurable: true, value: { requestAdapter: async () => ({ limits: { maxBufferSize: 2 ** 31 } }) } });
  Object.defineProperty(navigator, "deviceMemory", { configurable: true, value: 8 });
  Object.defineProperty(navigator, "hardwareConcurrency", { configurable: true, value: 10 });
}
beforeEach(() => {
  for (const k of ["gpu", "deviceMemory", "hardwareConcurrency"]) delete (navigator as unknown as Record<string, unknown>)[k];
  chrome = installFakeChrome();
  chrome.activeTab = MEET;
  // A laptop ready to record: the small models downloaded, the microphone allowed.
  modelsCached(["onnx-community/moonshine-base-ONNX", "onnx-community/moonshine-tiny-ONNX", "onnx-community/whisper-base"]);
  micPermission("granted");
});

const types = () => chrome.sent.map((m) => (m as { type: string }).type);

describe("popup", () => {
  it("signed out: offers sign-in and asks the service worker", async () => {
    render(<App />);
    const button = await screen.findByRole("button", { name: "Sign in with Calimero" });
    expect(screen.getByText(/sealed so only your team can read/)).toBeTruthy();
    fireEvent.click(button);
    await waitFor(() => expect(types()).toContain("signIn"));
  });

  it("signed out: creating an account is filled in here; the window only asks for the passkey", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Create an account" }));
    // Only the passkey's label is asked here; the workspace comes next, in this popup.
    expect(screen.queryByLabelText("Your name")).toBeNull();
    expect(screen.queryByLabelText("Your first workspace")).toBeNull();
    fireEvent.change(screen.getByLabelText(/Label your passkey/), { target: { value: "Work laptop" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() =>
      expect(chrome.sent).toContainEqual({ type: "signIn", intent: "signup", account: { name: "", label: "Work laptop", ws: "" } }),
    );
  });

  it("shows a sign-in failure", async () => {
    chrome.onSend = () => ({ ok: false, error: "Sign-in was cancelled." });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign in with Calimero" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Sign-in was cancelled.");
  });

  it("no workspace: lists them and saves the choice", async () => {
    chrome.areas.local.set(KEYS.auth, { ...AUTH, workspace: null });
    chrome.onSend = (m) =>
      (m as { type: string }).type === "listWorkspaces"
        ? { ok: true, value: [{ appId: "a2", name: "Sales" }] }
        : { ok: true, value: null };
    render(<App />);
    fireEvent.click(await screen.findByRole("radio", { name: "Sales" }));
    await waitFor(() =>
      expect(chrome.sent).toContainEqual({ type: "chooseWorkspace", workspace: { appId: "a2", name: "Sales" } }),
    );
  });

  it("no workspace yet: names one here, and the window only approves it", async () => {
    chrome.areas.local.set(KEYS.auth, { ...AUTH, workspace: null });
    chrome.onSend = () => ({ ok: true, value: [] });
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Create your first workspace" })).toBeTruthy();
    expect(screen.getByText("Every word remembered. Only your team can listen.")).toBeTruthy();
    const create = screen.getByRole("button", { name: "Create workspace" });
    expect(create).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("Workspace name"), { target: { value: "Launch team" } });
    fireEvent.change(screen.getByLabelText("Your name, as your team sees it"), { target: { value: "Eve" } });
    fireEvent.click(create);
    await waitFor(() =>
      expect(chrome.sent).toContainEqual({ type: "signIn", intent: "create", workspace: { name: "Launch team", self: "Eve" } }),
    );
    expect(chrome.created).toEqual([]);
  });

  it("no workspace yet: opens an invite link to join", async () => {
    chrome.areas.local.set(KEYS.auth, { ...AUTH, workspace: null });
    chrome.onSend = () => ({ ok: true, value: [] });
    render(<App />);
    const join = await screen.findByRole("button", { name: "Join" });
    fireEvent.change(screen.getByLabelText("Invite link"), { target: { value: "not a link" } });
    expect(join).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("Invite link"), { target: { value: "https://sylence.example/?invite=abc" } });
    fireEvent.click(join);
    await waitFor(() => expect(chrome.created).toContain("https://sylence.example/?invite=abc"));
  });

  it("create another workspace: named here, made in the window", async () => {
    chrome.areas.local.set(KEYS.auth, { ...AUTH, workspace: null });
    let lists = 0;
    chrome.onSend = (m) =>
      (m as { type: string }).type === "listWorkspaces"
        ? { ok: true, value: lists++ === 0 ? [{ appId: "a1", name: "Design" }] : [{ appId: "a1", name: "Design" }, { appId: "a9", name: "New team" }] }
        : { ok: true, value: null };
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Create or join another workspace" }));
    fireEvent.change(screen.getByLabelText("Workspace name"), { target: { value: "New team" } });
    fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));
    // The service worker chooses the new workspace once the window closes.
    await waitFor(() =>
      expect(chrome.sent).toContainEqual({ type: "signIn", intent: "create", workspace: { name: "New team", self: "" } }),
    );
  });

  it("ready on a Meet call: names it and records this tab", async () => {
    chrome.areas.local.set(KEYS.auth, AUTH);
    render(<App />);
    expect(await screen.findByText("Roadmap review")).toBeTruthy();
    expect(screen.getByText("Google Meet · in a call")).toBeTruthy();
    expect(screen.getByText("Design team")).toBeTruthy();
    const record = screen.getByRole("button", { name: "Record meeting" });
    await waitFor(() => expect(record).toHaveProperty("disabled", false));
    fireEvent.click(record);
    await waitFor(() => expect(chrome.sent).toContainEqual({ type: "start", tabId: 7 }));
  });

  it("ready on another site: still offers to record the tab", async () => {
    chrome.areas.local.set(KEYS.auth, AUTH);
    chrome.activeTab = { id: 3, url: "https://example.com/webinar", title: "Webinar" };
    render(<App />);
    expect(await screen.findByRole("button", { name: "Record this tab" })).toBeTruthy();
    expect(screen.getByText(/Not a meeting tab/)).toBeTruthy();
  });

  for (const [url, title, label, button] of [
    ["https://app.zoom.us/wc/81234567890/join", "Design review - Zoom", "Zoom · in a call", "Record meeting"],
    ["https://us02web.zoom.us/j/81234567890", "Zoom Meeting", "Zoom · in a call", "Record meeting"],
    ["https://teams.microsoft.com/v2/", "Planning | Microsoft Teams", "Microsoft Teams · in a call", "Record meeting"],
    ["https://teams.live.com/meet/9381234", "Microsoft Teams", "Microsoft Teams · in a call", "Record meeting"],
    ["https://zoom.us/", "Zoom", "Zoom · join the call, then record", "Record meeting"],
    ["https://meet.jit.si/SylenceStandup", "SylenceStandup | Jitsi Meet", "Not a meeting tab — you can still record it", "Record this tab"],
    ["https://acme.webex.com/meet/ana", "Cisco Webex", "Not a meeting tab — you can still record it", "Record this tab"],
  ] as const) {
    it(`ready on ${new URL(url).hostname}${new URL(url).pathname}: ${label}`, async () => {
      chrome.areas.local.set(KEYS.auth, AUTH);
      chrome.activeTab = { id: 5, url, title };
      render(<App />);
      const record = await screen.findByRole("button", { name: button });
      // Record unlocks once this laptop is checked (a model downloaded, the mic allowed).
      await waitFor(() => expect(record).toHaveProperty("disabled", false));
      fireEvent.click(record);
      expect(screen.getByText(label)).toBeTruthy();
      await waitFor(() => expect(chrome.sent).toContainEqual({ type: "start", tabId: 5 }));
    });
  }

  it("toggles the microphone setting", async () => {
    chrome.areas.local.set(KEYS.auth, AUTH);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /Mic on/ }));
    await waitFor(() => expect((chrome.areas.local.get(KEYS.settings) as { mic: boolean }).mic).toBe(false));
    expect(await screen.findByRole("button", { name: /Mic off/ })).toBeTruthy();
  });

  it("opens the model sheet with every tier and its size", async () => {
    chrome.areas.local.set(KEYS.auth, AUTH);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Speech model" }));
    expect(await screen.findByRole("radio", { name: /Whisper large-v3 turbo/ })).toBeTruthy();
    expect(screen.getByText("1.5 GB")).toBeTruthy();
    // The small models are downloaded here (the fixture), so they say so instead of their size.
    expect(screen.getAllByText("Downloaded").length).toBeGreaterThanOrEqual(3);
    // No WebGPU here (jsdom): the turbo model is not offered.
    expect((screen.getByRole("radio", { name: /Whisper large-v3 turbo/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: /^Moonshine tiny/ }));
    await waitFor(() => expect((chrome.areas.local.get(KEYS.settings) as { tier: string }).tier).toBe("ultralight"));
  });

  it("recording: shows the meeting, live lines and levels, and stops", async () => {
    chrome.areas.local.set(KEYS.auth, AUTH);
    const status: RecorderStatus = {
      ...IDLE,
      phase: "recording",
      tier: "light",
      meeting: { id: "m1", appId: "app-1", title: "Roadmap review", platform: "meet", startedAt: Date.now() - 65_000 },
      lines: [{ speaker: "others", text: "Shall we start?", startMs: 1_000 }],
    };
    chrome.areas.session.set(KEYS.status, status);
    render(<App />);
    expect(await screen.findByText("Shall we start?")).toBeTruthy();
    expect(screen.getByText("1:05")).toBeTruthy();
    expect(screen.getByText(/Moonshine base · on this laptop/)).toBeTruthy();
    act(() => chrome.broadcast({ source: "offscreen", type: "levels", you: 0.05, others: 0 }));
    await waitFor(() => expect(screen.getByRole("meter", { name: "You" }).getAttribute("aria-valuenow")).not.toBe("0"));
    fireEvent.click(screen.getByRole("button", { name: /Live transcript/ }));
    expect(chrome.panels).toEqual([7]);
    fireEvent.click(screen.getByRole("button", { name: /Stop/ }));
    await waitFor(() => expect(types()).toContain("stop"));
  });

  it("saved: links to the meeting", async () => {
    chrome.areas.local.set(KEYS.auth, AUTH);
    chrome.areas.session.set(KEYS.status, {
      ...IDLE,
      phase: "saved",
      link: "https://sylence.example/0.1.0/#/w/app-1/m/m1",
      meeting: { id: "m1", appId: "app-1", title: "Roadmap review", platform: "meet", startedAt: 0 },
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /Open in Sylence/ }));
    expect(chrome.created).toEqual(["https://sylence.example/0.1.0/#/w/app-1/m/m1"]);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(types()).toContain("dismiss"));
  });

  it("settings: signs out and checks the development page", async () => {
    chrome.areas.local.set(KEYS.auth, AUTH);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    // The sign-in page and diagnostics are hidden until Developer mode is on.
    expect(screen.queryByLabelText("Sign-in page")).toBeNull();
    fireEvent.click(await screen.findByRole("switch", { name: "Developer mode" }));
    const input = await screen.findByLabelText("Sign-in page");
    expect(screen.getByText("Copy diagnostics")).toBeTruthy();
    fireEvent.change(input, { target: { value: "http://evil.example" } });
    expect(screen.getByText(/Use an https:\/\/ address/)).toBeTruthy();
    fireEvent.change(input, { target: { value: "http://localhost:5173" } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect((chrome.areas.local.get(KEYS.settings) as { pageOverride: string }).pageOverride).toBe("http://localhost:5173"),
    );
    fireEvent.click(screen.getByRole("button", { name: /Log out/ }));
    await waitFor(() => expect(types()).toContain("signOut"));
  });

  it("checks the session once when it opens signed in", async () => {
    chrome.areas.local.set(KEYS.auth, AUTH);
    render(<App />);
    await waitFor(() => expect(types().filter((t) => t === "checkSession")).toHaveLength(1));
  });

  it("says why it signed itself out", async () => {
    chrome.areas.session.set(KEYS.signedOutReason, "Your session ended or the account no longer exists. Sign in again.");
    render(<App />);
    expect((await screen.findByRole("status")).textContent).toContain("no longer exists");
    expect(types()).not.toContain("checkSession");
  });

  it("says who found the action items when a meeting is saved", async () => {
    chrome.areas.local.set(KEYS.auth, AUTH);
    chrome.areas.session.set(KEYS.status, {
      ...IDLE,
      phase: "saved",
      meeting: { id: "m1", appId: "a1", title: "Sync", platform: "meet", startedAt: 0 },
      link: "http://x/#/m/m1",
      actions: 2,
      wroteSummary: true,
      notesBy: { kind: "model", model: "better" },
    });
    render(<App />);
    expect((await screen.findByTestId("notes-by")).textContent).toBe("Written by Qwen2.5 1.5B on this laptop.");
    expect(screen.getByText("A summary and 2 action items added from the transcript.")).toBeTruthy();
  });

  it("smart notes are an experimental setting, off until turned on", async () => {
    chrome.areas.local.set(KEYS.auth, AUTH);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    expect(await screen.findByText("Experimental")).toBeTruthy();
    const toggle = screen.getByRole("switch", { name: "Smart notes and summary" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByRole("radiogroup", { name: "Smart notes model" })).toBeNull();
    fireEvent.click(toggle);
    await waitFor(() => expect((chrome.areas.local.get(KEYS.settings) as { smartNotes: boolean }).smartNotes).toBe(true));
  });

  it("smart notes settings: lists the models and says why they can't run without WebGPU", async () => {
    chrome.areas.local.set(KEYS.auth, AUTH);
    chrome.areas.local.set(KEYS.settings, { ...DEFAULT_SETTINGS, smartNotes: true });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    const group = await screen.findByRole("radiogroup", { name: "Smart notes model" });
    expect(within(group).getAllByRole("radio").map((r) => r.querySelector(".name")!.textContent)).toEqual([
      "Automatic",
      "Qwen2.5 1.5B",
      "Qwen2.5 0.5B",
    ]);
    // jsdom has no WebGPU: the models can't run here and it says so.
    expect(await screen.findByText(/doesn't offer WebGPU/)).toBeTruthy();
    expect((within(group).getByRole("radio", { name: /Qwen2.5 0.5B/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId("notes-download")).toBeNull();
  });

  it("the two switches work on their own: Smart notes don't need Find action items", async () => {
    chrome.areas.local.set(KEYS.auth, AUTH);
    chrome.areas.local.set(KEYS.settings, { ...DEFAULT_SETTINGS, autoActions: false, smartNotes: true });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    expect((await screen.findByRole("switch", { name: "Find action items" })).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("switch", { name: "Smart notes and summary" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByText(/Turn on Find action items/)).toBeNull();
    expect(screen.getByRole("radiogroup", { name: "Smart notes model" })).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Find action items" }));
    await waitFor(() => expect((chrome.areas.local.get(KEYS.settings) as { autoActions: boolean }).autoActions).toBe(true));
    expect((chrome.areas.local.get(KEYS.settings) as { smartNotes: boolean }).smartNotes).toBe(true);
  });

  it("improving the transcript after the call: locked on a laptop that can't run the big model", async () => {
    chrome.areas.local.set(KEYS.auth, AUTH);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    const toggle = await screen.findByRole("switch", { name: "Improve the transcript after the call" });
    await waitFor(() => expect(toggle).toHaveProperty("disabled", true));
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText(/Off on this laptop\. Needs a graphics chip/)).toBeTruthy();
  });

  it("improving the transcript after the call: unlocks with the big model downloaded on a strong laptop", async () => {
    strongLaptop();
    modelsCached(["onnx-community/whisper-large-v3-turbo", "onnx-community/moonshine-base-ONNX"]);
    chrome.areas.local.set(KEYS.auth, AUTH);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    const toggle = await screen.findByRole("switch", { name: "Improve the transcript after the call" });
    await waitFor(() => expect(toggle).toHaveProperty("disabled", false));
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);
    await waitFor(() => expect((chrome.areas.local.get(KEYS.settings) as { improveAfterCall: boolean }).improveAfterCall).toBe(false));
  });

  it("find action items: locked until a speech model is downloaded", async () => {
    modelsCached([]);
    chrome.areas.local.set(KEYS.auth, AUTH);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    const toggle = await screen.findByRole("switch", { name: "Find action items" });
    await waitFor(() => expect(toggle).toHaveProperty("disabled", true));
    expect(screen.getByText(/Unlocks once a speech model is downloaded/)).toBeTruthy();
  });

  it("shows the second pass's progress, then says the transcript was improved", async () => {
    chrome.areas.local.set(KEYS.auth, AUTH);
    const meeting = { id: "m1", appId: "app-1", title: "Roadmap review", platform: "meet" as const, startedAt: 0 };
    chrome.areas.session.set(KEYS.status, { ...IDLE, phase: "improving", meeting, improve: { step: "transcribe", fraction: 0.4 } });
    const { unmount } = render(<App />);
    expect(await screen.findByText("Improving the transcript")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Improving the transcript" }).getAttribute("aria-valuenow")).toBe("40");
    unmount();
    chrome.areas.session.set(KEYS.status, { ...IDLE, phase: "saved", meeting, link: "x", improved: { done: true } });
    render(<App />);
    expect((await screen.findByTestId("improved")).textContent).toMatch(/Transcript improved after the call/);
  });

  it("says no action items were found, and why", async () => {
    chrome.areas.local.set(KEYS.auth, AUTH);
    chrome.areas.session.set(KEYS.status, {
      ...IDLE,
      phase: "saved",
      link: "x",
      actions: 0,
      notesBy: { kind: "phrases", why: "" },
      meeting: { id: "m1", appId: "app-1", title: "Roadmap review", platform: "meet", startedAt: 0 },
    });
    render(<App />);
    expect((await screen.findByTestId("notes-by")).textContent).toMatch(/^No action items found/);
  });

  it("won't record until the speech model is downloaded, and offers the download", async () => {
    modelsCached([]);
    chrome.areas.local.set(KEYS.auth, AUTH);
    render(<App />);
    expect(await screen.findByTestId("need-model")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Record meeting" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: /^Download / }));
    await waitFor(() => expect(types()).toContain("preload"));
    expect(types()).not.toContain("start");
  });

  it("won't record with the mic on until the microphone is allowed; Mic off records the call alone", async () => {
    micPermission("prompt");
    chrome.areas.local.set(KEYS.auth, AUTH);
    render(<App />);
    await waitFor(async () => expect((await screen.findByTestId("need-mic")).textContent).toMatch(/Allow the microphone/));
    expect(screen.getByRole("button", { name: "Record meeting" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: /Mic on/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Record meeting" })).toHaveProperty("disabled", false));
  });

  it("deletes a workspace only once its name is typed back", async () => {
    chrome.areas.local.set(KEYS.auth, { ...AUTH, workspace: null });
    chrome.onSend = (m) =>
      (m as { type: string }).type === "listWorkspaces" ? { ok: true, value: [{ appId: "a2", name: "Sales" }] } : { ok: true, value: null };
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete Sales" }));
    const del = screen.getByRole("button", { name: "Delete workspace" });
    expect(del).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText(/to confirm/), { target: { value: "Sales" } });
    fireEvent.click(del);
    await waitFor(() => expect(chrome.sent).toContainEqual({ type: "deleteWorkspace", appId: "a2" }));
  });
});
