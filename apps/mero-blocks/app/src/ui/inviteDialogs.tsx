import { createRoot } from "react-dom/client";
import type { ReactElement } from "react";
import type { CalimeroClient, PasskeyProvider } from "@calimero-network/mero-js";
import { AcceptInviteDialog, InviteDialog, type AcceptInviteDialogProps } from "@calimero-network/mero-react";

import { worldLinkBase } from "../net/worlds";

const APP_NAME = "Mero Blocks";

const LABELS = {
  title: "Invite to this world",
  subtitle: "Choose what the players you invite can do in this world.",
  next: "Create invite link",
};

export interface MountedDialog {
  open(): void;
  unmount(): void;
}

/** A shared dialog in a React root of its own, for the imperative launcher. */
function mountDialog(draw: (open: boolean, close: () => void) => ReactElement, openNow: boolean): MountedDialog {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  let isOpen = openNow;
  const close = () => {
    isOpen = false;
    render();
  };
  const render = () => root.render(draw(isOpen, close));
  render();
  return {
    open: () => {
      isOpen = true;
      render();
    },
    unmount: () => {
      root.unmount();
      host.remove();
    },
  };
}

/** Invite people into `org`, for the world `world`: opened by `open()`. `after` runs once an invite exists (the stored session may have refreshed). */
export function mountInviteWorld(
  client: CalimeroClient,
  passkey: PasskeyProvider,
  org: string,
  world: string,
  after: () => void,
): MountedDialog {
  return mountDialog(
    (open, close) => (
      <InviteDialog
        client={client}
        passkey={passkey}
        open={open}
        onClose={close}
        org={org}
        appName={APP_NAME}
        labels={LABELS}
        onInvited={after}
        linkBase={worldLinkBase(org, world)}
      />
    ),
    false,
  );
}

/** Ask whether to join with `token`: open at once, and finishing a join approved on a full-page trip. */
export function mountAcceptInvite(
  client: CalimeroClient,
  passkey: PasskeyProvider,
  { token, onJoined, onClose }: Pick<AcceptInviteDialogProps, "token" | "onJoined" | "onClose">,
): MountedDialog {
  return mountDialog(
    (open, close) => (
      <AcceptInviteDialog
        client={client}
        passkey={passkey}
        open={open}
        token={token}
        appName={APP_NAME}
        onJoined={onJoined}
        onClose={() => {
          close();
          onClose();
        }}
      />
    ),
    true,
  );
}
