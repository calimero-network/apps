import { CreateWorkspaceDialog } from "@calimero-network/mero-react";
import { lastUsedName } from "@calimero-apps/names";
import { reviewRelease, useResolvedSource } from "@calimero-apps/passkey";
import { closeNewFeed, feedSource, finishNewFeed, signedIn, useNewFeedState } from "./newFeed";
import { PACKAGE, useSessionApi } from "./session";

const LABELS = {
  title: "New feed",
  subtitle: "A feed is an app only you write to. It lives in an organization of its own.",
  nameLabel: "Feed name",
  namePlaceholder: "e.g. My feed",
  selfLabel: "Your name in this feed",
  selfPlaceholder: "e.g. Ana",
};

/** The shared create dialog, opened by `useNewFeed().create()`. Mounted once. */
export function NewFeedDialog() {
  const { session, passkey } = useSessionApi();
  const live = signedIn(session);
  const { open } = useNewFeedState();
  const { source, pending } = useResolvedSource(live?.client ?? null, live?.accountId ?? null, feedSource());
  if (!live) return null;
  return (
    <CreateWorkspaceDialog
      client={live.client}
      passkey={passkey()}
      release={pending ? null : (reviewRelease(source) ?? { package: PACKAGE })}
      defaultSelfName={lastUsedName()}
      open={open}
      onClose={closeNewFeed}
      onCreated={(made) => void finishNewFeed(live, made)}
      labels={LABELS}
    />
  );
}
