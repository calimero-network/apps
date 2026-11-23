# Minutes — browser extension

Records a call in a browser tab (Google Meet, Zoom on the web, Microsoft Teams,
or any tab), turns speech into text **on this laptop**, and saves the
transcript to a Minutes workspace on Calimero. Audio never leaves the machine:
only text reaches the node.

Chrome and Brave (and other Chromium browsers, 116+) run the same build.

```
extension/
├── src/background/     the service worker: sign-in, start/stop, the upload queue
├── src/offscreen/      captures the tab + microphone, cuts speech, drives the model
├── src/transcribe/     the speech worker (transformers.js + the bundled ONNX runtime)
├── src/audio/          the AudioWorklet tap (mono blocks off the audio thread)
├── src/lib/            pure logic, unit-tested: handoff, tiers, segmenter, queue, …
├── src/ui/             popup, side panel (live transcript), microphone page
├── src/generated/      the contract's typed client (`pnpm codegen`, from logic/res/abi.json)
└── e2e/                Playwright: the built extension loaded unpacked in Chromium
```

## Install (development)

```bash
pnpm install
pnpm -F mero-minutes-extension build      # → apps/mero-minutes/extension/dist
```

- **Chrome:** `chrome://extensions` → Developer mode → **Load unpacked** → `dist/`.
- **Brave:** `brave://extensions` → Developer mode → **Load unpacked** → `dist/`.

The manifest's `key` pins the extension id to `ljpjgindjakdpmbpjdcpadihhnaemocf`
(`extension-id.txt`), which the Minutes page sends signed-in sessions to. The
private key is not in the repository. `pnpm zip` writes a store upload without
the key (the Web Store assigns its own id; the served page must then name that
id too).

**Brave:** when WebGPU isn't available (some Brave builds and shield settings
hide `navigator.gpu`), Minutes picks a model that runs on the processor and the
model sheet says why Whisper large-v3 turbo is unavailable.

## Using it

1. Click the Minutes button → **Sign in with Calimero**. A window opens on
   Minutes' page on Calimero Cloud; sign in there with your passkey. The
   window closes and the extension is signed in.
2. Choose a workspace (or create one on the page).
3. Join your call, click Minutes → **Record meeting**. The call stays audible.
   Your microphone is transcribed as **You**, the call as **Others**
   (allow the microphone once when asked).
4. **Live transcript** opens the side panel. **Stop** finishes the last lines,
   saves the meeting and links to it on the page, where the team reads it and
   adds action items.

## Speech models

All run in the browser with transformers.js; the files download once from
Hugging Face and stay in the browser's cache. **Auto** picks one from the
laptop (WebGPU adapter, memory, cores) and the language, and moves to a lighter
model by itself if transcription falls behind the conversation.

| Tier | Model | Runs on | Download | Languages |
|---|---|---|---|---|
| Best (the standard) | Whisper large-v3 turbo (fp16 encoder, q4f16 decoder) | WebGPU | ~1.5 GB | 99 |
| Balanced | Whisper base (q8) | processor | ~77 MB | 99 |
| Light | Moonshine base (q8) | processor | ~63 MB | English |
| Ultra-light | Moonshine tiny (q8) | processor | ~28 MB | English |

Measured in Chromium on an Apple-silicon laptop (`MINUTES_E2E_MODEL=…`, 2.5 s
of speech): Moonshine tiny 88 ms, Moonshine base 125 ms, Whisper base 660 ms.

## How sign-in works

A Cloud node trusts passkey ceremonies only on the frontend it serves from the
app's bundle, so the extension never asks for a passkey. As the iOS and Android
apps do, it opens the served page at
`https://{label}.apps.calimero.network/{version}/#native-sign-in&state=…&key=…`
(`chrome.identity.launchWebAuthFlow`); the page signs the person in and returns
the session to `https://ljpjgindjakdpmbpjdcpadihhnaemocf.chromiumapp.org/signed-in#state=…&box=…`,
sealed to a P-256 key made for that one sign-in (ECDH → HKDF-SHA256 →
AES-256-GCM, `src/lib/handoff.ts`; the page's side is
`packages/passkey/src/native.ts`). The session's refresh token is single use, so
the service worker makes one node call at a time and saves the session after each.

## Against a local cluster

```bash
pnpm dev:local mero-minutes        # merod local + the page on http://localhost:5173
```

Then Minutes → Settings → Advanced → **Sign-in page** `http://localhost:5173`,
and sign in again. Local nodes run mock TEEs, which the extension accepts only
on `localhost`/`127.0.0.1`.

## Tests

```bash
pnpm -F mero-minutes-extension test     # vitest: lib + popup/side panel with a fake chrome API
pnpm -F mero-minutes-extension build && pnpm -F mero-minutes-extension e2e
MINUTES_E2E_MODEL=ultralight,light,balanced pnpm -F mero-minutes-extension e2e   # downloads models
```

The model e2e transcribes `e2e/fixtures/speech-16k.wav` (a sentence spoken by
macOS `say`) and checks the words come back.
