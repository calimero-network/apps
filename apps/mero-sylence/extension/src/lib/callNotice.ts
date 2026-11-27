/**
 * Telling the call it is being recorded: when recording starts, the extension
 * posts one short message in the call's own chat (Google Meet, Microsoft Teams
 * and Zoom in the browser), so everyone in it knows, not only the recorder.
 *
 * `postCallNotice` runs inside the call tab through
 * `chrome.scripting.executeScript({ func })`, which sends the function's
 * source, not its closure: it must use nothing from outside its own body.
 */
import type { Platform } from "./platform";

export const CALIMERO_LINK = "https://calimero.network";

/** The message posted in the call's chat. `sylence` is the Sylence page, when it is the public one. */
export function callNoticeText(sylence: string | null): string {
  const links = [sylence ? `Sylence: ${sylence}` : null, `Calimero: ${CALIMERO_LINK}`].filter(Boolean).join(" · ");
  return (
    "This call is being recorded and transcribed with Sylence. " +
    "The words are transcribed on the recorder's own laptop, and the recording and notes are kept encrypted " +
    "in a secure enclave on Calimero, readable only by the recorder's team. " +
    "Nothing is sold or shared with third parties. " +
    links
  );
}

/** What happened in the tab. */
export type NoticeResult = "posted" | "no-chat" | "not-sent" | "unsupported";

/**
 * Opens the call's chat if it is closed, types `text`, sends it, and closes
 * the chat again if it opened it. Waits up to `waitMs` for each part of the
 * page. Self-contained (see the file's comment).
 */
export async function postCallNotice(platform: Platform, text: string, waitMs = 5_000): Promise<NoticeResult> {
  const PAGES: Record<string, { toggle: string[]; input: string[]; send: string[] } | undefined> = {
    meet: {
      toggle: ['button[aria-label*="Chat with everyone" i]', 'button[aria-label^="Chat" i]', 'button[data-panel-id="2"]'],
      input: ['textarea[aria-label*="Send a message" i]', 'textarea[aria-label*="message" i]', 'div[contenteditable="true"][aria-label*="message" i]'],
      send: ['button[aria-label*="Send a message" i]', 'button[aria-label="Send" i]', 'button[jsname="SoqoBf"]'],
    },
    teams: {
      toggle: ['[data-tid="chat-button"]', "button#chat-button", 'button[aria-label^="Chat" i]'],
      input: ['[data-tid="ckeditor"][contenteditable="true"]', 'div[contenteditable="true"][aria-label*="message" i]'],
      send: ['[data-tid="newMessageCommands-send"]', 'button[aria-label*="Send" i]'],
    },
    zoom: {
      toggle: ['button[aria-label*="open the chat" i]', 'button[aria-label^="Chat" i]', ".footer-button__chat-icon"],
      input: ['.chat-box__chat-textarea [contenteditable="true"]', 'textarea[aria-label*="chat" i]', 'div[contenteditable="true"][aria-label*="message" i]'],
      send: ['button[aria-label*="send" i]', ".chat-rtf-box__send"],
    },
  };
  const page = PAGES[platform];
  if (!page) return "unsupported";

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const visible = (el: Element) => !(el as HTMLElement).hidden && el.getAttribute("aria-hidden") !== "true";
  const find = (selectors: string[]): HTMLElement | null => {
    for (const s of selectors) {
      for (const el of Array.from(document.querySelectorAll<HTMLElement>(s))) if (visible(el)) return el;
    }
    return null;
  };
  const waitFor = async (selectors: string[]): Promise<HTMLElement | null> => {
    const until = Date.now() + waitMs;
    for (;;) {
      const el = find(selectors);
      if (el || Date.now() >= until) return el;
      await sleep(100);
    }
  };

  let opened = false;
  let input = find(page.input);
  if (!input) {
    const toggle = find(page.toggle);
    if (!toggle) return "no-chat";
    toggle.click();
    opened = true;
    input = await waitFor(page.input);
    if (!input) return "no-chat";
  }

  input.focus();
  if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
    // Set it the way typing does, so the page's own framework sees the change.
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(input, text);
  } else {
    input.textContent = text;
  }
  input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  input.dispatchEvent(new Event("change", { bubbles: true }));

  const send = await waitFor(page.send);
  if (send && !(send as HTMLButtonElement).disabled) send.click();
  else input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));

  await sleep(300);
  const left = input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement ? input.value : input.textContent;
  const sent = !(left ?? "").includes(text.slice(0, 40));

  if (opened) find(page.toggle)?.click();
  return sent ? "posted" : "not-sent";
}
