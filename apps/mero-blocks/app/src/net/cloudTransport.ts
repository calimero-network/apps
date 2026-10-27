// The cluster transport: `AdminOps` over the cloud client's admin (v1's names,
// answered by Calimero Cloud's organizations, teams and app instances), the
// contract over its rpc, and events over each app's committed log.
//
// Replaces v1's node transport (bearer REST to `/admin-api`, `/jsonrpc`,
// `/sse`) and account transport (relay warrants): every request now goes
// sealed to an attested node, signed in with the player's passkey session.

import {
  CloudMero,
  createCloudAdmin,
  currentApplicationId,
  ensurePackage,
} from "@calimero-apps/cloud";
import { PACKAGE_NAME, REGISTRY_URL } from "./auth";
import { decodeOutput } from "./rpc";
import { getSession } from "./session";
import type { AdminOps, ContextInfo, EventStream, Transport } from "./transport";

type Json = Record<string, unknown>;

const contextsOf = (rows: unknown): ContextInfo[] =>
  (Array.isArray(rows) ? (rows as Json[]) : []).map((c) => ({
    contextId: String(c.contextId ?? c.id ?? ""),
    applicationId: String(c.applicationId ?? ""),
    ...(typeof c.name === "string" ? { name: c.name } : {}),
  }));

const groupIdsOf = (rows: unknown): string[] =>
  (Array.isArray(rows) ? (rows as Json[]) : []).map((g) => String(g.groupId ?? "")).filter(Boolean);

export function createCloudTransport(): Transport {
  const mero = new CloudMero(getSession().nodeUrl ?? undefined);
  const a = createCloudAdmin(mero);

  const admin: AdminOps = {
    // A development cluster runs the bundle this build names; anything else
    // installs the signed package from the registry, verified by every node.
    async resolveApplicationId() {
      return currentApplicationId() ?? (await ensurePackage(mero, PACKAGE_NAME, undefined, REGISTRY_URL));
    },
    async listContexts() {
      return contextsOf(((await a.getContexts()) as Json).contexts);
    },
    async createNamespace(applicationId, name) {
      const { namespaceId } = (await a.createNamespace({ applicationId, name })) as { namespaceId: string };
      return { namespaceId };
    },
    async createOpenGroup(namespaceId, name) {
      const { groupId } = (await a.createGroupInNamespace(namespaceId, { groupName: name, visibility: "open" })) as { groupId: string };
      return groupId;
    },
    async createContext(applicationId, groupId, name, initializationParams) {
      const out = (await a.createContext({ applicationId, groupId, name, initializationParams })) as Json;
      return { contextId: String(out.contextId), memberPublicKey: String(out.memberPublicKey) };
    },
    async identitiesOwned(contextId) {
      return ((await a.getContextIdentitiesOwned(contextId)) as { identities: string[] }).identities;
    },
    async joinContext(contextId) {
      await a.joinContext(contextId);
    },
    async contextGroup(contextId) {
      return ((await a.getContextGroup(contextId)) as string | null) ?? "";
    },
    async namespacesForApplication(applicationId) {
      return ((await a.listNamespacesForApplication(applicationId)) as Json[]).map((n) => String(n.namespaceId));
    },
    async namespaceGroups(namespaceId) {
      return groupIdsOf(await a.listNamespaceGroups(namespaceId));
    },
    async groupVisibility(groupId) {
      return String(((await a.getGroupInfo(groupId)) as Json).subgroupVisibility ?? "");
    },
    async setGroupOpen(groupId) {
      await a.setSubgroupVisibility(groupId, { subgroupVisibility: "open" });
    },
    async createNamespaceInvitation(namespaceId) {
      const res = (await a.createNamespaceInvitation(namespaceId)) as Json;
      return { invitation: res.invitation as never };
    },
    async listNamespaces() {
      return ((await a.listNamespaces()) as Json[]).map((n) => String(n.namespaceId));
    },
    async joinNamespace(namespaceId, invitation) {
      await a.joinNamespace(namespaceId, { invitation });
    },
    async joinSubgroupInheritance(groupId) {
      await a.joinSubgroupInheritance(groupId);
    },
    async syncGroup(groupId) {
      await a.syncGroup(groupId);
    },
    async groupContexts(groupId) {
      return contextsOf(await a.listGroupContexts(groupId));
    },
  };

  return {
    kind: "node",
    admin,
    ready: () => Promise.resolve(),
    exec: async <T>(contextId: string, method: string, args: Record<string, unknown>) =>
      decodeOutput(await mero.rpc.execute({ contextId, method, argsJson: args })) as T,
    openEvents(): EventStream {
      const events = mero.events;
      return {
        on: (event: "connect" | "event" | "error", handler: (arg: never) => void) => events.on(event, handler as never),
        connect: () => events.connect(),
        subscribe: (contextIds: string[]) => events.subscribe(contextIds),
        close: () => events.close(),
      } as EventStream;
    },
    // The contract's caller is the player's account on Calimero Cloud.
    resolveMyId: async () => mero.accountId().catch(() => null),
  };
}
