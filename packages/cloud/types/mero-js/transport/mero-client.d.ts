/**
 * One client, two transports — chosen once, at construction.
 *
 * # The problem this exists for
 *
 * An app that wants to move from "the user has a node" to "the user has a key
 * and a relay" had to rewrite itself, because the two write paths are different
 * objects with different method shapes. That makes the transport a property of
 * the *application source*, when it is really a property of the connection: the
 * same screen, the same hook, the same `execute` call wants to work either way.
 *
 * `createMeroClient` takes the decision at construction and nowhere else. After
 * that, `client.rpc.execute({ contextId, method, argsJson })` is the same call
 * against a node and against a relay — same arguments, same return type. The
 * node shape is the one both speak, because shipped apps already write it and
 * the alternative would be a breaking change wearing an abstraction's clothes.
 *
 * # Defaulting to the node is a compatibility guarantee
 *
 * `createMeroClient({ baseUrl })` is `createMeroJs({ baseUrl })` with a facade
 * in front. No `transport` field means `'node'`, so nothing an existing app
 * does can accidentally select the relay.
 *
 * # Events work on both transports, given one input
 *
 * A relay is an ordinary node, so it serves `/sse` and `/ws` to a credential it
 * issued, and a keyholder can obtain one by logging in with its account proof.
 * `client.events` and `client.ws` are therefore the same call on both
 * transports — provided the caller supplies the relay node's device signing
 * key, which must be learned out of band and is the one thing that cannot be
 * inferred. See `./relay-observer.ts` for why, and mdma #312 for the hosted
 * case. Without it, {@link MeroClient.canSubscribe} is `false` and the
 * accessors throw naming exactly that.
 *
 * # What is deliberately NOT unified
 *
 * Reads and admin. A relay serves exactly two routes to a caller with no
 * credential — `GET` and `POST /admin-api/contexts/:id/intents` — and while a
 * session obtained by logging in carries `context:query`, `sdk.admin` wants
 * `admin`, which the `account_proof` provider does not grant and a keyholder
 * should never ask for.
 *
 * So those accessors throw on a relay client, with a message naming what is
 * missing, rather than returning something that quietly connects somewhere
 * else. Falling back to "some node" would be the worst of the options: the app
 * would observe a node it never chose, under a credential it never granted, and
 * find out only when the two disagreed. `canSubscribe` and `transport` are
 * there so an app can branch *before* touching any of it.
 */
import { MeroJs } from '../mero-js.js';
import type { MeroJsConfig } from '../mero-js.js';
import { RelayClient } from '../relay/relay-client.js';
import type { RelayClientConfig } from '../relay/relay-client.js';
import type { RelayObserveConfig } from './relay-observer.js';
import type { ExecuteTransport, TransportKind } from './types.js';
import type { AdminApiClient } from '../admin-api/index.js';
import type { ProofCredential } from '../request-proof/index.js';
import { SseClient } from '../events/sse.js';
import type { AuthApiClient } from '../auth-api/index.js';
import type { WsClient } from '../events/ws.js';
import type { EphemeralClient } from '../ephemeral/index.js';
import { RelayPresenceClient } from '../presence/relay-presence.js';
import type { CloudClient } from '../cloud/cloud-client.js';
/** The node transport: everything `createMeroJs` takes, plus an explicit opt-in. */
export interface NodeTransportConfig extends MeroJsConfig {
    /**
     * Optional, and the default. Spelled out so a config object can be built
     * generically without the node case looking like an omission.
     */
    transport?: 'node';
}
/** The relay transport: delegated execution, no node and no node credential. */
export interface RelayTransportConfig {
    transport: 'relay';
    /**
     * The relay to write through — a configured {@link RelayClient}, or the
     * config to build one from.
     *
     * An already-built client is accepted because the useful ones are not built
     * by hand: `connectCloud` discovers the relay URL and executor account from a
     * cloud sign-in and hands back a ready client. Requiring the config here
     * would have that caller take the client apart to put it back together.
     */
    relay: RelayClient | RelayClientConfig;
    /**
     * Fetch for everything this client sends the relay: intents (unless `relay`
     * names its own), admin reads, the observing login and events. Typically a
     * sealed fetch (`createAttestedSealedFetch`), so none of it can be read where
     * TLS ends. Defaults to global `fetch`.
     */
    fetch?: typeof fetch;
    /**
     * A session on the relay, if this client has one.
     *
     * The delegated path has **two** credentials, not one. A warrant authorises a
     * single intent and is what `execute` sends; a session — minted by
     * `account_proof` from the same device key, see `login()` — is what the
     * caller-scoped admin READS are authenticated by (`context:list-own`,
     * `namespace:list-own`). They are independent: a client with only warrants
     * writes but cannot list, which is what `admin` throwing used to describe.
     *
     * Supply a token, or a function returning the current one so a refreshed
     * session is picked up without rebuilding the client.
     */
    session?: string | (() => Promise<string | undefined>);
    /**
     * How this client observes the relay node, if it can.
     *
     * Omit it — or pass it with no `nodeKey` — and the client writes but does not
     * observe: `canSubscribe` is `false` and `events`/`ws` throw naming the
     * missing key. Supply `{ nodeKey }` and `client.events` is the very same
     * `SseClient` a node client hands out.
     *
     * The shape takes a nullable key on purpose, so the hosted path is one code
     * path rather than two: `connectCloud` always passes this object, with
     * whatever key the cloud reported, and starts working the day mdma #312
     * publishes one. Nothing here ever fills the key in.
     */
    observe?: RelayObserveConfig;
    /**
     * The device cert this client authenticates its own requests with.
     *
     * This is the shortest path to everything but writes, and it needs no session
     * and no node key. The device key signs each request — `X-Calimero-Proof` —
     * and the node verifies the signature against the certificate the account
     * signed, with no store read and no prior relationship. Measured against a
     * node built from core `aecba573b`: the caller-scoped reads answer `200`,
     * `/sse` answers `200`, and a `/ws` upgrade completes `101`.
     *
     * Supplying this makes {@link MeroClient.admin} and {@link MeroClient.events}
     * available and {@link MeroClient.canSubscribe} true, with no `session` and no
     * `observe.nodeKey`. Those two remain for the case they were built for: a
     * device key behind a boundary worth crossing once, where a per-session
     * signature beats a per-request one.
     */
    proof?: ProofCredential;
}
export type MeroClientConfig = NodeTransportConfig | RelayTransportConfig;
/**
 * A connection whose transport was decided at construction.
 *
 * Everything reachable on a node client is reachable in exactly the shape
 * `MeroJs` exposes it, by delegation rather than re-implementation — this adds
 * no behaviour to the node path and cannot drift from it.
 */
export declare class MeroClient {
    /** Which path writes take. Set once, never changes. */
    readonly transport: TransportKind;
    private readonly nodeClient;
    private readonly rpcTransport;
    /** The relay's event session, or `null` on a node client / with no node key. */
    private readonly relayObserver;
    /** Admin reads against the relay, when a session or a proof was supplied. */
    private readonly relayAdmin;
    /**
     * Events off the relay authenticated by a request proof, built lazily.
     *
     * Separate from {@link relayObserver} rather than a mode inside it: the
     * observer's whole subject is a session addressed to a node key, and a proof
     * has neither. Holding the authorizer instead of the client keeps construction
     * free of the first signature.
     */
    private readonly proofAuthorizer;
    private readonly relayUrl;
    private proofEvents;
    /** The relay transport's `fetch`, if one was given. */
    private readonly relayFetch;
    private relayPresence;
    constructor(config: MeroClientConfig);
    /**
     * The write surface. Identical on both transports — this is the whole point.
     *
     * On a node this IS the `RpcClient` a `MeroJs` would have handed out, not a
     * wrapper around it, so `client.rpc` and `client.node.rpc` are the same
     * object.
     */
    get rpc(): ExecuteTransport;
    /**
     * Whether `events` / `ws` will work on this client.
     *
     * Always `true` on the node transport. On the relay transport it says whether
     * a node key was supplied — the relay can be observed, but only by a caller
     * who can name the key the login statement is signed against.
     */
    get canSubscribe(): boolean;
    /** The underlying `MeroJs`. Node transport only. */
    get node(): MeroJs;
    /** The underlying `RelayClient`, for `describe()`. Relay transport only. */
    get relay(): RelayClient;
    /**
     * Admin API. Node transport only.
     *
     * Two different things live behind this accessor today, and only one of them
     * is genuinely unavailable through a relay.
     *
     * The **mutations** — `createNamespace`, `setMemberCapabilities`,
     * `upgradeGroup` and the rest — are operator actions on somebody else's
     * machine. A keyholder does not get those, and should not; admin is for
     * admins.
     *
     * The **reads** are a different matter. `getContext`, `getContexts`,
     * `getApplication`, `listNamespaces`, `getBlob` are an app asking what it is
     * looking at, not an operator administering anything. They sit under
     * `/admin-api/` for historical reasons, and a delegated session is refused
     * them (measured: `403`, while the same session reads context state through
     * `POST /contexts/{ctx}/query` and writes through `/intents` quite happily).
     *
     * So this is the one place where "the same code runs on both transports"
     * does not hold yet, and it is a missing surface rather than a missing
     * permission. A transport-independent read API is designed but not built; the
     * throw below is deliberate until it exists, because the alternative — quietly
     * reaching for a node the caller did not choose — is worse than a clear stop.
     */
    /**
     * The admin surface.
     *
     * On a node client this is the node's own. On a relay client it exists only
     * when a `session` was supplied, and it is **the relay's admin API
     * authenticated as the account** — so the caller-scoped reads answer:
     * `getContexts` and `listNamespaces` return this account's own, because
     * `account_proof` grants `context:list-own` and `namespace:list-own`.
     *
     * Mutations are not filtered out here, deliberately. A delegated session does
     * not carry the grants they require, so the node refuses them with a `403`
     * that names the missing permission — which is a better answer than a
     * client-side guess, and keeps the policy in the one place that owns it.
     */
    get admin(): AdminApiClient;
    /** Auth API. Node transport only — a relay issues no node credential. */
    get auth(): AuthApiClient;
    /**
     * SSE events — on **both** transports.
     *
     * On a relay client this is an `SseClient` against the relay node, fed by a
     * session minted with the author's account proof. The session is minted
     * lazily, on the first token the stream asks for, so reading this getter
     * performs no network call.
     *
     * Throws only when the relay client was given no node key: the one input
     * that cannot be inferred. See {@link missingNodeKey}.
     */
    get events(): SseClient;
    /** WebSocket events, on both transports. @experimental — prefer `events`. */
    get ws(): WsClient;
    /**
     * Ephemeral presence. Node transport only.
     *
     * On a relay client this is an account's presence client
     * ({@link RelayPresenceClient}): `set` signs each update with the device key
     * and posts it to the relay's `presence-intents`, resending every 2.5 s, and
     * `subscribe` reads the relay's event stream. The relay checks and forwards
     * the update; other members verify the device's signature and certificate
     * themselves, so it can drop or delay an account's presence but not invent or
     * alter it. Only `subscribe` needs the relay's node key (for the event
     * stream), so publishing works on any relay client.
     */
    get ephemeral(): EphemeralClient | RelayPresenceClient;
    /**
     * Calimero Cloud.
     *
     * Available on both transports, because it is neither: the cloud session is
     * independent of the node credential and of the relay's signing key, and a
     * relay-transport app still needs it to list namespaces and manage billing.
     */
    get cloud(): CloudClient;
    /**
     * Release whatever the transport is holding.
     *
     * Safe on a relay client, where there is nothing open to close — a caller
     * that tears down on unmount should not have to know which transport it got.
     */
    close(): void;
}
/**
 * Build a client for the chosen transport. Node unless told otherwise.
 *
 * ```ts
 * // unchanged, and still the default
 * const client = createMeroClient({ baseUrl: 'http://localhost:2428' });
 *
 * // the same call sites, through a relay
 * const client = createMeroClient({
 *   transport: 'relay',
 *   relay: connection.relay,
 *   // the relay node's signing key, learned out of band — without it the
 *   // client writes but does not observe
 *   observe: { nodeKey },
 * });
 *
 * await client.rpc.execute({ contextId, method: 'set', argsJson: { key, value } });
 * if (client.canSubscribe) client.events.on('event', onEvent);
 * ```
 */
export declare function createMeroClient(config: MeroClientConfig): MeroClient;
