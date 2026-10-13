import type { PushDeviceInput } from "./generated/HyperfeedClient";

/**
 * Push to your phone: this browser subscribes with its push service, using
 * your agent's runtime's public key, and the feed keeps the subscription. The
 * runtime then sends each new thing that needs you, encrypted to this device.
 *
 * Only the browser side is here: the service worker that shows a push is
 * `public/sw.js`, and the sender is your agent's runtime.
 */

/** This browser can take pushes at all. iOS only from an app added to the Home Screen. */
export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** A base64url key as the bytes `pushManager.subscribe` takes. */
export function keyBytes(key: string): Uint8Array {
  const b64 = key.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  const raw = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** A name for this device from its user agent: "iPhone", "Android", "Mac"… */
export function deviceName(ua: string): string {
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Mac OS X|Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  if (/Linux/.test(ua)) return "Linux";
  return "A device";
}

/** What the feed keeps of a subscription (`PushSubscription.toJSON()`). */
export function inputOf(sub: PushSubscriptionJSON, name: string, quiet: boolean, key: string): PushDeviceInput {
  if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error("This browser gave an incomplete push subscription.");
  return { endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, name, quiet, key };
}

async function registration(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  return navigator.serviceWorker.ready;
}

/** This browser's subscription's endpoint, or null when it has none. */
export async function currentEndpoint(): Promise<string | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  return sub?.endpoint ?? null;
}

/**
 * Subscribe this browser with `key`, asking for permission first (call it from
 * a click). A subscription made with another key is dropped and made again.
 */
export async function subscribe(key: string): Promise<PushSubscriptionJSON> {
  if ((await Notification.requestPermission()) !== "granted") {
    throw new Error("Notifications are blocked for this site: allow them in your browser's settings.");
  }
  const reg = await registration();
  const want = keyBytes(key);
  const old = await reg.pushManager.getSubscription();
  if (old) {
    const had = old.options.applicationServerKey;
    if (had && sameBytes(new Uint8Array(had), want)) return old.toJSON();
    await old.unsubscribe();
  }
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want });
  return sub.toJSON();
}

/** Drop this browser's subscription, if it has one. */
export async function unsubscribe(): Promise<void> {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  await sub?.unsubscribe();
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
