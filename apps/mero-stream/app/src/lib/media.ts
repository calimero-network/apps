// ── Acquiring the camera, and saying why when you cannot ──────────────────────
//
// Every call site used to reach straight for `navigator.mediaDevices.getUserMedia`.
// That object does not always exist, and when it does not, the dereference throws
// a TypeError whose message is the one users actually reported:
//
//     undefined is not an object (evaluating 'navigator.mediaDevices.getUserMedia')
//
// which names a JavaScript expression rather than anything a user can act on. The
// two call sites that caught it surfaced that string verbatim as the app's error;
// the third did not catch it at all.
//
// `navigator.mediaDevices` is absent, not merely restricted, in two situations:
//
//   * the page is not a SECURE CONTEXT — plain http:// on anything but
//     localhost/127.0.0.1. The whole Media Capture API is gated on that, so no
//     amount of permission granting brings it back.
//   * the embedder does not expose media capture at all. The Calimero desktop is
//     WKWebView via wry, whose UI delegate does grant camera/mic
//     (`webView:requestMediaCapturePermissionForOrigin:`) — so a *denied*
//     permission is a DOMException, which is a different branch below. A missing
//     `mediaDevices` in a secure context means the webview never published the
//     API in the first place, and nothing this app does will change that.
//
// This app is web only (see "Platform support" in the README), so for the second
// case the honest advice is to open it in a browser.

/**
 * `navigator.mediaDevices`, typed as the optional thing it actually is.
 *
 * The DOM lib declares it non-optional and `getUserMedia` as a plain method, so
 * `navigator.mediaDevices?.getUserMedia` is TS2774 ("this condition will always
 * return true") — TypeScript's model of the platform is exactly the assumption
 * this module exists to disprove. Re-typing it here is the narrowest way to say
 * "may be absent" without an `any` or a blanket ts-expect-error.
 */
function mediaDevices(): MediaDevices | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as Navigator & { mediaDevices?: MediaDevices })
    .mediaDevices;
}

/**
 * Why the Media Capture API is unusable here, or `null` if it is usable.
 *
 * Split out from {@link acquireCamera} so a component can gate its UI before the
 * user clicks something that cannot work.
 */
export function cameraUnavailableReason(): string | null {
  if (typeof navigator === "undefined") {
    return "No browser environment — there is no camera to open here.";
  }
  if (typeof mediaDevices()?.getUserMedia === "function") return null;

  // `isSecureContext` is the spec's own name for the gate, and it is the check
  // that separates the two causes. Treat a missing flag as secure: an engine old
  // enough to lack it is not the case being diagnosed.
  const secure =
    typeof window === "undefined" || window.isSecureContext !== false;

  if (!secure) {
    return (
      "The camera needs a secure page. This app is being served over plain " +
      "http:// from a host that is not localhost, and browsers withhold the " +
      "whole Media Capture API there — open it over https:// (or via " +
      "http://localhost) and it will appear."
    );
  }
  return (
    "This window has no camera API. Mero Stream is a web app and its capture " +
    "routes need a browser — the Calimero desktop's webview does not expose " +
    "navigator.mediaDevices. Open the app in Chrome and try again."
  );
}

/**
 * Open the camera, or throw an `Error` whose message is worth showing.
 *
 * Both failure families are turned into prose here rather than at the call
 * sites, because all three of them did the same `e instanceof Error ? e.message`
 * and so could only ever be as clear as what they were handed.
 */
export async function acquireCamera(
  constraints: MediaStreamConstraints,
): Promise<MediaStream> {
  const reason = cameraUnavailableReason();
  if (reason) throw new Error(reason);

  try {
    // Non-null: `reason` above returned null, which is only possible when
    // `getUserMedia` is a function on this object.
    return await mediaDevices()!.getUserMedia(constraints);
  } catch (err) {
    throw new Error(describeGetUserMediaError(err));
  }
}

/**
 * Map a `getUserMedia` rejection onto something readable.
 *
 * The names are the spec's, and each one means a genuinely different thing to
 * whoever is looking at the screen — "permission" and "no camera" want opposite
 * next steps, and both arrive as a bare `DOMException` whose own `.message`
 * varies by browser and is sometimes empty.
 */
export function describeGetUserMediaError(err: unknown): string {
  const name =
    typeof err === "object" && err !== null && "name" in err
      ? String((err as { name: unknown }).name)
      : "";
  const detail =
    err instanceof Error && err.message ? ` (${err.message})` : "";

  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return `Camera access was refused. Allow camera (and microphone) for this site in the browser's address bar, then try again.${detail}`;
    case "NotFoundError":
    case "OverconstrainedError":
      return `No camera matched what this route asked for. Check a camera is connected and not disabled.${detail}`;
    case "NotReadableError":
    case "AbortError":
      return `The camera could not be started — another application is most likely holding it. Close anything else using the camera and try again.${detail}`;
    default:
      return err instanceof Error && err.message
        ? err.message
        : "The camera could not be opened.";
  }
}
