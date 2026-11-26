/**
 * The speaker reader as it runs in the call tab, on a snapshot of each call
 * page: it finds who is talking and tells the service worker, and stops when
 * told. Meet, Zoom and Teams each have their own page; any other site gets no
 * names (the recording still works, lines are "Others" / "You").
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpeakersEvent } from "../lib/messages";

const sent: SpeakersEvent[] = [];
let onMessage: ((m: unknown) => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  sent.length = 0;
  vi.stubGlobal("chrome", {
    runtime: {
      sendMessage: async (m: SpeakersEvent) => {
        sent.push(m);
      },
      onMessage: {
        addListener: (l: (m: unknown) => void) => (onMessage = l),
        removeListener: () => (onMessage = null),
      },
    },
  });
});
afterEach(() => {
  window.__sylenceSpeakers?.stop();
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function reader(url: string, html: string) {
  document.body.innerHTML = html;
  const { start } = await import("./speakers");
  window.__sylenceSpeakers?.stop();
  window.__sylenceSpeakers = start(url);
  await vi.advanceTimersByTimeAsync(300);
}

const CALLS: { name: string; url: string; html: string; speaking: string[]; participants?: string[]; via: string }[] = [
  {
    name: "Google Meet, captions on (names twice in the DOM)",
    url: "https://meet.google.com/abc-defg-hij",
    html: `
      <div data-participant-id="p1"><div class="zWGUib">Sandi Fatic<span class="sr">Sandi Fatic</span></div></div>
      <div data-participant-id="p2"><div class="zWGUib">Fran</div><span>(You)</span></div>
      <div role="region" aria-label="Captions">
        <div><img alt="" src="a.png"><div class="KcIKyf">Sandi FaticSandi Fatic</div><div class="bh44bd">So the plan for today</div></div>
      </div>`,
    speaking: ["Sandi Fatic"],
    participants: ["Sandi Fatic", "Fran"],
    via: "meet-captions",
  },
  {
    name: "Zoom web client",
    url: "https://app.zoom.us/wc/81234567890/join",
    html: `
      <div class="speaker-active-container__video-frame"><div class="video-avatar__avatar-footer"><span class="video-avatar__avatar-name">Ana Horvat</span></div></div>
      <div class="speaker-bar-container__video-frame"><span class="video-avatar__avatar-name">Marko</span></div>`,
    speaking: ["Ana Horvat"],
    via: "zoom-active",
  },
  {
    name: "Zoom on a company subdomain",
    url: "https://us02web.zoom.us/wc/81234567890/start",
    html: `<div class="speaker-active-container__video-frame"><span class="video-avatar__avatar-name">Marko (Host)</span></div>`,
    speaking: ["Marko"],
    via: "zoom-active",
  },
  {
    name: "Microsoft Teams, captions on",
    url: "https://teams.microsoft.com/v2/",
    html: `<div class="ui-chat__item"><span data-tid="author">Ana Horvat</span><span data-tid="closed-caption-text">Let's begin.</span></div>`,
    speaking: ["Ana Horvat"],
    via: "teams-captions",
  },
  {
    name: "Microsoft Teams, speaking outline",
    url: "https://teams.live.com/v2/",
    html: `
      <div data-cid="calling-participant-stream" aria-label="Ana Horvat, video on">
        <div data-tid="voice-level-stream-outline" class="fui-x vdi-frame-occlusion"></div>
      </div>
      <div data-cid="calling-participant-stream" aria-label="Marko, muted">
        <div data-tid="voice-level-stream-outline" class="fui-x"></div>
      </div>`,
    speaking: ["Ana Horvat"],
    via: "teams-tiles",
  },
];

describe("speaker reader in the call tab", () => {
  for (const call of CALLS) {
    it(call.name, async () => {
      await reader(call.url, call.html);
      const last = sent.at(-1)!;
      expect(last).toMatchObject({ source: "speakers", type: "speakers", speaking: call.speaking, via: call.via });
      if (call.participants) expect(last.participants).toEqual(call.participants);
    });
  }

  it("Meet: says who is you", async () => {
    await reader(CALLS[0]!.url, CALLS[0]!.html);
    expect(sent.at(-1)!.self).toBe("Fran");
  });

  it("any other site: names nobody, sends nothing that names anyone", async () => {
    await reader("https://meet.jit.si/SylenceStandup", `<div class="displayname">Ana</div>`);
    for (const e of sent) expect(e.speaking).toEqual([]);
  });

  it("sends only changes, plus a heartbeat, and stops when told", async () => {
    await reader(CALLS[2]!.url, CALLS[2]!.html);
    const first = sent.length;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sent.length).toBe(first);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sent.length).toBe(first + 1);
    onMessage!({ target: "speakers", type: "stop" });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(sent.length).toBe(first + 1);
    expect(window.__sylenceSpeakers).toBeUndefined();
  });
});
