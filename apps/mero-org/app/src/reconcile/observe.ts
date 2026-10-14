import type { AdminApiClient } from "@calimero-network/mero-js";
import { ORG_GROUP_KEY, ORG_KEY, type ObservedApp, type ObservedSubgroup } from "./types";

export type Observer = Pick<AdminApiClient, "listGroupMembers" | "listNamespaceGroups" | "getGroupMetadata" | "getMemberCapabilities">;

/** What the app namespace looks like right now, from the admin's caller-scoped view. */
export async function observeApp(admin: Observer, appId: string, orgNamespaceId: string): Promise<ObservedApp> {
  const root = await admin.listGroupMembers(appId);
  const rootMembers = new Set(root.members.map((m) => m.identity));
  const entries = await admin.listNamespaceGroups(appId);
  const subgroups: ObservedSubgroup[] = [];
  for (const e of entries) {
    const [meta, members] = await Promise.all([admin.getGroupMetadata(e.groupId), admin.listGroupMembers(e.groupId)]);
    const orgGroupId = meta?.data?.[ORG_GROUP_KEY] ?? null;
    const org = meta?.data?.[ORG_KEY] ?? null;
    const accounts = members.members.map((m) => m.identity);
    const capabilities = new Map<string, number>();
    // Only this org's mirrored subgroups are reconciled, so only they are worth the per-member reads.
    if (orgGroupId && org === orgNamespaceId) {
      const caps = await Promise.all(accounts.map((a) => admin.getMemberCapabilities(e.groupId, a)));
      accounts.forEach((a, i) => capabilities.set(a, caps[i]!.capabilities));
    }
    subgroups.push({ groupId: e.groupId, name: meta?.name ?? "", orgGroupId, org, members: new Set(accounts), capabilities });
  }
  return { appId, rootMembers, subgroups };
}
