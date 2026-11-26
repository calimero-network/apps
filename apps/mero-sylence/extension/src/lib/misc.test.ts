import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildManifest } from "../manifest";
import { group, sizeLabel, validOverride } from "./format";
import { detectPlatform, isInCall, meetingTitle, meetingUrl } from "./platform";
import { Scheduler } from "./scheduler";
import { describe as describeError, policyFor } from "./session";
import { aggregateProgress, cleanTranscript } from "./text";

const chunk = (startMs: number, ms: number) => ({ startMs, endMs: startMs + ms, audio: new Float32Array(16) });

describe("platform", () => {
  it.each([
    ["https://meet.google.com/abc-defg-hij?authuser=0", "meet", true],
    ["https://meet.google.com/landing", "meet", false],
    ["https://app.zoom.us/wc/123456/join", "zoom", true],
    ["https://us02web.zoom.us/j/123?pwd=x", "zoom", true],
    ["https://zoom.us/", "zoom", false],
    ["https://teams.microsoft.com/v2/", "teams", true],
    ["https://teams.live.com/meet/9", "teams", true],
    ["https://example.com/", "other", false],
    ["chrome://newtab", "other", false],
    ["not a url", "other", false],
  ] as const)("%s → %s", (url, platform, inCall) => {
    expect(detectPlatform(url)).toBe(platform);
    expect(isInCall(url)).toBe(inCall);
  });

  it("titles a meeting from its tab", () => {
    const at = new Date(2026, 10, 23, 15, 4);
    expect(meetingTitle("Weekly sync - Google Meet", "meet", at)).toBe("Weekly sync");
    expect(meetingTitle("Meet - abc-defg-hij", "meet", at)).toMatch(/^Google Meet call · 23 Nov/);
    expect(meetingTitle("Zoom Meeting", "zoom", at)).toMatch(/^Zoom call/);
    expect(meetingTitle("Design review | Microsoft Teams", "teams", at)).toBe("Design review");
    expect(meetingTitle("", "other", at)).toMatch(/^Call · /);
    expect(meetingTitle("x".repeat(300), "other", at)).toHaveLength(200);
  });

  it("keeps the call's address without its passcode", () => {
    expect(meetingUrl("https://us02web.zoom.us/j/123?pwd=secret#x")).toBe("https://us02web.zoom.us/j/123");
    expect(meetingUrl("http://insecure.example/")).toBe("");
    expect(meetingUrl(undefined)).toBe("");
  });
});

describe("transcript text", () => {
  it("drops tags and phantom lines, keeps speech", () => {
    expect(cleanTranscript(" [BLANK_AUDIO] ")).toBe("");
    expect(cleanTranscript("(music)")).toBe("");
    expect(cleanTranscript("Thanks for watching!")).toBe("");
    expect(cleanTranscript("[MUSIC] Let's   start")).toBe("Let's start");
    expect(cleanTranscript("You")).toBe("");
    expect(cleanTranscript("You said Friday.")).toBe("You said Friday.");
  });

  it("adds up download progress over files", () => {
    const files = new Map([
      ["encoder", { loaded: 50, total: 100 }],
      ["decoder", { loaded: 100, total: 100 }],
    ]);
    expect(aggregateProgress(files)).toEqual({ fraction: 0.75, file: "encoder" });
    expect(aggregateProgress(new Map())).toEqual({ fraction: 0, file: "" });
  });

  it("groups a speaker's lines and formats sizes", () => {
    expect(
      group([
        { speaker: "you", text: "b", startMs: 2_000 },
        { speaker: "you", text: "a", startMs: 1_000 },
        { speaker: "others", text: "c", startMs: 3_000 },
        { speaker: "others", text: "d", startMs: 100_000 },
      ]),
    ).toEqual([
      { speaker: "you", startMs: 1_000, text: "a b" },
      { speaker: "others", startMs: 3_000, text: "c" },
      { speaker: "others", startMs: 100_000, text: "d" },
    ]);
    expect(sizeLabel(1467)).toBe("1.5 GB");
    expect(sizeLabel(63)).toBe("63 MB");
    expect(validOverride("http://localhost:5173")).toBe(true);
    expect(validOverride("http://evil.example")).toBe(false);
    expect(validOverride("")).toBe(true);
  });
});

describe("scheduler", () => {
  it("hands out one stretch at a time, oldest first across speakers", () => {
    const s = new Scheduler();
    s.enqueue(chunk(5_000, 1_000), "others");
    s.enqueue(chunk(1_000, 2_000), "you");
    const first = s.take();
    expect(first?.startMs).toBe(1_000);
    expect(s.take()).toBeNull();
    expect(s.backlogSec).toBe(3);
    expect(s.done(first!.id, 500)?.speaker).toBe("you");
    expect(s.take()?.startMs).toBe(5_000);
  });

  it("says when the model can't keep up, after a few answers", () => {
    const s = new Scheduler();
    for (let i = 0; i < 3; i++) {
      s.enqueue(chunk(i * 10_000, 10_000), "others");
      const j = s.take()!;
      s.done(j.id, 30_000);
    }
    expect(s.realtime).toBeGreaterThan(1.2);
    expect(s.behind()).toBe(true);
    s.resetSpeed();
    expect(s.behind()).toBe(false);
  });

  it("puts the busy stretch back when the model is replaced", () => {
    const s = new Scheduler();
    s.enqueue(chunk(0, 1_000), "you");
    s.take();
    s.requeueBusy();
    expect(s.idle).toBe(false);
    expect(s.take()?.startMs).toBe(0);
  });
});

describe("session", () => {
  it("trusts mock TEEs only on this machine", () => {
    expect(policyFor("http://127.0.0.1:2501")).toEqual({ allowMock: true });
    expect(policyFor("https://node.eu-shared-1.calimero.network")).toEqual({ release: { minReleaseVersion: "0.0.0" } });
  });

  it("explains a passkey step-up", () => {
    expect(describeError(new Error("412 CONFIRM_REQUIRED: step up"))).toMatch(/passkey/);
    expect(describeError("x")).toBe("x");
  });
});

describe("manifest", () => {
  const root = join(import.meta.dirname, "..", "..");
  const key = readFileSync(join(root, "manifest-key.txt"), "utf8").trim();
  const id = readFileSync(join(root, "extension-id.txt"), "utf8").trim();

  it("pins the extension id the served page sends sessions to", () => {
    const hex = createHash("sha256").update(Buffer.from(key, "base64")).digest("hex").slice(0, 32);
    const derived = hex.replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));
    expect(derived).toBe(id);
    expect(id).toBe("ljpjgindjakdpmbpjdcpadihhnaemocf");
  });

  it("asks only for what it uses", () => {
    const m = buildManifest({ key, version: "0.1.0" });
    expect(m.manifest_version).toBe(3);
    expect(m.permissions).toEqual(["tabCapture", "offscreen", "activeTab", "tabs", "storage", "sidePanel"]);
    expect(m.host_permissions).not.toContain("<all_urls>");
    expect(m.content_security_policy?.extension_pages).toBe("script-src 'self' 'wasm-unsafe-eval'; object-src 'self'");
    expect(m.background).toEqual({ service_worker: "background.js", type: "module" });
  });
});
