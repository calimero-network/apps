import {
  MeroMinutesClient,
  type ActionView,
  type AppCallTransport,
  type AppTransport,
  type MeetingView,
  type SegmentView,
} from "./generated/client";

export type { ActionView, MeetingView, SegmentView };
export { MeroMinutesClient };

type Raw = Record<string, unknown>;

/**
 * A contract refusal (`appCode` + `fields.message`) as a plain `Error` with
 * the contract's message, which is what the screens show; `appCode` stays on it.
 */
export function asError(e: unknown): unknown {
  const appCode = (e as { appCode?: unknown } | null)?.appCode;
  if (typeof appCode !== "string") return e;
  const message = (e as { fields?: Raw }).fields?.message;
  const err = new Error(typeof message === "string" && message ? message : appCode);
  (err as Error & { appCode?: string }).appCode = appCode;
  return err;
}

const rethrow = (e: unknown): never => {
  throw asError(e);
};

/** The one adapter on the wire: refusals come back as `asError`'s. */
export function minutesTransport(client: AppCallTransport & Partial<Pick<AppTransport, "events">>): AppTransport {
  return {
    apps: {
      call: (args, options) => client.apps.call(args, options).catch(rethrow),
      view: (args, options) => client.apps.view(args, options).catch(rethrow),
    },
    events: (app, from, signal) => {
      if (!client.events) throw new Error("this client has no event stream");
      return client.events(app, from, signal);
    },
  };
}

/** The workspace at app instance `app`. `after` runs after every request (the session store syncs there). */
export function minutesClient(
  client: AppCallTransport & Partial<Pick<AppTransport, "events">>,
  app: string,
  after?: () => void,
): MeroMinutesClient {
  return new MeroMinutesClient(minutesTransport(client), app, after ? { after } : {});
}

/** Deletes a meeting in batches (`deleteMeeting` until nothing remains), reporting what is left. */
export async function deleteMeetingFully(
  client: Pick<MeroMinutesClient, "deleteMeeting">,
  meetingId: string,
  onProgress?: (remaining: number) => void,
): Promise<void> {
  for (let round = 0; round < 1_000; round++) {
    const { remaining } = await client.deleteMeeting({ meetingId });
    onProgress?.(remaining);
    if (remaining === 0) return;
  }
  throw new Error("the meeting is still being deleted; try again");
}
