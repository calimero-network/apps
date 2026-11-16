import { ensureNotificationPermission } from "../utils/notificationPermission";

// The browser's install offer is captured once, by the shared package the
// landing page's Install button also uses, so both buttons see the same offer.
export { promptInstall, useCanInstall } from "@calimero-apps/install";

if (typeof window !== "undefined") {
  window.addEventListener("appinstalled", () => {
    // Right after the install gesture, so the permission prompt has context.
    void ensureNotificationPermission();
  });
}
