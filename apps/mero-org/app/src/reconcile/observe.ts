import type { AdminApiClient } from "@calimero-network/mero-js";
import { ORG_GROUP_KEY, type ObservedApp, type ObservedSubgroup } from "./types";

export type Observer = Pick<AdminApiClient, "listGroupMembers" | "listNamespaceGroups" | "getGroupMetadata">;

/** What the app namespace looks like right now, from the admin's caller-scoped view. */
export async function observeApp(admin: Observer, appId: string): Promise<ObservedApp> {
  const root = await admin.listGroupMembers(appId);
  const rootMembers = new Set(root.members.map((m) => m.identity));
  const entries = await admin.listNamespaceGroups(appId);
  const subgroups: ObservedSubgroup[] = [];
  for (const e of entries) {
    const [meta, members] = await Promise.all([admin.getGroupMetadata(e.groupId), admin.listGroupMembers(e.groupId)]);
    subgroups.push({ groupId: e.groupId, name: meta?.name ?? "", orgGroupId: meta?.data[ORG_GROUP_KEY] ?? null, members: new Set(members.members.map((m) => m.identity)) });
  }
  return { appId, rootMembers, subgroups };
}
