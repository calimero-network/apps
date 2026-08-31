import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InviteSheet from "./InviteSheet";
import { APP_SLUG, INVITATION_PARAM } from "../lib/inviteLink";

// See the note in PeopleDialog.test.tsx: this project does not enable vitest
// globals, so RTL's auto-cleanup never registers.
afterEach(cleanup);

/** A realistic code — deflated JSON, base58, one long line. */
const CODE =
  "5Kd8mQvR2xLnT9pZbA4aYcWeUf6gJd3NsSvXhKrM8tBzQ7Hs2Wk9vLxTnR4mZ".repeat(6);

/**
 * jsdom has no clipboard. Installing a real one (rather than stubbing the
 * component) keeps the copy path under test, including the failure branch — which
 * matters because clipboard access is genuinely denied in an insecure context and
 * in some embedded webviews, and the component is supposed to say so rather than
 * fail silently.
 *
 * ORDER MATTERS at every call site: `userEvent.setup()` installs its OWN
 * `navigator.clipboard`, so this has to go in AFTER it or the spy records zero
 * calls while the button visibly works.
 */
function stubClipboard(behaviour: "ok" | "deny") {
  const writeText = vi.fn((_text: string) =>
    behaviour === "ok"
      ? Promise.resolve()
      : Promise.reject(new Error("denied")),
  );
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
    writable: true,
  });
  return writeText;
}

beforeEach(() => {
  stubClipboard("ok");
  // `share` must be ABSENT by default: it only exists on some platforms, and a
  // suite that always has it never exercises the fallback everyone else gets.
  // @ts-expect-error deleting an optional platform API
  delete navigator.share;
});

const sheet = (scope = "Whole stream · Demo") => (
  <InviteSheet code={CODE} scope={scope} />
);

describe("InviteSheet", () => {
  it("leads with the platform link, addressed to this app by slug", () => {
    render(sheet());
    const link = (screen.getByTestId("invite-link") as HTMLInputElement).value;
    expect(link).toContain("https://links.calimero.network/");
    expect(link).toContain(APP_SLUG);
    expect(link).toContain(`${INVITATION_PARAM}=`);
  });

  it("does not need an origin at all", () => {
    // The old version took `origin`/`path` props and fell back to a bare code
    // when there was no usable origin — the desktop shell being the case that
    // mattered. The platform host is a constant, so that whole branch is gone.
    render(sheet());
    expect(screen.getByText("Invitation link")).toBeTruthy();
  });

  it("keeps the desktop link and the raw code behind one disclosure", async () => {
    const user = userEvent.setup();
    render(sheet());
    // Neither belongs on screen by default: one is not clickable in most places,
    // the other is ~380 characters of base58.
    await user.click(screen.getByText(/other ways to send it/i));

    const deep = (screen.getByTestId("invite-deep-link") as HTMLInputElement)
      .value;
    expect(deep.startsWith(`calimero://${APP_SLUG}/join?`)).toBe(true);
    expect((screen.getByTestId("invite-code") as HTMLInputElement).value).toBe(
      CODE,
    );
  });

  it("all three carry the same payload", async () => {
    const user = userEvent.setup();
    render(sheet());
    await user.click(screen.getByText(/other ways to send it/i));
    const link = (screen.getByTestId("invite-link") as HTMLInputElement).value;
    const deep = (screen.getByTestId("invite-deep-link") as HTMLInputElement)
      .value;
    expect(link).toContain(encodeURIComponent(CODE));
    expect(deep).toContain(encodeURIComponent(CODE));
    expect((screen.getByTestId("invite-code") as HTMLInputElement).value).toBe(
      CODE,
    );
  });

  it("copies the link, and confirms it", async () => {
    const user = userEvent.setup();
    const write = stubClipboard("ok");
    render(sheet());
    await user.click(screen.getByTestId("invite-copy"));
    expect(write).toHaveBeenCalledOnce();
    expect(write.mock.calls[0][0]).toContain("links.calimero.network");
    expect(screen.getByTestId("invite-copy").textContent).toMatch(/copied/i);
  });

  it("confirms each copy separately, so one does not claim another's success", async () => {
    const user = userEvent.setup();
    stubClipboard("ok");
    render(sheet());
    await user.click(screen.getByText(/other ways to send it/i));
    await user.click(screen.getByTestId("invite-copy-code"));
    expect(screen.getByTestId("invite-copy-code").textContent).toMatch(
      /copied/i,
    );
    // The primary button must NOT also read "Copied".
    expect(screen.getByTestId("invite-copy").textContent).not.toMatch(
      /copied/i,
    );
  });

  it("says what to do when the clipboard is denied, instead of failing silently", async () => {
    const user = userEvent.setup();
    stubClipboard("deny");
    render(sheet());
    await user.click(screen.getByTestId("invite-copy"));
    expect(screen.getByText(/select the text and copy it/i)).toBeTruthy();
    expect(screen.getByTestId("invite-copy").textContent).not.toMatch(
      /copied/i,
    );
  });

  it("hides the share button on a platform without navigator.share", () => {
    render(sheet());
    expect(screen.queryByTestId("invite-share")).toBeNull();
  });

  it("shares the LINK, not the code, when the platform can", async () => {
    const share = vi.fn((_data: ShareData) => Promise.resolve());
    Object.defineProperty(navigator, "share", {
      value: share,
      configurable: true,
    });
    const user = userEvent.setup();
    render(sheet("Room · Daily"));
    await user.click(screen.getByTestId("invite-share"));
    expect(share).toHaveBeenCalledOnce();
    expect(share.mock.calls[0][0]).toMatchObject({
      url: expect.stringContaining("links.calimero.network"),
    });
  });

  it("treats a CANCELLED share as a no-op, not a failure", async () => {
    // A dismissed share sheet rejects with AbortError. Falling back to a copy
    // there would silently put an invitation on the clipboard of someone who
    // just decided not to send it.
    const abort = Object.assign(new Error("cancelled"), { name: "AbortError" });
    Object.defineProperty(navigator, "share", {
      value: vi.fn(() => Promise.reject(abort)),
      configurable: true,
    });
    const user = userEvent.setup();
    const write = stubClipboard("ok");
    render(sheet());
    await user.click(screen.getByTestId("invite-share"));
    expect(write).not.toHaveBeenCalled();
    expect(screen.getByTestId("invite-copy").textContent).not.toMatch(
      /copied/i,
    );
  });

  it("falls back to copying when share fails for a real reason", async () => {
    Object.defineProperty(navigator, "share", {
      value: vi.fn(() => Promise.reject(new Error("NotAllowedError"))),
      configurable: true,
    });
    const user = userEvent.setup();
    const write = stubClipboard("ok");
    render(sheet());
    await user.click(screen.getByTestId("invite-share"));
    expect(write).toHaveBeenCalledOnce();
  });

  it("states the scope, because a stream and a room invitation look identical", () => {
    render(sheet("Room · Daily"));
    expect(screen.getByTestId("invite-scope").textContent).toBe("Room · Daily");
  });
});
