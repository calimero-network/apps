/**
 * The recording notice, posted in the call's own chat: the message, and the
 * function that types it into Meet, Teams or Zoom (run in the call tab).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { callNoticeText, postCallNotice } from "./callNotice";

describe("the notice's words", () => {
  it("says it is recorded, where it is kept, and that nothing goes to third parties", () => {
    const text = callNoticeText("https://abc.apps.calimero.network/1.0.0/");
    expect(text).toMatch(/being recorded and transcribed with Sylence/);
    expect(text).toMatch(/secure enclave/);
    expect(text).toMatch(/third parties/);
    expect(text).toContain("Sylence: https://abc.apps.calimero.network/1.0.0/");
    expect(text).toContain("Calimero: https://calimero.network");
  });

  it("leaves out the Sylence link when there is no public page", () => {
    expect(callNoticeText(null)).not.toContain("Sylence:");
  });
});

/** Meet's chat: a toggle that opens the panel; the panel's box and Send, which empties the box like Meet does. */
function meet(open: boolean): { posted: string[]; toggles: () => number } {
  const posted: string[] = [];
  let toggles = 0;
  document.body.innerHTML = `<button aria-label="Chat with everyone"></button><div id="panel"></div>`;
  const panel = document.getElementById("panel")!;
  const show = () => {
    panel.innerHTML = `<textarea aria-label="Send a message"></textarea><button aria-label="Send a message"></button>`;
    const box = panel.querySelector("textarea")!;
    panel.querySelector("button")!.addEventListener("click", () => {
      posted.push(box.value);
      box.value = "";
    });
  };
  document.querySelector('[aria-label="Chat with everyone"]')!.addEventListener("click", () => {
    toggles++;
    if (panel.innerHTML) panel.innerHTML = "";
    else setTimeout(show, 200);
  });
  if (open) show();
  return { posted, toggles: () => toggles };
}

describe("posting it in the call's chat", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("Meet, chat closed: opens it, sends the note, and closes it again", async () => {
    const m = meet(false);
    await expect(postCallNotice("meet", "Recorded with Sylence", 2_000)).resolves.toBe("posted");
    expect(m.posted).toEqual(["Recorded with Sylence"]);
    expect(m.toggles()).toBe(2);
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("Meet, chat already open: sends the note and leaves the chat open", async () => {
    const m = meet(true);
    await expect(postCallNotice("meet", "Recorded with Sylence", 2_000)).resolves.toBe("posted");
    expect(m.posted).toEqual(["Recorded with Sylence"]);
    expect(m.toggles()).toBe(0);
    expect(document.querySelector("textarea")).not.toBeNull();
  });

  it("Teams: types into its message editor and presses Send", async () => {
    const posted: string[] = [];
    document.body.innerHTML = `<div data-tid="ckeditor" contenteditable="true"></div><button data-tid="newMessageCommands-send"></button>`;
    const box = document.querySelector<HTMLElement>('[data-tid="ckeditor"]')!;
    document.querySelector("button")!.addEventListener("click", () => {
      posted.push(box.textContent ?? "");
      box.textContent = "";
    });
    await expect(postCallNotice("teams", "Recorded with Sylence", 1_000)).resolves.toBe("posted");
    expect(posted).toEqual(["Recorded with Sylence"]);
  });

  it("a page with no chat to find says so and changes nothing", async () => {
    document.body.innerHTML = `<div>No chat here</div>`;
    await expect(postCallNotice("meet", "Recorded with Sylence", 300)).resolves.toBe("no-chat");
  });

  it("a site that is not a call is not touched", async () => {
    await expect(postCallNotice("other", "Recorded with Sylence", 300)).resolves.toBe("unsupported");
  });

  it("uses nothing from outside its own body (it is sent to the tab as source)", () => {
    const src = postCallNotice.toString();
    expect(src).not.toMatch(/\b(import|require)\b/);
    expect(src).not.toMatch(/callNoticeText|CALIMERO_LINK/);
  });
});
