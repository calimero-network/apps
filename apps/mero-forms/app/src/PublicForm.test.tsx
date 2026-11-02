import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The page a public link opens, with a mocked client: it calls the
 * workspace's public methods with no session, with the link's token, and
 * hands a Turnstile token to the contract as it is when the contract checks
 * it itself.
 */

const TOKEN = "7a".repeat(32);
const views: { method: string; args: unknown }[] = [];
const calls: { method: string; args: unknown }[] = [];
let linkForm: Record<string, unknown> = {};

const client = {
  view: vi.fn(async (_app: string, method: string, args: unknown) => {
    views.push({ method, args });
    return { index: 1, result: linkForm, events: [] };
  }),
  call: vi.fn(async (_app: string, method: string, args: unknown) => {
    calls.push({ method, args });
    return { index: 2, result: "r1", events: [] };
  }),
  useApiKey: vi.fn(),
};
const makeClient = vi.fn(async () => client);

vi.mock("./sessionContext", () => ({
  useSessionApi: () => ({
    api: { session: { status: "signed-out", target: { kind: "local" } } },
    deps: { makeClient },
  }),
}));
vi.mock("./lib/captcha", () => ({
  fetchCaptchaConfig: vi.fn(async () => ({ siteKey: "verifier-site", publicKey: "k" })),
  requestPass: vi.fn(),
  mountCaptcha: vi.fn(async (_el: HTMLElement, siteKey: string, _nonce: string, onToken: (t: string) => void) => {
    mounted.push(siteKey);
    onToken("cf-token-1");
    return () => {};
  }),
}));
const mounted: string[] = [];

const { PublicForm } = await import("./PublicForm");

beforeEach(() => {
  views.length = 0;
  calls.length = 0;
  mounted.length = 0;
  window.location.hash = `#a=app-1&t=${TOKEN}`;
  linkForm = {
    formId: "f1",
    title: "Contact",
    description: "",
    fields: [{ id: "email", kind: "email", label: "Email", help: "", required: true, options: [] }],
    accepting: true,
    captcha: true,
    captchaByNode: true,
    captchaSiteKey: "team-site",
  };
});
afterEach(cleanup);

describe("a public link's page", () => {
  it("answers anonymously with the link's token, and hands the Turnstile token to the contract", async () => {
    render(<PublicForm />);
    await screen.findByText("Contact");
    expect(views).toEqual([{ method: "linkForm", args: { link: TOKEN } }]);
    expect(client.useApiKey).not.toHaveBeenCalled();
    await waitFor(() => expect(mounted).toEqual(["team-site"]));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "ada@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await screen.findByTestId("public-sent");
    expect(calls).toEqual([
      {
        method: "submitViaLink",
        args: {
          link: TOKEN,
          answers: [{ fieldId: "email", values: ["ada@example.com"] }],
          captcha: null,
          captchaToken: "cf-token-1",
        },
      },
    ]);
  });
});
