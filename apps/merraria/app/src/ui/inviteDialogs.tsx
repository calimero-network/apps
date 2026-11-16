import { createRoot } from "react-dom/client";
import type { ReactElement } from "react";
import type { CalimeroClient, PasskeyProvider } from "@calimero-network/mero-js";
import { AcceptInviteDialog, InviteDialog, type AcceptInviteDialogProps } from "@calimero-network/mero-react";

import { worldLinkBase } from "../net/worlds";

const APP_NAME = "Merraria";

const LABELS = {
  noun: "world",
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
  inviterName?: string,
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
        inviterName={inviterName}
        linkBase={worldLinkBase(org, world, inviterName)}
      />
    ),
    false,
  );
}

/** Ask whether to join with `token`: open at once, and finishing a join approved on a full-page trip. */
export function mountAcceptInvite(
  client: CalimeroClient,
  passkey: PasskeyProvider,
  { token, org, from, onJoined, onClose, onError }: Pick<AcceptInviteDialogProps, "token" | "org" | "onJoined" | "onClose" | "onError"> & {
    from: string | null;
  },
): MountedDialog {
  return mountDialog(
    (open, close) => (
      <AcceptInviteDialog
        client={client}
        passkey={passkey}
        open={open}
        token={token}
        org={org}
        appName={APP_NAME}
        labels={{
          noun: "world",
          title: from ? `Join ${from}'s game` : "Join the game",
          body: "Joining makes you a member of its world's organization: you can enter its worlds and build there.",
        }}
        onError={onError}
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
