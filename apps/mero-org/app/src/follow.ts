import type { AdminApiClient } from "@calimero-network/mero-js";
import type { AppView, EnrolmentView } from "./backend";
import { messageOf } from "./useOrg";

/** Enrolment states in which the account sits in the app namespace's root. */
const IN_NAMESPACE = new Set(["added", "placed"]);

export interface ToFollow { enrolment: EnrolmentView; app: AppView }

/**
 * The apps this node should follow: the account is in the app namespace's root
 * (the reconciler put it there) and this node does not hold the namespace yet.
 */
export function appsToFollow(mine: EnrolmentView[], apps: AppView[], held: ReadonlySet<string>): ToFollow[] {
  return mine.flatMap((enrolment) => {
    if (!IN_NAMESPACE.has(enrolment.state) || held.has(enrolment.app)) return [];
    const app = apps.find((a) => a.id === enrolment.app && a.status === "ready" && a.application_id);
    return app ? [{ enrolment, app }] : [];
  });
}

export type FollowOutcome =
  | { ok: true; keyReady: boolean }
  /** `final`: only an admin can change the answer, so retrying will not help */
  | { ok: false; reason: string; final: boolean };

/** Follow the app namespace from the admin's node; the node answers within its own deadline. */
export async function followApp(admin: Pick<AdminApiClient, "followNamespace">, app: AppView): Promise<FollowOutcome> {
  try {
    const out = await admin.followNamespace(app.id, { peerAddrs: app.peer_addrs, applicationId: app.application_id });
    return { ok: true, keyReady: out.keyReady };
  } catch (e) {
    const status = (e as { status?: unknown }).status;
    return { ok: false, reason: messageOf(e), final: status === 400 || status === 403 };
  }
}
