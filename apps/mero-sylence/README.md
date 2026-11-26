# Sylence

Meeting transcripts and action items, written on your own laptop and kept in your team's workspace.

A browser extension (Chrome, Brave, any Chromium browser) records the call tab of Google Meet, Zoom
or Microsoft Teams, plus your microphone, and turns speech into text **on the laptop**: Whisper
large-v3-turbo on WebGPU where the laptop has a GPU for it, a small model (Moonshine, Whisper base)
on any CPU. Only the text is sent, a few lines at a time, to a Sylence workspace: an app instance in
your organization, on Calimero. Your team reads the transcript live, ticks off action items, and
searches past meetings. No bot joins the call.

```
apps/mero-sylence/
├── logic/       Rust → wasm32-wasip2: the `calimero:app` component (meetings, segments, action items)
│   ├── src/lib.rs
│   ├── tests/harness.rs     every method on core's engine (TestApp)
│   ├── scenarios/           steps also run on merod local (`pnpm merod-local e2e mero-sylence`)
│   └── res/abi.json         the component's ABI, committed and diffed in CI
├── app/         the served page: Vite + React + TypeScript on mero-js `CalimeroClient`
│   └── src/
│       ├── App.tsx          sign-in, the workspace picker, meetings, open action items
│       ├── MeetingPage.tsx  header, summary, live transcript, action items, export, delete
│       ├── native.ts        the extension's sign-in handoff (callbacks, pinned extension id)
│       ├── lib/transcript.ts  merging pages and live lines, formatting, the Markdown export
│       └── generated/       `meroctl app codegen` output for res/abi.json
└── extension/   the Chrome MV3 extension: capture, on-device speech to text, upload
```

## Privacy

- **Audio never leaves the laptop.** The extension transcribes in the browser; the node only ever
  receives text.
- A workspace is reached only by the members of its organization (core's grants), and its state is
  replicated only on the organization's nodes.
- Events carry ids, never text: a subscriber learns that lines changed and reads them with its own
  session.

## The extension signs in through this page

A Cloud node trusts a passkey ceremony only from the frontend it serves from the bundle, so the
extension cannot sign in on its own origin. It opens this page with
`chrome.identity.launchWebAuthFlow` at `#native-sign-in&state=…&key=…`, the same handoff the iOS
apps use (`@calimero-apps/passkey/native`). Once you are signed in here, the page seals the session
to the extension's one-time key (ECDH P-256, HKDF, AES-GCM) and navigates to the extension's fixed
callback, `https://ljpjgindjakdpmbpjdcpadihhnaemocf.chromiumapp.org/signed-in`. The callback is a
constant (`src/native.ts`), never read from the URL, so a link cannot send a session anywhere else;
the extension's id is pinned by the `key` in its manifest. While a handoff is pending the page keeps
sessions in memory only: it neither restores yours nor keeps the one it hands over. Passkey
step-ups the extension needs go through `#native-approve` the same way.

## The contract

| Method | Kind | Who | What |
| --- | --- | --- | --- |
| `startMeeting(title, platform, url, model, language)` | call | anyone who reaches the app | starts a meeting; the caller is its recorder; returns its id |
| `appendSegments(meetingId, segments)` | call | the recorder | stores up to 100 segments; a number already stored is skipped, so a batch can be resent |
| `editSegment(meetingId, seq, text)` | call | the recorder | corrects one line (marked edited) |
| `endMeeting(meetingId, durationMs)` | call | the recorder | ends the recording; idempotent |
| `renameMeeting(meetingId, title)` | call | the recorder | |
| `setSummary(meetingId, summary)` | call | the recorder | free text, up to 20,000 characters |
| `deleteMeeting(meetingId)` | call | the recorder or the workspace's owner | hides the meeting at once, removes its action items and up to 1,000 lines; call again until `remaining` is 0 |
| `addAction(meetingId, text, assignee, sourceSeq)` | call | anyone who reaches the app | returns its id; `sourceSeq` links it to a line |
| `setActionDone(actionId, done)` | call | anyone who reaches the app | |
| `editAction(actionId, text, assignee)` | call | anyone who reaches the app | |
| `removeAction(actionId)` | call | its author, the meeting's recorder or the workspace's owner | |
| `getMeeting(meetingId)` | view | anyone who reaches the app | |
| `listMeetings()` | view | anyone who reaches the app | newest first |
| `transcript(meetingId, fromSeq, limit)` | view | anyone who reaches the app | up to 500 lines from `fromSeq`, and `next` |
| `listActions(meetingId)` | view | anyone who reaches the app | oldest first |
| `openActions()` | view | anyone who reaches the app | every item not done, across meetings |
| `myAccount()` | view | anyone signed in | |

Events: `MeetingChanged { id }`, `TranscriptChanged { meetingId, from, to }`,
`ActionChanged { id, meetingId }`. The page re-reads only the lines a `TranscriptChanged` names.

Limits: 10,000 segments per meeting (about eight hours), 4,000 characters per segment, 500 action
items per meeting. API keys act for their account; link visitors and signed-out callers are refused.

## Run it

```bash
pnpm dev:local mero-sylence      # merod local, the contract deployed, Vite on :5173
pnpm -F mero-sylence test        # the page's unit tests
cd apps/mero-sylence/logic && cargo test   # the contract on core's engine
pnpm merod-local e2e mero-sylence          # the scenarios on three real nodes
```

After changing the contract: `scripts/component-build.sh apps/mero-sylence/logic` (writes
`res/abi.json`), then `pnpm -F mero-sylence codegen`.

[TESTING.md](TESTING.md): what the tests cover per call site (Meet, Zoom, Teams, any other tab) and
the manual pass on real calls.
