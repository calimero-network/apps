// Hyperfeed's service worker: it only shows pushes.
//
// Your agent's runtime sends a push when something starts needing you and you
// have not seen it for a while. The payload, encrypted to this device, is
// `{ title, body, chain, opens }`: `opens` "chat" opens your agent's question
// in its chat, anything else the feed. A device set to quiet gets only
// "Something needs you", with no chain. Nothing here is cached: the app
// itself always comes from the network.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === "string" && data.title ? data.title : "Something needs you";
  const chain = typeof data.chain === "string" ? data.chain : "";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === "string" ? data.body : "",
      // A second push for the same chain replaces the first.
      tag: chain || "hyperfeed",
      icon: "icon-192.png",
      badge: "icon-192.png",
      data: { url: urlOf(chain, data.opens) },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.registration.scope).href;
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of open) {
        if (new URL(c.url).origin !== self.location.origin) continue;
        await c.focus();
        if ("navigate" in c) await c.navigate(url).catch(() => undefined);
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});

function urlOf(chain, opens) {
  return opens === "chat" && chain ? `chat/${encodeURIComponent(chain)}` : "./";
}
