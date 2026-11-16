import { createRoot } from "react-dom/client";
import { InstallAppIconButton } from "@calimero-apps/install";

/** The shared install icon in a React root of its own, for the imperative launcher. */
export function mountInstallButton(host: HTMLElement): () => void {
  const root = createRoot(host);
  root.render(<InstallAppIconButton className="mbl-install-btn" />);
  return () => root.unmount();
}
