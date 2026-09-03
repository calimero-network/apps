// ── Acquiring camera + mic, and saying why when you cannot ────────────────────
//
// `WebRtcMesh.start()` used to reach straight for
// `navigator.mediaDevices.getUserMedia`, unguarded and uncaught. That object does
// not always exist, and when it does not, the dereference throws a TypeError
// whose message is the one users actually reported:
//
//     undefined is not an object (evaluating 'navigator.mediaDevices.getUserMedia')
//
// which names a JavaScript expression rather than anything anyone can act on —
// and, being thrown rather than handled, it took the whole join with it.
//
// `navigator.mediaDevices` is absent, not merely restricted, in two situations:
//
//   * the page is not a SECURE CONTEXT — plain http:// on anything but
//     localhost/127.0.0.1. The whole Media Capture API is gated on that, so no
//     amount of permission granting brings it back. This is the one to suspect
//     first when a call works from Vercel and not from a LAN address.
//   * the embedder does not expose media capture at all. The Calimero desktop is
//     WKWebView via wry, whose UI delegate does grant camera/mic
//     (`webView:requestMediaCapturePermissionForOrigin:`), and the bundle
//     declares both entitlements and both usage descriptions — so a *denied*
//     permission arrives as a DOMException, which is the other branch below. A
//     missing `mediaDevices` in a secure context means the webview never
//     published the API, and nothing this app does will change that.
//
// A call is the whole point of this app, so the message has to distinguish them:
// one is fixed by the URL you opened, the other only by opening it elsewhere.

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
 * Exported separately from {@link acquireLocalMedia} so a screen can say so
 * before the user commits to joining a call that cannot carry their media.
 */
export function localMediaUnavailableReason(): string | null {
  if (typeof navigator === "undefined") {
    return "No browser environment — there is no camera or microphone to open here.";
  }
  if (typeof mediaDevices()?.getUserMedia === "function") return null;

  // `isSecureContext` is the spec's own name for the gate, and it is what
  // separates the two causes. Treat a missing flag as secure: an engine old
  // enough to lack it is not the case being diagnosed.
  const secure =
    typeof window === "undefined" || window.isSecureContext !== false;

  if (!secure) {
    return (
      "Camera and microphone need a secure page. This window was opened over " +
      "plain http:// from a host that is not localhost, and browsers withhold " +
      "the whole Media Capture API there. Open Mero Meet over https:// (or via " +
      "http://localhost) and your devices will appear."
    );
  }
  return (
    "This window has no camera or microphone API — navigator.mediaDevices is " +
    "missing, so the webview never published it. Open Mero Meet in a browser " +
    "(Chrome or Safari) to join with media."
  );
}

/**
 * Open camera + mic, or throw an `Error` whose message is worth showing.
 *
 * Both failure families become prose here rather than at the call site, so the
 * diagnosis lives in one place and `start()` stays about publishing tracks.
 */
export async function acquireLocalMedia(
  constraints: MediaStreamConstraints = { video: true, audio: true },
): Promise<MediaStream> {
  const reason = localMediaUnavailableReason();
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
 * The names are the spec's, and each means a genuinely different thing to
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
      return `Camera and microphone access was refused. Allow them for this site in the browser's address bar, then rejoin.${detail}`;
    case "NotFoundError":
    case "OverconstrainedError":
      return `No camera or microphone was found. Check they are connected and not disabled, then rejoin.${detail}`;
    case "NotReadableError":
    case "AbortError":
      return `Your camera or microphone could not be started — another application is most likely holding it. Close anything else using it and rejoin.${detail}`;
    default:
      return err instanceof Error && err.message
        ? err.message
        : "Your camera and microphone could not be opened.";
  }
}
