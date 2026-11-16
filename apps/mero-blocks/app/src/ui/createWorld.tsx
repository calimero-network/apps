import { createRoot } from "react-dom/client";
import type { CalimeroClient, PasskeyProvider } from "@calimero-network/mero-js";
import { ConsentPopupReturn, CreateWorkspaceDialog, type CreateWorkspaceDialogProps } from "@calimero-network/mero-react";
import { resolveSource, type AppSource } from "@calimero-apps/connect";
import { reviewRelease } from "@calimero-apps/passkey";

import { PACKAGE } from "../net/blocks";
import { knownName } from "../net/playerName";

const LABELS = {
  title: "Create world",
  subtitle: "Name your world, and choose the name other players see.",
  nameLabel: "World name",
  namePlaceholder: "overworld",
  selfLabel: "Your name in this world",
  selfPlaceholder: "Steve",
};

export interface CreateWorldDialog {
  open(): void;
  /** The release a new world is made from: the newest the node lists once read. */
  source(): AppSource;
  unmount(): void;
}

/**
 * The shared create-workspace dialog in a React root of its own, for the
 * imperative launcher. Mounted for as long as the world picker shows, so it
 * also finishes a world approved on a full-page trip to the node.
 */
export function mountCreateWorld(
  client: CalimeroClient & Parameters<typeof resolveSource>[0],
  passkey: PasskeyProvider,
  base: AppSource,
  onCreated: CreateWorkspaceDialogProps["onCreated"],
): CreateWorldDialog {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  let isOpen = false;
  let source = base;
  let pending = typeof base !== "string" && !base.version;
  let live = true;
  const render = () =>
    root.render(
      <CreateWorkspaceDialog
        client={client}
        passkey={passkey}
        release={pending ? null : (reviewRelease(source) ?? { package: PACKAGE })}
        defaultSelfName={knownName()}
        open={isOpen}
        onClose={() => {
          isOpen = false;
          render();
        }}
        onCreated={(created) => {
          isOpen = false;
          render();
          onCreated(created);
        }}
        labels={LABELS}
      />,
    );
  render();
  void resolveSource(client, base, window.location.href).then((resolved) => {
    if (!live) return;
    source = resolved;
    pending = false;
    render();
  });
  return {
    open: () => {
      isOpen = true;
      render();
    },
    source: () => source,
    unmount: () => {
      live = false;
      root.unmount();
      host.remove();
    },
  };
}

/**
 * Runs `start` unless this window is the pop-up the node's consent page sent
 * back to the app: that one tells its opener and closes, and must not boot a game.
 */
export function startUnlessConsentReturn(start: () => void): void {
  const host = document.createElement("div");
  document.body.appendChild(host);
  let started = false;
  // The child mounts only outside the pop-up, so its ref is the "not a pop-up" signal.
  const mounted = (el: HTMLElement | null) => {
    if (el && !started) {
      started = true;
      start();
    }
  };
  createRoot(host).render(
    <ConsentPopupReturn>
      <i ref={mounted} hidden />
    </ConsentPopupReturn>,
  );
}
