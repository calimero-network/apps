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
      <div data-participant-id="p1"><div class="zWGUib">Sam Taylor<span class="sr">Sam Taylor</span></div></div>
      <div data-participant-id="p2"><div class="zWGUib">Alex</div><span>(You)</span></div>
      <div role="region" aria-label="Captions">
        <div><img alt="" src="a.png"><div class="KcIKyf">Sam TaylorSam Taylor</div><div class="bh44bd">So the plan for today</div></div>
      </div>`,
    speaking: ["Sam Taylor"],
    participants: ["Sam Taylor", "Alex"],
    via: "meet-captions",
  },
  {
    name: "Zoom web client",
    url: "https://app.zoom.us/wc/81234567890/join",
    html: `
      <div class="speaker-active-container__video-frame"><div class="video-avatar__avatar-footer"><span class="video-avatar__avatar-name">Eve Parker</span></div></div>
      <div class="speaker-bar-container__video-frame"><span class="video-avatar__avatar-name">John</span></div>`,
    speaking: ["Eve Parker"],
    via: "zoom-active",
  },
  {
    name: "Zoom on a company subdomain",
    url: "https://us02web.zoom.us/wc/81234567890/start",
    html: `<div class="speaker-active-container__video-frame"><span class="video-avatar__avatar-name">John (Host)</span></div>`,
    speaking: ["John"],
    via: "zoom-active",
  },
  {
    name: "Microsoft Teams, captions on",
    url: "https://teams.microsoft.com/v2/",
    html: `<div class="ui-chat__item"><span data-tid="author">Eve Parker</span><span data-tid="closed-caption-text">Let's begin.</span></div>`,
    speaking: ["Eve Parker"],
    via: "teams-captions",
  },
  {
    name: "Microsoft Teams, speaking outline",
    url: "https://teams.live.com/v2/",
    html: `
      <div data-cid="calling-participant-stream" aria-label="Eve Parker, video on">
        <div data-tid="voice-level-stream-outline" class="fui-x vdi-frame-occlusion"></div>
      </div>
      <div data-cid="calling-participant-stream" aria-label="John, muted">
        <div data-tid="voice-level-stream-outline" class="fui-x"></div>
      </div>`,
    speaking: ["Eve Parker"],
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
    expect(sent.at(-1)!.self).toBe("Alex");
  });

  it("any other site: names nobody, sends nothing that names anyone", async () => {
    await reader("https://meet.jit.si/SylenceStandup", `<div class="displayname">Eve</div>`);
    for (const e of sent) expect(e.speaking).toEqual([]);
  });

  describe("Meet while Fran presents (John and Milton in the call)", () => {
    const URL_ = "https://meet.google.com/abc-defg-hij";
    const tile = (id: string, name: string, extra = "") =>
      `<div data-participant-id="${id}"><div class="zWGUib">${name}</div>${extra}<div class="bars" id="bars-${id}"></div></div>`;
    /** Animates a tile's audio bars as Meet does while that person talks. */
    async function talk(id: string, ms = 600) {
      const bars = document.getElementById(`bars-${id}`)!;
      for (let t = 0; t < ms; t += 100) {
        bars.className = bars.className === "a" ? "b" : "a";
        await vi.advanceTimersByTimeAsync(100);
      }
    }
    /** The shared screen's picture changing all the time. */
    async function flicker(id: string, ms = 600) {
      const el = document.getElementById(`bars-${id}`)!;
      for (let t = 0; t < ms; t += 50) {
        el.style.opacity = String(Math.random());
        await vi.advanceTimersByTimeAsync(50);
      }
    }
    const spoke = () => sent.filter((e) => e.speaking.length).at(-1)?.speaking;

    it("before presenting: the talking tile names John", async () => {
      await reader(URL_, tile("f", "Fran", "<span>(You)</span>") + tile("j", "John") + tile("m", "Milton"));
      await talk("j");
      expect(spoke()).toEqual(["John"]);
      expect(sent.at(-1)!.participants).toEqual(["Fran", "John", "Milton"]);
    });

    it("the screen's tile, flickering, is never a speaker, and John and Milton are still named", async () => {
      await reader(
        URL_,
        tile("f", "Fran", "<span>(You)</span>") +
          tile("spaces/x/devices/f-presentation", "Fran (Presentation)") +
          tile("j", "John") +
          tile("m", "Milton"),
      );
      const flickering = flicker("spaces/x/devices/f-presentation", 1_200);
      await talk("j");
      await flickering;
      expect(spoke()).toEqual(["John"]);
      await talk("m");
      expect(spoke()).toEqual(["Milton"]);
      for (const e of sent) expect(e.participants).not.toContain("Fran (Presentation)");
    });

    it("the strip of people inside the presentation's tile: each person is their own tile", async () => {
      await reader(
        URL_,
        `<div data-participant-id="f" aria-label="You are presenting">
           <div class="zWGUib">You are presenting</div><button aria-label="Stop presenting">Stop presenting</button>
           <div class="bars" id="bars-f"></div>
           <div class="strip">${tile("j", "John")}${tile("m", "Milton")}</div>
         </div>`,
      );
      await talk("m");
      expect(spoke()).toEqual(["Milton"]);
      expect(sent.at(-1)!.participants).toEqual(["John", "Milton"]);
    });

    it("the Meet tab in the background (timers slowed to a crawl): the page's changes still read who talks", async () => {
      await reader(URL_, tile("f", "Fran", "<span>(You)</span>") + tile("j", "John") + tile("m", "Milton"));
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      try {
        // No timer fires: only the page changing, as in a throttled background tab.
        const bars = document.getElementById("bars-j")!;
        for (let i = 0; i < 8; i++) {
          vi.setSystemTime(Date.now() + 100);
          bars.className = i % 2 ? "a" : "b";
          await Promise.resolve();
          await new Promise<void>((r) => queueMicrotask(r));
        }
        expect(spoke()).toEqual(["John"]);
        expect(sent.at(-1)!.hidden).toBe(true);
      } finally {
        delete (document as { hidden?: boolean }).hidden;
      }
    });
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
