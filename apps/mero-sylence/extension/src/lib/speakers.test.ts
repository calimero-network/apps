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
    expect(cleanName("  Ana Horvat (Guest) ")).toBe("Ana Horvat");
    expect(cleanName("Sandi FaticSandi Fatic")).toBe("Sandi Fatic");
    expect(cleanName("Ana Horvat Ana Horvat")).toBe("Ana Horvat");
    expect(cleanName("Anna")).toBe("Anna");
    expect(cleanName("Marko (Host)")).toBe("Marko");
    expect(cleanName("Presentation from Ana")).toBe("Ana");
    expect(cleanName("Željka")).toBe("Željka");
  });
  it("refuses labels and icon ligatures", () => {
    for (const s of ["You", "more_vert", "mic_off", "keep", "", "   ", "12:30", "Pin"]) expect(cleanName(s)).toBeNull();
  });
});

describe("nameFor", () => {
  const T = 10_000;
  const timeline = [
    { at: T, names: ["Ana"] },
    { at: T + 3_000, names: [] },
    { at: T + 4_000, names: ["Marko"] },
    { at: T + 9_000, names: ["Ana", "Marko"] },
  ];
  it("picks whoever talked for most of the line", () => {
    expect(nameFor(timeline, T + 200, T + 2_800)).toBe("Ana");
    expect(nameFor(timeline, T + 4_200, T + 8_000)).toBe("Marko");
    // Mostly Ana, a little of Marko at the start.
    expect(nameFor(timeline, T - 500, T + 2_900)).toBe("Ana");
  });
  it("leaves the recorder out of the call's audio", () => {
    expect(nameFor([{ at: T, names: ["Fran", "Ana"] }], T, T + 2_000, { exclude: "Fran" })).toBe("Ana");
    expect(nameFor([{ at: T, names: ["Fran"] }], T, T + 2_000, { exclude: "Fran" })).toBe("");
  });
  it("names the only other person in a two-person call when the page showed nobody", () => {
    expect(nameFor([], T, T + 2_000, { exclude: "Fran", participants: ["Fran", "Ana"] })).toBe("Ana");
    expect(nameFor([], T, T + 2_000, { exclude: "Fran", participants: ["Fran", "Ana", "Marko"] })).toBe("");
  });
  it("names a line two talked over: the one who held the indicator most, else who spoke just before", () => {
    const flicker = [
      { at: T, names: ["Ana"] },
      { at: T + 200, names: [] },
      { at: T + 900, names: ["Marko"] },
      { at: T + 1_100, names: [] },
    ];
    expect(nameFor(flicker, T, T + 6_000)).toBe("Ana");
    const before = [{ at: T, names: ["Marko"] }, { at: T + 2_000, names: [] }];
    expect(nameFor(before, T + 2_600, T + 8_000)).toBe("Marko");
  });
  it("needs enough overlap", () => {
    expect(nameFor([{ at: T, names: ["Ana"] }, { at: T + 100, names: [] }], T + 2_000, T + 6_000)).toBe("");
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
    expect(tr.update([{ name: "Ana", text: "Hello" }], 0)).toEqual(["Ana"]);
    expect(tr.update([{ name: "Ana", text: "Hello there" }], 300)).toEqual(["Ana"]);
    expect(tr.update([{ name: "Ana", text: "Hello there" }, { name: "Marko", text: "Hi" }], 600)).toEqual(["Ana", "Marko"]);
    expect(tr.update([{ name: "Ana", text: "Hello there" }, { name: "Marko", text: "Hi all" }], 1_500)).toEqual(["Marko"]);
    expect(tr.update([{ name: "Ana", text: "Hello there" }, { name: "Marko", text: "Hi all" }], 3_000)).toEqual([]);
  });

  it("reads Meet's captions region", () => {
    const doc = page(`
      <div role="region" aria-label="Captions">
        <div><img alt="" src="a.png"><div class="KcIKyf">Ana Horvat</div><div class="bh44bd">So the plan for today</div></div>
        <div><img alt="" src="m.png"><div class="KcIKyf">Marko</div><div class="bh44bd">Sounds good</div></div>
      </div>`);
    const blocks = meetCaptions(doc);
    expect(blocks.map((b) => b.name)).toEqual(["Ana Horvat", "Marko"]);
    expect(blocks[0]!.text).toContain("So the plan for today");
  });

  it("reads Teams' live captions", () => {
    const doc = page(`
      <div class="ui-chat__item"><span data-tid="author">Ana Horvat</span><span data-tid="closed-caption-text">Let's begin.</span></div>
      <div class="ui-chat__item"><span data-tid="author">Marko (Guest)</span><span data-tid="closed-caption-text">Okay.</span></div>`);
    expect(teamsCaptions(doc)).toEqual([
      { name: "Ana Horvat", text: "Let's begin." },
      { name: "Marko", text: "Okay." },
    ]);
  });
});

describe("tiles", () => {
  it("Zoom: the active speaker's frame", () => {
    const doc = page(`
      <div class="speaker-active-container__video-frame"><div class="video-avatar__avatar-footer"><span class="video-avatar__avatar-name">Ana</span></div></div>
      <div class="speaker-bar-container__video-frame"><span class="video-avatar__avatar-name">Marko</span></div>`);
    expect(zoomSpeaking(doc)).toEqual(["Ana"]);
  });

  it("Teams: the lit voice-level outline", () => {
    const doc = page(`
      <div data-cid="calling-participant-stream" aria-label="Ana Horvat, video on">
        <div data-tid="voice-level-stream-outline" class="fui-x vdi-frame-occlusion"></div>
      </div>
      <div data-cid="calling-participant-stream" aria-label="Marko, muted">
        <div data-tid="voice-level-stream-outline" class="fui-x"></div>
      </div>`);
    expect(teamsSpeaking(doc)).toEqual(["Ana Horvat"]);
  });

  it("Meet: the tile whose audio bars animate", () => {
    const doc = page(`
      <div data-participant-id="p1"><div class="zWGUib">Ana</div><div class="bars"><i>more_vert</i></div></div>
      <div data-participant-id="p2"><div class="zWGUib">Marko</div><div class="bars"></div></div>
      <div data-participant-id="p3"><div class="zWGUib">Fran</div><span>(You)</span></div>`);
    const state = newReaderState();
    const bars = doc.querySelector('[data-participant-id="p2"] .bars')!;
    for (let i = 0; i < 6; i++) state.activity.record(bars, 1_000 + i * 80);
    state.activity.record(doc.querySelector('[data-participant-id="p1"] .bars')!, 1_100);
    const s = readSpeakers(doc, "meet", state, 1_500);
    expect(s.speaking).toEqual(["Marko"]);
    expect(s.participants).toEqual(["Ana", "Marko", "Fran"]);
    expect(s.self).toBe("Fran");
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
