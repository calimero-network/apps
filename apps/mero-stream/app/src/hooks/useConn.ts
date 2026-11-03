import { useCallback, useMemo } from "react";
import { browserPasskey } from "@calimero-network/mero-js";
import { appSource } from "@calimero-apps/connect";
import { useSessionApi } from "../session";
import { PACKAGE } from "../lib/meroStream";

/**
 * What a signed-in page needs from the session: the client, who is signed in,
 * where rooms come from (the dev bundle under `vite`, the package in
 * production), and `after` (keeps the stored session current after a
 * request). `null` while signed out.
 */
export function useConn() {
  const { session, store, env } = useSessionApi();
  const client = session.status === "signed-in" ? session.client : null;
  const accountId = session.status === "signed-in" ? session.accountId : null;
  const source = useMemo(() => appSource(env, PACKAGE), [env]);
  const after = useCallback(() => {
    if (client) store?.sync(client);
  }, [client, store]);
  return useMemo(
    () =>
      client && accountId
        ? { client, accountId, source, after, passkey: browserPasskey }
        : null,
    [client, accountId, source, after],
  );
}

export type Conn = NonNullable<ReturnType<typeof useConn>>;
