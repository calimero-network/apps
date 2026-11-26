import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { IDLE, KEYS, type AuthState, type RecorderStatus } from "../../lib/messages";
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
beforeEach(() => {
  chrome = installFakeChrome();
  chrome.activeTab = MEET;
});

const types = () => chrome.sent.map((m) => (m as { type: string }).type);

describe("popup", () => {
  it("signed out: offers sign-in and asks the service worker", async () => {
    render(<App />);
    const button = await screen.findByRole("button", { name: "Sign in with Calimero" });
    expect(screen.getByText(/Audio is never uploaded/)).toBeTruthy();
    fireEvent.click(button);
    await waitFor(() => expect(types()).toContain("signIn"));
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

  it("no workspace yet: reopens the sign-in window, which offers one", async () => {
    chrome.areas.local.set(KEYS.auth, { ...AUTH, workspace: null });
    chrome.onSend = () => ({ ok: true, value: [] });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /Create a workspace/ }));
    await waitFor(() => expect(types()).toContain("signIn"));
    expect(chrome.created).toEqual([]);
  });

  it("create another workspace: asks the window for a new one and switches to it", async () => {
    chrome.areas.local.set(KEYS.auth, { ...AUTH, workspace: null });
    let lists = 0;
    chrome.onSend = (m) =>
      (m as { type: string }).type === "listWorkspaces"
        ? { ok: true, value: lists++ === 0 ? [{ appId: "a1", name: "Design" }] : [{ appId: "a1", name: "Design" }, { appId: "a9", name: "New team" }] }
        : { ok: true, value: null };
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Create another workspace" }));
    await waitFor(() => expect(chrome.sent).toContainEqual({ type: "signIn", intent: "create" }));
    await waitFor(() =>
      expect(chrome.sent).toContainEqual({ type: "chooseWorkspace", workspace: { appId: "a9", name: "New team" } }),
    );
  });

  it("ready on a Meet call: names it and records this tab", async () => {
    chrome.areas.local.set(KEYS.auth, AUTH);
    render(<App />);
    expect(await screen.findByText("Roadmap review")).toBeTruthy();
    expect(screen.getByText("Google Meet · in a call")).toBeTruthy();
    expect(screen.getByText("Design team")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Record meeting" }));
    await waitFor(() => expect(chrome.sent).toContainEqual({ type: "start", tabId: 7 }));
  });

  it("ready on another site: still offers to record the tab", async () => {
    chrome.areas.local.set(KEYS.auth, AUTH);
    chrome.activeTab = { id: 3, url: "https://example.com/webinar", title: "Webinar" };
    render(<App />);
    expect(await screen.findByRole("button", { name: "Record this tab" })).toBeTruthy();
    expect(screen.getByText(/Not a meeting tab/)).toBeTruthy();
  });

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
    expect(screen.getByText("28 MB")).toBeTruthy();
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
    fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));
    const input = screen.getByLabelText("Sign-in page");
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

  it("smart notes settings: lists the models and says why they can't run without WebGPU", async () => {
    chrome.areas.local.set(KEYS.auth, AUTH);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    const group = await screen.findByRole("radiogroup", { name: "Smart notes model" });
    expect(within(group).getAllByRole("radio").map((r) => r.querySelector(".name")!.textContent)).toEqual([
      "Automatic",
      "Qwen2.5 1.5B",
      "Qwen2.5 0.5B",
      "Off",
    ]);
    // jsdom has no WebGPU: the models can't run here, it says so, and only Off is offered.
    expect(await screen.findByText(/doesn't offer WebGPU/)).toBeTruthy();
    expect((within(group).getByRole("radio", { name: /Qwen2.5 0.5B/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId("notes-download")).toBeNull();
    fireEvent.click(within(group).getByRole("radio", { name: /^Off/ }));
    await waitFor(() => expect((chrome.areas.local.get(KEYS.settings) as { notesModel: string }).notesModel).toBe("off"));
  });
});
