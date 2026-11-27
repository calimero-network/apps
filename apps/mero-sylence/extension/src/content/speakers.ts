/**
 * Runs in the call tab while Sylence records it (injected by the service
 * worker on Record, through the popup's activeTab grant): reads who is talking
 * a few times a second (`lib/speakers.ts`) and tells the service worker when
 * it changes. It reads names only; no audio, video or chat leaves the page.
 */
import { detectPlatform } from "../lib/platform";
import { newReaderState, readSpeakers, type SpeakerSample } from "../lib/speakers";

declare global {
  interface Window {
    __sylenceSpeakers?: { stop: () => void };
  }
}

const SAMPLE_MS = 250;
const HEARTBEAT_MS = 10_000;

/** Starts reading; `href` is the call's address (tests pass one, the page uses its own). */
export function start(href: string = location.href): { stop: () => void } {
  const platform = detectPlatform(href);
  const state = newReaderState();

  let last = "";
  let lastSent = 0;
  let lastRead = 0;
  const send = (s: SpeakerSample, now: number) =>
    chrome.runtime
      .sendMessage({ source: "speakers", type: "speakers", at: now, platform, hidden: document.hidden, ...s })
      .catch(() => stop());

  const tick = () => {
    const now = Date.now();
    lastRead = now;
    let sample: SpeakerSample;
    try {
      sample = readSpeakers(document, platform, state, now);
    } catch {
      return;
    }
    const key = JSON.stringify([sample.speaking, sample.participants, sample.self, document.hidden]);
    if (key !== last || now - lastSent >= HEARTBEAT_MS) {
      last = key;
      lastSent = now;
      void send(sample, now);
    }
  };

  // Chrome slows a background tab's timers to once a second or less, and the
  // Meet tab is in the background whenever the person presents another tab or
  // window. The page still changes as people talk, so its changes read it too.
  const observer = new MutationObserver((records) => {
    const now = Date.now();
    if (platform === "meet") for (const r of records) state.activity.record(r.target, now);
    if (now - lastRead >= SAMPLE_MS) tick();
  });
  observer.observe(document.documentElement, {
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "style", "aria-label", "data-is-speaking"],
    childList: true,
    characterData: true,
  });

  const timer = window.setInterval(tick, SAMPLE_MS);
  const onVisibility = () => tick();
  document.addEventListener("visibilitychange", onVisibility);

  const onMessage = (m: unknown) => {
    if ((m as { target?: string; type?: string })?.target === "speakers" && (m as { type?: string }).type === "stop") stop();
  };
  chrome.runtime.onMessage.addListener(onMessage);

  function stop() {
    window.clearInterval(timer);
    observer.disconnect();
    document.removeEventListener("visibilitychange", onVisibility);
    try {
      chrome.runtime.onMessage.removeListener(onMessage);
    } catch {
      // The extension was reloaded: nothing to remove.
    }
    delete window.__sylenceSpeakers;
  }
  return { stop };
}

window.__sylenceSpeakers?.stop();
window.__sylenceSpeakers = start();
