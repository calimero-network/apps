/**
 * Mero Tag's served page. The app is the iOS client; this page only does what
 * a native app can't do itself on Calimero Cloud: sign the person in from Mero
 * Tag's own origin (so the session is bound to the package), approve the
 * package's step-ups with the passkey, and pass the node's consent decision
 * back to the app. See ./native.ts for the hand-offs.
 */
import {
  CalimeroClient,
  ConfirmPromptBlocked,
  OriginNotRegistered,
  PasskeyUnknownHere,
  SignUpRefused,
  browserPasskey,
  type PasskeyProvider,
} from "@calimero-network/mero-js";
import {
  approvedUrl,
  declinedUrl,
  fromB64url,
  readOpened,
  signedInUrl,
  type ApprovalRequest,
  type NativeRequest,
} from "./native";
import "./styles.css";

const root = document.getElementById("root") as HTMLElement;

// ---------------------------------------------------------------- DOM

type Child = Node | string | null | false | undefined;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, string | boolean | ((event: Event) => void)> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (typeof value === "function") el.addEventListener(name.replace(/^on/, "").toLowerCase(), value);
    else if (value === true) el.setAttribute(name, "");
    else if (value !== false) el.setAttribute(name, value);
  }
  for (const child of children) if (child) el.append(child);
  return el;
}

const ICONS = {
  key: '<path d="M14.5 3a6.5 6.5 0 0 0-6.2 8.4L3 16.7V21h4.3v-2.2h2.2v-2.2h2.2l1.2-1.2A6.5 6.5 0 1 0 14.5 3Zm2 6a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z"/>',
  shield: '<path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Zm-1.2 14.2-3.5-3.5 1.4-1.4 2.1 2.1 4.7-4.7 1.4 1.4-6.1 6.1Z"/>',
  phone: '<path d="M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm0 3v13h10V5H7Zm5 14.2a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"/>',
  alert: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 15h-2v-2h2v2Zm0-4h-2V7h2v6Z"/>',
};

function icon(name: keyof typeof ICONS, className = "icon"): SVGElement {
  const wrap = document.createElement("span");
  wrap.innerHTML = `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">${ICONS[name]}</svg>`;
  return wrap.firstElementChild as SVGElement;
}

/** The page frame: the mark, one card, a quiet footer. */
function show(...card: Child[]): void {
  root.replaceChildren(
    h(
      "main",
      { class: "shell" },
      h(
        "header",
        { class: "brand" },
        h("img", { src: "./icon.svg", alt: "", width: "36", height: "36" }),
        h("span", { class: "brand-name" }, "Mero Tag"),
      ),
      h("section", { class: "card" }, ...card),
      h("footer", { class: "foot" }, icon("shield", "icon icon-sm"), "Secured by your passkey on Calimero"),
    ),
  );
}

function errorBox(message: string | null): Child {
  return message ? h("p", { class: "error", role: "alert" }, icon("alert", "icon icon-sm"), message) : null;
}

function button(label: string, kind: "primary" | "secondary" | "link", onClick: () => void, busy = false, id = "") {
  return h(
    "button",
    { type: "button", class: `btn btn-${kind}`, disabled: busy, onclick: onClick, ...(id ? { "data-testid": id } : {}) },
    kind === "primary" ? icon("key") : null,
    label,
  );
}

/** Send the person back to the app, with a link in case the sheet doesn't follow. */
function returnToApp(url: string, title = "Returning to Mero Tag"): void {
  show(
    h("div", { class: "spinner", "aria-hidden": "true" }),
    h("h1", {}, title),
    h("p", { class: "hint" }, "If nothing happens, tap below."),
    h("a", { class: "btn btn-secondary", href: url }, "Open Mero Tag"),
  );
  window.location.replace(url);
}

// ---------------------------------------------------------------- errors

function describe(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "The passkey prompt was closed. Try again when you're ready.";
  }
  if (error instanceof ConfirmPromptBlocked) {
    return "The passkey prompt was blocked: another prompt or a password manager's popup is still open. Close it, then try again.";
  }
  if (error instanceof PasskeyUnknownHere) {
    return "This passkey has no account on this cluster. Create an account instead.";
  }
  if (error instanceof OriginNotRegistered) {
    return "This page isn't set up for Mero Tag on this cluster yet. Try again later.";
  }
  if (error instanceof SignUpRefused) {
    switch (error.reason) {
      case "invite-only":
        return "This cluster takes new accounts by invitation only. Enter the invite code you were sent.";
      case "closed":
        return "This cluster isn't taking new accounts. Sign in with an existing one.";
      case "unknown-invite":
        return "This cluster doesn't recognize that invite. Check it, or ask for a new one.";
      case "expired-invite":
        return "That invite has expired or been used up. Ask for a new one.";
      case "org-gone":
        return "The space that invite was for no longer exists.";
      default:
        return error.message || "This cluster refused the sign-up.";
    }
  }
  return error instanceof Error && error.message ? error.message : String(error);
}

// ---------------------------------------------------------------- sign-in

/** The cluster that serves this page: its nodes, from `/.well-known/calimero.json`. */
async function connect(): Promise<CalimeroClient> {
  const minReleaseVersion = (import.meta.env.VITE_CALIMERO_MIN_RELEASE as string | undefined)?.trim();
  if (!minReleaseVersion) throw new Error("This build of the page names no attestation floor (VITE_CALIMERO_MIN_RELEASE).");
  const response = await fetch(new URL("/.well-known/calimero.json", window.location.origin), {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error("No Calimero cluster serves this page. Open Mero Tag on your phone to sign in.");
  const body = (await response.json()) as { api?: unknown };
  const nodes = (Array.isArray(body.api) ? body.api : []).filter(
    (url): url is string => typeof url === "string" && /^https:\/\//.test(url),
  );
  const [baseUrl, ...rest] = nodes;
  if (!baseUrl) throw new Error("The cluster serving this page lists no nodes.");
  return new CalimeroClient({ baseUrl, nodes: rest, policy: { release: { minReleaseVersion } } });
}

interface SignInState {
  mode: "sign-in" | "create" | "confirm";
  busy: boolean;
  error: string | null;
  name: string;
  invite: string;
  askInvite: boolean;
}

function signInPage(request: NativeRequest): void {
  const state: SignInState = { mode: "sign-in", busy: false, error: null, name: "", invite: "", askInvite: false };
  let client: Promise<CalimeroClient> | null = null;
  const cluster = () => (client ??= connect().catch((e) => ((client = null), Promise.reject(e))));
  /** Releases the sign-up's second prompt; Safari opens a passkey prompt only from a tap. */
  let confirmTap: (() => void) | null = null;

  const set = (next: Partial<SignInState>) => {
    Object.assign(state, next);
    render();
  };

  const finish = async (c: CalimeroClient) => {
    const session = c.session;
    if (!session) throw new Error("The cluster opened no session.");
    const url = await signedInUrl(request, {
      v: 1,
      accountId: session.accountId,
      sessionToken: session.sessionToken,
      expiresAt: session.expiresAt,
      refreshToken: session.refreshToken,
      nodeUrl: c.nodeUrl,
      nodes: c.nodes.filter((n) => n !== c.nodeUrl),
    });
    // The session is the app's now: nothing of it is kept here.
    returnToApp(url, "Signed in");
  };

  const signIn = async () => {
    set({ busy: true, error: null });
    try {
      const c = await cluster();
      await c.signIn(browserPasskey());
      await finish(c);
    } catch (e) {
      set({ busy: false, error: describe(e), ...(e instanceof PasskeyUnknownHere ? { mode: "create" } : {}) });
    }
  };

  const signUp = async () => {
    const name = state.name.trim();
    if (!name) return set({ error: "Enter your name for the new account." });
    set({ busy: true, error: null });
    const inner = browserPasskey();
    // The node asks the new passkey to sign the account it makes: a second
    // prompt, which waits for its own tap.
    const passkey: PasskeyProvider = {
      create: (options, more) => inner.create(options, more),
      get: async (challenge, rpId, allow, options) => {
        await new Promise<void>((resolve) => {
          confirmTap = resolve;
          set({ mode: "confirm", busy: false });
        });
        set({ busy: true });
        return inner.get(challenge, rpId, allow, options);
      },
    };
    try {
      const c = await cluster();
      const invite = state.invite.trim();
      await c.signUp(passkey, name, invite ? { invite } : {});
      await finish(c);
    } catch (e) {
      const needsInvite = e instanceof SignUpRefused && e.reason !== "other" && e.reason !== "org-gone";
      set({ busy: false, mode: "create", error: describe(e), askInvite: state.askInvite || needsInvite });
    } finally {
      confirmTap = null;
    }
  };

  const field = (label: string, key: "name" | "invite", placeholder: string, hint?: string) =>
    h(
      "label",
      { class: "field" },
      h("span", { class: "field-label" }, label),
      h("input", {
        type: "text",
        value: state[key],
        placeholder,
        autocomplete: key === "name" ? "name" : "off",
        autocapitalize: key === "name" ? "words" : "off",
        spellcheck: "false",
        disabled: state.busy,
        oninput: (event: Event) => {
          state[key] = (event.target as HTMLInputElement).value;
        },
      }),
      hint ? h("span", { class: "field-hint" }, hint) : null,
    );

  function render(): void {
    if (state.mode === "confirm") {
      show(
        h("h1", {}, "Confirm your new passkey"),
        h("p", { class: "hint" }, "Your passkey is made. Confirm it once more to finish creating your account."),
        errorBox(state.error),
        button(state.busy ? "Waiting for your passkey…" : "Confirm with passkey", "primary", () => confirmTap?.(), state.busy, "confirm"),
      );
      return;
    }
    if (state.mode === "create") {
      show(
        h("h1", {}, "Create your account"),
        h("p", { class: "hint" }, "Your account is a passkey on this device. No password to remember, nothing to leak."),
        errorBox(state.error),
        h(
          "form",
          {
            class: "form",
            onsubmit: (event: Event) => {
              event.preventDefault();
              void signUp();
            },
          },
          field("Your name", "name", "How people in your spaces see you"),
          state.askInvite ? field("Invite code", "invite", "From the person who invited you", "Needed on a cluster that takes new accounts by invitation.") : null,
          h(
            "button",
            { type: "submit", class: "btn btn-primary", disabled: state.busy, "data-testid": "create" },
            icon("key"),
            state.busy ? "Waiting for your passkey…" : "Create account with passkey",
          ),
        ),
        button("I already have an account", "link", () => set({ mode: "sign-in", error: null }), state.busy),
      );
      return;
    }
    show(
      h("h1", {}, "Sign in to Mero Tag"),
      h("p", { class: "hint" }, "Use your passkey. Mero Tag on your phone continues once you're signed in."),
      errorBox(state.error),
      button(state.busy ? "Waiting for your passkey…" : "Sign in with passkey", "primary", () => void signIn(), state.busy, "sign-in"),
      h("div", { class: "divider" }, h("span", {}, "New to Mero Tag?")),
      button("Create an account", "secondary", () => set({ mode: "create", error: null }), state.busy, "show-create"),
    );
  }

  render();
}

// ---------------------------------------------------------------- approval

function approvePage(request: ApprovalRequest): void {
  let busy = false;
  let error: string | null = null;

  const approve = async () => {
    busy = true;
    error = null;
    render();
    try {
      const assertion = await browserPasskey().get(
        fromB64url(request.challenge),
        request.rpId,
        request.allow.length ? request.allow : undefined,
        { userVerification: "required" },
      );
      returnToApp(await approvedUrl(request, assertion), "Approved");
    } catch (e) {
      busy = false;
      error = describe(e);
      render();
    }
  };

  function render(): void {
    show(
      h("h1", {}, "Approve in Mero Tag"),
      h(
        "p",
        { class: "hint" },
        "Mero Tag on your phone asks you to confirm a change with your passkey. Continue only if you just asked for it in the app.",
      ),
      errorBox(error),
      button(busy ? "Waiting for your passkey…" : "Approve with passkey", "primary", () => void approve(), busy, "approve"),
      button("Cancel", "link", () => returnToApp(declinedUrl(request), "Cancelled"), busy, "decline"),
    );
  }

  render();
}

// ---------------------------------------------------------------- start

function landing(): void {
  show(
    h("div", { class: "badge" }, icon("phone")),
    h("h1", {}, "Mero Tag lives on your phone"),
    h(
      "p",
      { class: "hint" },
      "Live location with the people you choose, on your own Calimero cluster. Open Mero Tag on your iPhone to sign in.",
    ),
  );
}

const opened = readOpened();
switch (opened.kind) {
  case "consent":
    returnToApp(opened.url);
    break;
  case "sign-in":
    signInPage(opened.request);
    break;
  case "approve":
    approvePage(opened.request);
    break;
  case "none":
    landing();
    break;
}
