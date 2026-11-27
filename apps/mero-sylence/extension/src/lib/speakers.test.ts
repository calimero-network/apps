import { describe, expect, it } from "vitest";
import {
  ActivityTracker,
  CaptionTracker,
  cleanName,
  meetCaptions,
  nameFor,
  newReaderState,
  pushChange,
  readSpeakers,
  teamsCaptions,
  teamsSpeaking,
  zoomSpeaking,
} from "./speakers";

const page = (html: string): Document => new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");

describe("cleanName", () => {
  it("keeps names and drops what the call adds", () => {
    expect(cleanName("  Eve Parker (Guest) ")).toBe("Eve Parker");
    expect(cleanName("Sam TaylorSam Taylor")).toBe("Sam Taylor");
    expect(cleanName("Eve Parker Eve Parker")).toBe("Eve Parker");
    expect(cleanName("Anna")).toBe("Anna");
    expect(cleanName("John (Host)")).toBe("John");
    expect(cleanName("Presentation from Eve")).toBe("Eve");
    expect(cleanName("Željka")).toBe("Željka");
  });
  it("refuses labels and icon ligatures", () => {
    for (const s of ["You", "more_vert", "mic_off", "keep", "", "   ", "12:30", "Pin"]) expect(cleanName(s)).toBeNull();
  });
});

describe("nameFor", () => {
  const T = 10_000;
  const timeline = [
    { at: T, names: ["Eve"] },
    { at: T + 3_000, names: [] },
    { at: T + 4_000, names: ["John"] },
    { at: T + 9_000, names: ["Eve", "John"] },
  ];
  it("picks whoever talked for most of the line", () => {
    expect(nameFor(timeline, T + 200, T + 2_800)).toBe("Eve");
    expect(nameFor(timeline, T + 4_200, T + 8_000)).toBe("John");
    // Mostly Eve, a little of John at the start.
    expect(nameFor(timeline, T - 500, T + 2_900)).toBe("Eve");
  });
  it("leaves the recorder out of the call's audio", () => {
    expect(nameFor([{ at: T, names: ["Alex", "Eve"] }], T, T + 2_000, { exclude: "Alex" })).toBe("Eve");
    expect(nameFor([{ at: T, names: ["Alex"] }], T, T + 2_000, { exclude: "Alex" })).toBe("");
  });
  it("names the only other person in a two-person call when the page showed nobody", () => {
    expect(nameFor([], T, T + 2_000, { exclude: "Alex", participants: ["Alex", "Eve"] })).toBe("Eve");
    expect(nameFor([], T, T + 2_000, { exclude: "Alex", participants: ["Alex", "Eve", "John"] })).toBe("");
  });
  it("names a line two talked over: the one who held the indicator most, else who spoke just before", () => {
    const flicker = [
      { at: T, names: ["Eve"] },
      { at: T + 200, names: [] },
      { at: T + 900, names: ["John"] },
      { at: T + 1_100, names: [] },
    ];
    expect(nameFor(flicker, T, T + 6_000)).toBe("Eve");
    const before = [{ at: T, names: ["John"] }, { at: T + 2_000, names: [] }];
    expect(nameFor(before, T + 2_600, T + 8_000)).toBe("John");
  });
  it("needs enough overlap", () => {
    expect(nameFor([{ at: T, names: ["Eve"] }, { at: T + 100, names: [] }], T + 2_000, T + 6_000)).toBe("");
  });
});

describe("pushChange", () => {
  it("adds only changes and stays bounded", () => {
    let t = pushChange([], { at: 1, names: ["A"] });
    t = pushChange(t, { at: 2, names: ["A"] });
    expect(t).toHaveLength(1);
    for (let i = 0; i < 10; i++) t = pushChange(t, { at: 3 + i, names: [String(i)] }, 5);
    expect(t).toHaveLength(5);
    expect(t.at(-1)!.names).toEqual(["9"]);
  });
});

describe("captions", () => {
  it("the speaker is whoever's caption is growing", () => {
    const tr = new CaptionTracker(1_000);
    expect(tr.update([{ name: "Eve", text: "Hello" }], 0)).toEqual(["Eve"]);
    expect(tr.update([{ name: "Eve", text: "Hello there" }], 300)).toEqual(["Eve"]);
    expect(tr.update([{ name: "Eve", text: "Hello there" }, { name: "John", text: "Hi" }], 600)).toEqual(["Eve", "John"]);
    expect(tr.update([{ name: "Eve", text: "Hello there" }, { name: "John", text: "Hi all" }], 1_500)).toEqual(["John"]);
    expect(tr.update([{ name: "Eve", text: "Hello there" }, { name: "John", text: "Hi all" }], 3_000)).toEqual([]);
  });

  it("reads Meet's captions region", () => {
    const doc = page(`
      <div role="region" aria-label="Captions">
        <div><img alt="" src="a.png"><div class="KcIKyf">Eve Parker</div><div class="bh44bd">So the plan for today</div></div>
        <div><img alt="" src="m.png"><div class="KcIKyf">John</div><div class="bh44bd">Sounds good</div></div>
      </div>`);
    const blocks = meetCaptions(doc);
    expect(blocks.map((b) => b.name)).toEqual(["Eve Parker", "John"]);
    expect(blocks[0]!.text).toContain("So the plan for today");
  });

  it("reads Teams' live captions", () => {
    const doc = page(`
      <div class="ui-chat__item"><span data-tid="author">Eve Parker</span><span data-tid="closed-caption-text">Let's begin.</span></div>
      <div class="ui-chat__item"><span data-tid="author">John (Guest)</span><span data-tid="closed-caption-text">Okay.</span></div>`);
    expect(teamsCaptions(doc)).toEqual([
      { name: "Eve Parker", text: "Let's begin." },
      { name: "John", text: "Okay." },
    ]);
  });
});

describe("tiles", () => {
  it("Zoom: the active speaker's frame", () => {
    const doc = page(`
      <div class="speaker-active-container__video-frame"><div class="video-avatar__avatar-footer"><span class="video-avatar__avatar-name">Eve</span></div></div>
      <div class="speaker-bar-container__video-frame"><span class="video-avatar__avatar-name">John</span></div>`);
    expect(zoomSpeaking(doc)).toEqual(["Eve"]);
  });

  it("Teams: the lit voice-level outline", () => {
    const doc = page(`
      <div data-cid="calling-participant-stream" aria-label="Eve Parker, video on">
        <div data-tid="voice-level-stream-outline" class="fui-x vdi-frame-occlusion"></div>
      </div>
      <div data-cid="calling-participant-stream" aria-label="John, muted">
        <div data-tid="voice-level-stream-outline" class="fui-x"></div>
      </div>`);
    expect(teamsSpeaking(doc)).toEqual(["Eve Parker"]);
  });

  it("Meet: the tile whose audio bars animate", () => {
    const doc = page(`
      <div data-participant-id="p1"><div class="zWGUib">Eve</div><div class="bars"><i>more_vert</i></div></div>
      <div data-participant-id="p2"><div class="zWGUib">John</div><div class="bars"></div></div>
      <div data-participant-id="p3"><div class="zWGUib">Alex</div><span>(You)</span></div>`);
    const state = newReaderState();
    const bars = doc.querySelector('[data-participant-id="p2"] .bars')!;
    for (let i = 0; i < 6; i++) state.activity.record(bars, 1_000 + i * 80);
    state.activity.record(doc.querySelector('[data-participant-id="p1"] .bars')!, 1_100);
    const s = readSpeakers(doc, "meet", state, 1_500);
    expect(s.speaking).toEqual(["John"]);
    expect(s.participants).toEqual(["Eve", "John", "Alex"]);
    expect(s.self).toBe("Alex");
    expect(s.via).toBe("meet-tiles");
    // Quiet again: nobody.
    expect(readSpeakers(doc, "meet", state, 5_000).speaking).toEqual([]);
  });

  it("activity ignores video frames", () => {
    const a = new ActivityTracker(500, 2);
    const doc = page(`<div data-participant-id="p"><video></video></div>`);
    for (let i = 0; i < 5; i++) a.record(doc.querySelector("video")!, i);
    expect(a.busiest(10)).toEqual([]);
  });
});
