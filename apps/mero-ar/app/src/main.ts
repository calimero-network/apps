import "./styles.css";
import {
  ConfirmCancelled,
  ConfirmPromptBlocked,
  PasskeyUnknownHere,
  SignUpRefused,
  browserPasskey,
  type CalimeroClient,
  type PasskeyProvider,
} from "@calimero-network/mero-js";
import { NotServedError, connect } from "./connect";
import {
  approveNative,
  bounceNativeConsent,
  captureNativeApproval,
  captureNativeSignIn,
  declineNative,
  finishNativeSignIn,
  type NativeApprovalRequest,
} from "./native";

/**
 * Mero AR's served page. Mero AR is an iPhone app; the cluster serves this
 * page from its bundle on the package's own origin, the only origin a node
 * takes Mero AR's passkey ceremonies from. The app opens it in the system
 * sign-in sheet for three things only:
 *
 * - `#native-sign-in`: sign in or create an account with a passkey, then
 *   hand the session (bound to Mero AR's package) back to `mero-ar://signed-in`;
 * - `#native-approve`: approve one of Mero AR's own step-ups with the
 *   passkey, back to `mero-ar://approved`;
 * - `?native-consent=1`: the node's consent page returning; passed on to
 *   `mero-ar://consent`.
 */
const APP = "Mero AR";
const SIGNED_IN = "mero-ar://signed-in";
const APPROVED = "mero-ar://approved";
const CONSENT = "mero-ar://consent";

const root = document.getElementById("root") as HTMLElement;

// ------------------------------------------------------------------ DOM

type Child = Node | string | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<string, string>> & { onclick?: () => void } = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "onclick") el.addEventListener("click", value as unknown as () => void);
    else if (typeof value === "string") el.setAttribute(key, value);
  }
  for (const child of children) if (child) el.append(child);
  return el;
}

const SVG = "http://www.w3.org/2000/svg";

/** An icon from path data (24×24, stroked). */
function icon(paths: string[], label?: string): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "icon");
  if (label) svg.setAttribute("aria-label", label);
  else svg.setAttribute("aria-hidden", "true");
  for (const d of paths) {
    const path = document.createElementNS(SVG, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

const KEY = ["M15 7a4 4 0 1 1-3.87 5H9v2H7v2H4v-3l5.13-5.13A4 4 0 0 1 15 7z", "M16 10h.01"];
const SHIELD = ["M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z", "M9 12l2 2 4-4"];
const LOCK = ["M6 11h12v9H6z", "M8.5 11V8a3.5 3.5 0 0 1 7 0v3"];
const PHONE = ["M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z", "M11 18h2"];

/** The Mero AR mark: the cube on the aurora gradient. */
function mark(): HTMLElement {
  const wrap = h("div", { class: "mark" });
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 64 64");
  svg.setAttribute("aria-hidden", "true");
  for (const d of ["M32 13 49 22.5v19L32 51 15 41.5v-19z", "M15 22.5 32 32l17-9.5M32 32v19"]) {
    const path = document.createElementNS(SVG, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  wrap.append(svg);
  return wrap;
}

function card(...children: Child[]): HTMLElement {
  return h("section", { class: "card" }, ...children);
}

function header(title: string, text: string): HTMLElement {
  return h("header", { class: "head" }, mark(), h("h1", {}, title), h("p", { class: "lead" }, text));
}

function errorLine(message: string | null): HTMLElement | null {
  return message ? h("p", { class: "error", role: "alert" }, message) : null;
}

function button(label: string, onclick: () => void, options: { primary?: boolean; busy?: boolean; icon?: string[]; testid?: string } = {}) {
  const el = h(
    "button",
    {
      type: "button",
      class: options.primary ? "btn btn-primary" : "btn btn-link",
      ...(options.testid ? { "data-testid": options.testid } : {}),
    },
    options.busy ? h("span", { class: "spinner", "aria-hidden": "true" }) : options.icon ? icon(options.icon) : null,
    h("span", {}, label),
  );
  el.addEventListener("click", onclick);
  if (options.busy) el.setAttribute("disabled", "");
  return el;
}

function footnote(): HTMLElement {
  return h(
    "p",
    { class: "foot" },
    icon(LOCK),
    h("span", {}, "Every node is attested before this page talks to it. Your rooms stay on your cluster."),
  );
}

function show(...children: Child[]): void {
  root.replaceChildren(...children.filter((c): c is Node | string => !!c));
}

// --------------------------------------------------------------- errors

function describe(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") return "The passkey prompt was closed. Try again.";
  if (error instanceof ConfirmCancelled) return "The passkey prompt was closed. Try again.";
  if (error instanceof ConfirmPromptBlocked) return "The browser blocked the passkey prompt. Tap the button again.";
  if (error instanceof PasskeyUnknownHere)
    return "This cluster doesn't know that passkey. Create an account here instead.";
  if (error instanceof SignUpRefused) {
    switch (error.reason) {
      case "invite-only":
        return "This cluster takes new accounts by invitation only. Enter the invite you were sent.";
      case "closed":
        return "This cluster isn't taking new accounts. Sign in with an existing passkey.";
      case "unknown-invite":
        return "This cluster doesn't recognize that invite. Check it, or ask for a new one.";
      case "expired-invite":
        return "That invite has expired or been used up. Ask for a new one.";
      default:
        return error.message || "This cluster refused the sign-up.";
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong. Try again.";
}

// ------------------------------------------------------------- sign-in

let client: Promise<CalimeroClient> | null = null;

function cluster(): Promise<CalimeroClient> {
  client ??= connect().catch((e: unknown) => {
    client = null;
    throw e;
  });
  return client;
}

type SignIn =
  | { step: "start"; busy: boolean; error: string | null }
  | { step: "create"; busy: boolean; error: string | null; name: string; invite: string; needsInvite: boolean }
  | { step: "confirm"; error: string | null }
  | { step: "done" };

let signIn: SignIn = { step: "start", busy: false, error: null };
/** The sign-up's second prompt waits for this tap (Safari asks only from one). */
let confirmTap: { resolve: () => void; reject: (e: unknown) => void } | null = null;

function setSignIn(next: SignIn): void {
  signIn = next;
  renderSignIn();
}

/**
 * Hand the session to the app. Nothing to forget here: the page never stores
 * it, and signing out would end the app's session too.
 */
async function finish(c: CalimeroClient): Promise<void> {
  setSignIn({ step: "done" });
  await finishNativeSignIn({ client: c, callback: SIGNED_IN, forgetHere: () => {} });
}

async function doSignIn(): Promise<void> {
  setSignIn({ step: "start", busy: true, error: null });
  try {
    const c = await cluster();
    await c.signIn(browserPasskey());
    await finish(c);
  } catch (e) {
    setSignIn({ step: "start", busy: false, error: describe(e) });
  }
}

/** A passkey whose sign-up confirmation waits for a tap of its own. */
function confirmingPasskey(base: PasskeyProvider): PasskeyProvider {
  return {
    create: (options, createOptions) => base.create(options, createOptions),
    get: async (challenge, rpId, allow, options) => {
      await new Promise<void>((resolve, reject) => {
        confirmTap = { resolve, reject };
        setSignIn({ step: "confirm", error: null });
      });
      return base.get(challenge, rpId, allow, options);
    },
  };
}

async function doSignUp(name: string, invite: string, needsInvite: boolean): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) {
    setSignIn({ step: "create", busy: false, error: "Enter a name for your account.", name, invite, needsInvite });
    return;
  }
  setSignIn({ step: "create", busy: true, error: null, name, invite, needsInvite });
  try {
    const c = await cluster();
    const code = invite.trim();
    await c.signUp(confirmingPasskey(browserPasskey()), trimmed, code ? { invite: code } : {});
    await finish(c);
  } catch (e) {
    const asks = e instanceof SignUpRefused && ["invite-only", "unknown-invite", "expired-invite"].includes(e.reason);
    setSignIn({ step: "create", busy: false, error: describe(e), name, invite, needsInvite: needsInvite || asks });
  } finally {
    confirmTap = null;
  }
}

function field(label: string, value: string, attrs: Record<string, string>, oninput: (v: string) => void) {
  const input = h("input", { class: "input", value, "aria-label": label, placeholder: label, ...attrs });
  input.value = value;
  input.addEventListener("input", () => oninput(input.value));
  return input;
}

function renderSignIn(): void {
  const s = signIn;
  switch (s.step) {
    case "start":
      show(
        card(
          header(`Sign in to ${APP}`, `Use your passkey to continue in the ${APP} app on this iPhone.`),
          errorLine(s.error),
          button(s.busy ? "Waiting for your passkey…" : "Sign in with passkey", () => void doSignIn(), {
            primary: true,
            busy: s.busy,
            icon: KEY,
            testid: "sign-in",
          }),
          s.busy
            ? null
            : button(
                "Create an account",
                () => setSignIn({ step: "create", busy: false, error: null, name: "", invite: "", needsInvite: false }),
                { testid: "create-account" },
              ),
        ),
        footnote(),
      );
      return;
    case "create": {
      const draft = { name: s.name, invite: s.invite };
      const submit = () => void doSignUp(draft.name, draft.invite, s.needsInvite);
      const form = h(
        "form",
        { class: "form" },
        field("Your name", s.name, { autocomplete: "name", autocapitalize: "words", maxlength: "64" }, (v) => (draft.name = v)),
        s.needsInvite
          ? field("Invite link or code", s.invite, { autocomplete: "off", autocapitalize: "none", spellcheck: "false" }, (v) => (draft.invite = v))
          : null,
        errorLine(s.error),
        button(s.busy ? "Waiting for your passkey…" : "Create account", submit, {
          primary: true,
          busy: s.busy,
          icon: KEY,
          testid: "create",
        }),
      );
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        if (!s.busy) submit();
      });
      show(
        card(
          header("Create your account", "A new passkey is saved on this iPhone. You confirm with it twice."),
          form,
          s.busy ? null : button("I already have an account", () => setSignIn({ step: "start", busy: false, error: null })),
        ),
        footnote(),
      );
      return;
    }
    case "confirm":
      show(
        card(
          header("One more step", "Your passkey is ready. Confirm with it once more to create your account."),
          errorLine(s.error),
          button("Confirm with passkey", () => confirmTap?.resolve(), { primary: true, icon: KEY, testid: "confirm" }),
          button("Cancel", () => confirmTap?.reject(new ConfirmCancelled())),
        ),
        footnote(),
      );
      return;
    case "done":
      show(card(header(`Returning to ${APP}…`, "You're signed in. This page closes on its own.")));
      return;
  }
}

// ------------------------------------------------------------ approvals

function renderApproval(request: NativeApprovalRequest, busy = false, error: string | null = null): void {
  const approve = async () => {
    renderApproval(request, true);
    try {
      await approveNative({ approver: browserPasskey(), callback: APPROVED, request });
      show(card(header(`Returning to ${APP}…`, "Approved. This page closes on its own.")));
    } catch (e) {
      renderApproval(request, false, describe(e));
    }
  };
  show(
    card(
      h("header", { class: "head" }, h("div", { class: "badge" }, icon(SHIELD)), h("h1", {}, `Approve in ${APP}`)),
      h(
        "p",
        { class: "lead" },
        `${APP} on your iPhone asks you to confirm a change with your passkey. Continue only if you just asked for it in the app.`,
      ),
      errorLine(error),
      button(busy ? "Waiting for your passkey…" : "Approve with passkey", () => void approve(), {
        primary: true,
        busy,
        icon: KEY,
        testid: "native-approve",
      }),
      busy ? null : button("Cancel", () => declineNative({ callback: APPROVED, request }), { testid: "native-decline" }),
    ),
    footnote(),
  );
}

// ---------------------------------------------------------------- start

function renderElsewhere(): void {
  show(
    card(
      header(APP, "Scan a room and build in it together, in shared 3D space, on your own Calimero cluster."),
      h("p", { class: "note" }, icon(PHONE), h("span", {}, `${APP} is an iPhone app. Open it to sign in.`)),
    ),
    footnote(),
  );
}

function start(): void {
  // The node's consent page returning to the app: pass it on, render nothing more.
  if (bounceNativeConsent(window.location, CONSENT)) {
    show(card(header(`Returning to ${APP}…`, "This page closes on its own.")));
    return;
  }
  const approval = captureNativeApproval();
  if (approval) return renderApproval(approval);
  if (captureNativeSignIn()) {
    renderSignIn();
    // Attest the cluster while the person reads the page.
    void cluster().catch((e: unknown) => {
      if (e instanceof NotServedError) setSignIn({ step: "start", busy: false, error: e.message });
    });
    return;
  }
  renderElsewhere();
}

start();
