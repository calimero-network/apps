// The ACCOUNT transport: a Calimero account playing through its relay.
//
// Built on the mero-js account layer, in the order mero-react's MeroContext
// does it: read the delegated session → (learn + pin the relay's node key) →
// `buildDelegatedClient` → `createAccountAdmin` over that client's admin.
//   - contract calls: `client.rpc` — reads via the relay query route, writes
//     as `/intents` warrants signed by the device.
//   - admin: governance + creation warrants signed by the account for writes,
//     relay reads for the rest; node-only calls throw `NotForAccountError`.
//   - events: `client.events`, the relay's SSE on the account session.
//   - application id: the registry (`resolveApplicationIdFromRegistry`), never
//     `listApplications` — that is a node's view.
// Nothing here touches a node route or a bearer token.

import {
  buildDelegatedClient,
  CloudClient,
  createAccountAdmin,
  foundDelegatedNamespace,
  joinAsAccount,
  learnRelayNodeKey,
  listDelegatedContexts,
  readDelegatedSession,
  readPinnedRelayNodeKey,
  relayForContext,
  resolveApplicationIdFromRegistry,
  saveDelegatedSession,
  signerFromSecret,
  type AdminApiClient,
  type DelegatedAccountSession,
  type MeroClient,
  type SignedGroupOpenInvitation,
} from "@calimero-network/mero-js";
import { PACKAGE_NAME, REGISTRY_URL } from "./auth";
import type { SignedInvitation } from "./inviteCodec";
import { getSession } from "./session";
import type { AdminOps, ContextInfo, CreatedNamespace, EventStream, Transport } from "./transport";

/**
 * mero-js signs and verifies `inviter_signature` (snake_case, the node's
 * wire); the app's codec tolerates both spellings because older nodes echoed
 * `inviterSignature`. Normalise before handing an invitation to the account
 * layer, so an invite minted by a NODE still admits an ACCOUNT.
 */
export function toGroupInvitation(inv: SignedInvitation): SignedGroupOpenInvitation {
  return {
    invitation: inv.invitation,
    inviter_signature: inv.inviter_signature ?? inv.inviterSignature ?? "",
  } as unknown as SignedGroupOpenInvitation;
}

const noRelay = () =>
  new Error("your account has no relay to play through yet — join a friend's world with an invite first");

class AccountTransport implements Transport {
  readonly kind = "account" as const;
  readonly admin: AdminOps;
  private session: DelegatedAccountSession;
  private client: MeroClient | null = null;
  private api!: AdminApiClient;
  private builtFor: string | null = null;
  private pending: Promise<void> = Promise.resolve();

  constructor(session: DelegatedAccountSession) {
    this.session = session;
    this.admin = this.adminOps();
    this.rebuild();
  }

  /** The relay the current world lives on, else the session's. */
  private routedRelay(): string | null {
    const contextId = getSession().contextId;
    return (contextId ? relayForContext(this.session.account, contextId) : null) ?? this.session.relayUrl;
  }

  /**
   * (Re)build the client + admin for the routed relay. A relay whose node key
   * is not pinned yet is learned first (attestation; retried with backoff
   * while unreachable) and the client rebuilt with it — only then do admin
   * reads and the event stream carry a session the relay accepts. Writes
   * (intents) work either way, which is why the first client is built at once.
   */
  private rebuild(): void {
    const relayUrl = this.routedRelay();
    const routed: DelegatedAccountSession = { ...this.session, relayUrl };
    const make = () => {
      this.client = buildDelegatedClient(routed, null);
      this.api = createAccountAdmin(
        {
          session: routed,
          read: this.client?.admin ?? null,
          app: { packageName: PACKAGE_NAME, registryUrl: REGISTRY_URL },
        },
        {
          // `admin.joinNamespace` redeems for the account, relay or not: the join
          // is how it gets one, and the session moves onto the relay that admitted.
          join: (namespaceId, invitation) =>
            joinAsAccount(this.session, namespaceId, invitation, {
              onJoined: (next) => this.adopt(next),
            }),
          found: (s, req) => foundDelegatedNamespace(s, req),
          // Invitations are checked against the routing their claimants will use.
          routing: (namespaceId) =>
            new CloudClient({
              routingCredential: { credential: this.session.credential, deviceSecret: this.session.deviceSecret },
            }).getNamespaceRouting(namespaceId),
        },
      );
    };
    make();
    this.builtFor = relayUrl;
    this.pending =
      relayUrl && !readPinnedRelayNodeKey(relayUrl)
        ? learnRelayNodeKey(relayUrl).then((nodeKey) => {
            if (nodeKey && this.builtFor === relayUrl) make();
          })
        : Promise.resolve();
  }

  private adopt(next: DelegatedAccountSession): void {
    this.session = next;
    saveDelegatedSession(next);
    this.rebuild();
  }

  /** Resolves once the relay's node key is known (or refused) — admin reads and events need it. */
  ready(): Promise<void> {
    if (this.builtFor !== this.routedRelay()) this.rebuild();
    return this.pending;
  }

  private async relayAdmin(): Promise<AdminApiClient> {
    await this.ready();
    return this.api;
  }

  async exec<T = unknown>(contextId: string, method: string, args: Record<string, unknown>): Promise<T> {
    await this.ready();
    if (!this.client) throw noRelay();
    return this.client.rpc.execute<T>({ contextId, method, argsJson: args });
  }

  openEvents(): EventStream | null {
    return (this.client?.events as unknown as EventStream | undefined) ?? null;
  }

  /**
   * The contract keys player rows by `env::device_id()`, which under
   * delegation is the device cert's signing key — not the account (that is
   * what `admin.getNodeIdentity().accountId` and `identitiesOwned` answer, and
   * it would make every `p.id === myId` comparison false).
   */
  async resolveMyId(): Promise<string | null> {
    const signer = await signerFromSecret(this.session.deviceSecret, "deviceSecret");
    return signer.publicKey;
  }

  private adminOps(): AdminOps {
    return {
      resolveApplicationId: async () => {
        const { applicationId } = await resolveApplicationIdFromRegistry(REGISTRY_URL, PACKAGE_NAME);
        return applicationId;
      },
      listContexts: async (): Promise<ContextInfo[]> => {
        await this.ready();
        if (!this.session.relayUrl) return [];
        const contexts = await listDelegatedContexts(this.session);
        return contexts.map((c) => ({ contextId: c.id, applicationId: c.applicationId }));
      },
      createNamespace: async (applicationId, name): Promise<CreatedNamespace> => {
        const api = await this.relayAdmin();
        const created = (await api.createNamespace({ applicationId, name })) as {
          namespaceId: string;
          haEnabled?: boolean;
          haError?: string;
        };
        return { namespaceId: created.namespaceId, haEnabled: created.haEnabled, haError: created.haError };
      },
      createOpenGroup: async (namespaceId, name) => {
        const api = await this.relayAdmin();
        const { groupId } = await api.createGroupInNamespace(namespaceId, { groupName: name, visibility: "open" });
        return groupId;
      },
      createContext: async (applicationId, groupId, name, initializationParams) => {
        const api = await this.relayAdmin();
        const { contextId, memberPublicKey } = await api.createContext({
          applicationId,
          groupId,
          name,
          initializationParams,
        });
        return { contextId, memberPublicKey };
      },
      identitiesOwned: async (contextId) => {
        const api = await this.relayAdmin();
        return (await api.getContextIdentitiesOwned(contextId)).identities;
      },
      joinContext: async (contextId) => {
        const api = await this.relayAdmin();
        await api.joinContext(contextId);
      },
      contextGroup: async (contextId) => {
        const api = await this.relayAdmin();
        return String((await api.getContextGroup(contextId)) ?? "");
      },
      namespacesForApplication: async (applicationId) => {
        const api = await this.relayAdmin();
        return (await api.listNamespacesForApplication(applicationId)).map((ns) => ns.namespaceId);
      },
      namespaceGroups: async (namespaceId) => {
        const api = await this.relayAdmin();
        return (await api.listNamespaceGroups(namespaceId)).map((g) => g.groupId);
      },
      groupVisibility: async (groupId) => {
        const api = await this.relayAdmin();
        return String((await api.getGroupInfo(groupId)).subgroupVisibility ?? "").toLowerCase();
      },
      setGroupOpen: async (groupId) => {
        const api = await this.relayAdmin();
        await api.setSubgroupVisibility(groupId, { subgroupVisibility: "open" });
      },
      createNamespaceInvitation: async (namespaceId) => {
        const api = await this.relayAdmin();
        const res = (await api.createNamespaceInvitation(namespaceId)) as { invitation: SignedGroupOpenInvitation };
        return { invitation: res.invitation as unknown as SignedInvitation };
      },
      listNamespaces: async () => {
        const api = await this.relayAdmin();
        return (await api.listNamespaces()).map((ns) => ns.namespaceId);
      },
      joinNamespace: async (namespaceId, invitation, groupName) => {
        // Reachable with or without a relay (the account admin's join handler
        // runs the bootstrap); afterwards the session sits on the relay that
        // admitted, and its node key is awaited before anything reads from it.
        await this.api.joinNamespace(namespaceId, {
          invitation: toGroupInvitation(invitation),
          ...(groupName ? { groupName } : {}),
        });
        await this.ready();
      },
      joinSubgroupInheritance: async (groupId) => {
        const api = await this.relayAdmin();
        await api.joinSubgroupInheritance(groupId);
      },
      syncGroup: async (groupId) => {
        const api = await this.relayAdmin();
        await api.syncGroup(groupId);
      },
      groupContexts: async (groupId): Promise<ContextInfo[]> => {
        const api = await this.relayAdmin();
        return (await api.listGroupContexts(groupId)).map((e) => ({
          contextId: e.contextId,
          applicationId: "",
          name: e.name,
        }));
      },
    };
  }
}

export function createAccountTransport(): Transport {
  const session = readDelegatedSession();
  if (!session) {
    throw new Error("no account session in this tab — sign in with your Calimero account again");
  }
  return new AccountTransport(session);
}
