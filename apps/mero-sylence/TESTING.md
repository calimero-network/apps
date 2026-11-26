# Testing Sylence

Two parts:

1. **Automated tests.** They run in CI on every push; run them locally before pushing.
2. **A manual pass on real calls.** Do this before a release and after any change to the speaker reader, the audio pipeline or the second pass.

## 1. Automated

```bash
pnpm -F mero-sylence-extension test       # extension: 260+ tests (vitest, fake chrome)
pnpm -F mero-sylence-extension typecheck
pnpm -F mero-sylence-extension lint
pnpm -F mero-sylence test                 # the served page
cargo test --manifest-path apps/mero-sylence/logic/Cargo.toml   # the contract, on core's engine
```

What covers which call site:

| What | Meet | Zoom (web) | Teams (web) | Any other site | Where |
|---|---|---|---|---|---|
| Recognized from the tab's address, meeting title from the tab title | ✓ | ✓ `app.zoom.us`, `*.zoom.us/wc`, `/j/` | ✓ `teams.microsoft.com`, `teams.live.com`, `teams.cloud.microsoft` | → "Browser tab" (Jitsi, Webex, Whereby, Slack huddles…) | `src/lib/misc.test.ts`, `edges.test.ts` |
| Popup offers the right button | Record meeting | Record meeting | Record meeting | Record this tab | `src/ui/popup/App.test.tsx` |
| Record → lines → named → saved, per site | ✓ | ✓ | ✓ | ✓ (lines unnamed) | `src/background/background.test.ts` › "every kind of call" |
| Speaker reader injected only where it can read names | ✓ | ✓ | ✓ | not injected | same |
| The reader script on a snapshot of the call page | captions + tiles, doubled names | active speaker frame | captions + speaking outline | names nobody | `src/content/speakers.test.ts` |
| Reading names from the page | `meetCaptions`, `meetTiles` | `zoomSpeaking` | `teamsCaptions`, `teamsSpeaking` | — | `src/lib/speakers.test.ts` |

What covers the rest:

- **Echo of the call on the mic and made-up "Thank you." lines:** `src/lib/echo.test.ts`.
- **Lines named while two people talk at once:** `speakers.test.ts` › `nameFor`.
- **The second pass after the call:**
  - Kept audio and long windows, with the echo removed: `src/lib/improve.test.ts`.
  - The recorder's side: `src/offscreen/offscreen.test.ts` › "the transcript redone after the call".
  - Replacing the live lines, with rollback when the upload fails halfway: `background.test.ts` › "the transcript redone after the call".
  - The contract's `dropSegments`: `logic/tests/harness.rs`.
- **The two switches working independently** (Find action items, Smart notes): `App.test.tsx`, and `background.test.ts` › notes.

Note: the reader tests use page snapshots written by hand. Meet, Zoom and Teams change their page code without notice. When a live call stops naming people, save that page's markup (DevTools → Elements → Copy outerHTML of the call area) as a new case in `src/content/speakers.test.ts`, then fix the reader.

## 2. Manual, on real calls

### Setup

```bash
cd apps-mero-sylence
export PATH="$HOME/Desktop/calimero/bin-rc38/bin:$PATH"      # merod + meroctl at the core version CI uses
pnpm dev:local mero-sylence --fresh                           # 3 local nodes + the page on http://localhost:5173
pnpm -F mero-sylence-extension build                          # → apps/mero-sylence/extension/dist
```

1. Open `chrome://extensions` or `brave://extensions` and turn on Developer mode.
2. Click **Load unpacked** and choose `extension/dist`. Remove any older Sylence or Minutes build first; they share the extension ID.
3. In Sylence, go to Settings → Advanced and set **Sign-in page** to `http://localhost:5173`. Sign in and create a workspace.
4. You need a second person, or a second device, in each call.
5. After each call, Settings → **Copy diagnostics** gives the extension's log. Paste it into the bug report.

### Every platform

Run this list on each:

- **Google Meet:** `meet.google.com`.
- **Zoom:** the web client, `app.zoom.us/wc/…`. In the desktop app's invite page, choose "Join from your browser".
- **Microsoft Teams:** web, at `teams.microsoft.com` (work) and `teams.live.com` (personal).
- **Any other site:** e.g. `meet.jit.si`, Webex in the browser, Whereby.

| # | Do | Expect |
|---|---|---|
| 1 | Open the popup on the call tab | Meet / Zoom / Teams: the meeting's title and "· in a call", button **Record meeting**. Other site: "Not a meeting tab — you can still record it", button **Record this tab** |
| 2 | Record, both people talk in turns for 2 minutes | Lines appear within a few seconds. The call stays audible |
| 3 | Look at the names (popup, side panel) | Meet / Zoom / Teams: the other person's real name, once (not "Sandi FaticSandi Fatic"). Your lines: your name, or "You". Other site: "Others" / "You" |
| 4 | Turn captions on (Meet: CC, Teams: More → Captions) and talk again | Names still right; the popup says "Names from Meet · N people" |
| 5 | Speakers, no headphones: stay silent while the other person talks for 30 s | **No lines under your name.** In diagnostics: "follows the call: echo, skipped" |
| 6 | Talk over the other person | Your line stays yours. Their line gets their name (not plain "Others") |
| 7 | Stay silent, breathe, type for 20 s | No "Thank you." / "Okay." lines under your name ("phantom, skipped" in diagnostics) |
| 8 | Say "Ana, can you send the deck by Friday?" and "I'll test Brave today" | With **Find action items** on: 2 action items after Stop |
| 9 | Stop | With **Improve the transcript after the call** on and WebGPU available: "Improving the transcript" with a progress bar; first time, a 1.5 GB download. Then "Meeting saved" and "Transcript improved after the call…" |
| 10 | Open the meeting on the page | Lines read as whole sentences, with names, in order. Details → Speech model says "whisper-large-v3-turbo, after the call". The speaker chips and filter work |
| 11 | Close the call tab while recording | The recording stops and is saved |

### Switches

Each switch must work without the others.

| Find action items | Smart notes (Experimental) | Improve after the call | Expect after Stop |
|---|---|---|---|
| on | off | on | Transcript improved; action items from phrases; if none, "No action items found…" |
| off | off | on | Transcript improved; no action items, no "found from phrases" line |
| off | on | off | Summary and action items written by the model (WebGPU), live transcript kept |
| on | on | on | Improved transcript, then the model's summary and action items from it |
| any | any | on, browser **without** WebGPU (e.g. Brave with shields up on some machines) | "The live transcript was kept. This browser doesn't offer WebGPU…" |

### Second pass, edge cases

- A 30-minute call: the second pass takes roughly a few minutes on a recent Mac; the popup can be closed and reopened meanwhile.
- Turn Wi-Fi off just as you press Stop: you get "The improved transcript couldn't be saved", and the live transcript is still complete on the page after reconnecting, with no duplicates.
- A meeting with only you talking (the other side muted): no lines under the other person.

### Browsers

Run each platform on **Chrome** and **Brave**. Brave: if WebGPU is off, the second pass is skipped with the reason shown, and recording itself still works.
