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

function start(): { stop: () => void } {
  const platform = detectPlatform(location.href);
  const state = newReaderState();
  const observer = new MutationObserver((records) => {
    const now = Date.now();
    for (const r of records) state.activity.record(r.target, now);
  });
  if (platform === "meet") {
    observer.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["class", "style"] });
  }

  let last = "";
  let lastSent = 0;
  const send = (s: SpeakerSample, now: number) =>
    chrome.runtime
      .sendMessage({ source: "speakers", type: "speakers", at: now, platform, ...s })
      .catch(() => stop());

  const timer = window.setInterval(() => {
    const now = Date.now();
    let sample: SpeakerSample;
    try {
      sample = readSpeakers(document, platform, state, now);
    } catch {
      return;
    }
    const key = JSON.stringify([sample.speaking, sample.participants, sample.self]);
    if (key !== last || now - lastSent >= HEARTBEAT_MS) {
      last = key;
      lastSent = now;
      void send(sample, now);
    }
  }, SAMPLE_MS);

  const onMessage = (m: unknown) => {
    if ((m as { target?: string; type?: string })?.target === "speakers" && (m as { type?: string }).type === "stop") stop();
  };
  chrome.runtime.onMessage.addListener(onMessage);

  function stop() {
    window.clearInterval(timer);
    observer.disconnect();
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
