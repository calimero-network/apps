import type { GroupMembershipEventData, GroupMigrationEventData } from './group.js';
/** How long a subscription POST may take before it counts as failed. */
export declare const SUBSCRIPTION_TIMEOUT_MS = 10000;
export type { GroupMembershipEventData, GroupMigrationEventData };
export interface SseEventData {
    contextId: string;
    /** The context-event discriminator (core serializes it as a sibling of
     * `data`, e.g. `"AppVersionChanged"`). Undefined for events without a tag. */
    type?: string;
    data: unknown;
}
/** Parsed `AppVersionChanged` context event (bundle-version flip; skew #2). */
export interface AppVersionChangedEvent {
    contextId: string;
    fromVersion?: string;
    toVersion?: string;
}
/** Anything the `'event'` stream can deliver: context events plus the
 * group-keyed membership and migration families. */
type SseEvent = SseEventData | GroupMembershipEventData | GroupMigrationEventData;
type SseEventHandler = (event: SseEvent) => void;
type SseConnectHandler = (sessionId: string) => void;
type SseErrorHandler = (error: Error) => void;
/**
 * How one request to the SSE endpoints is authenticated.
 *
 * A bearer token is one value reused across requests; a request proof commits to
 * the method, the path and the body, so it must be produced per request. Both
 * reduce to the same thing from this client's point of view — headers — so the
 * stream takes the general form and {@link SseClient} adapts `getAuthToken` to it.
 */
export type SseAuthorizer = (request: {
    method: string;
    path: string;
    body?: string;
}) => Promise<Record<string, string>>;
export declare class SseClient {
    private baseUrl;
    private authorize;
    private reconnectDelayMs;
    private sessionId;
    private abortController;
    private reconnectTimer;
    private subscribedContextIds;
    private subscribedGroupIds;
    /**
     * The current presence of each subscribed context, as the node's replay and
     * its live deltas left it: author → that author's last `Ephemeral` data and
     * when it arrived. The node replays a context's presence once, when the
     * context is first subscribed on this connection, so a presence listener
     * that comes later would never see it; {@link presenceSeed} gives it this.
     */
    private presence;
    private closed;
    private listeners;
    private fetchImpl;
    constructor(opts: {
        baseUrl: string;
        /** A bearer token provider. The historical form, and still the default. */
        getAuthToken?: () => Promise<string>;
        /**
         * Per-request authorization, for a credential that commits to the request —
         * a device cert signing a request proof. Takes precedence over
         * `getAuthToken`; one of the two is required.
         */
        authorize?: SseAuthorizer;
        reconnectDelayMs?: number;
        fetch?: typeof fetch;
    });
    on(event: 'connect', handler: SseConnectHandler): void;
    on(event: 'event', handler: SseEventHandler): void;
    on(event: 'error', handler: SseErrorHandler): void;
    off(event: 'connect', handler: SseConnectHandler): void;
    off(event: 'event', handler: SseEventHandler): void;
    off(event: 'error', handler: SseErrorHandler): void;
    /**
     * Typed convenience over the generic `'event'` stream: invokes `handler` only
     * for `AppVersionChanged` context events, with the payload already parsed.
     * Returns an unsubscribe closure (so callers need not retain the listener).
     */
    onAppVersionChanged(handler: (e: AppVersionChangedEvent) => void): () => void;
    /**
     * Typed convenience over the generic `'event'` stream: invokes `handler` only
     * for group-migration events, narrowed on `type` so `data` is the matching
     * payload. Returns an unsubscribe closure.
     *
     * A non-admin subscriber sees `MigrationStarted`, `MigrationProgress` and
     * `MigrationCompleted` but never `CascadeProgress`, which core delivers to
     * namespace admins only.
     */
    onMigrationEvent(handler: (e: GroupMigrationEventData) => void): () => void;
    private emit;
    connect(): Promise<void>;
    /**
     * Whether `controller`'s connection is no longer the one this client holds:
     * closed, or replaced by a later connect. Its abort lands asynchronously,
     * after a `close()` + `connect()` has already cleared `closed`, so `closed`
     * alone cannot tell; reporting it, and reconnecting for it, would abort the
     * live connection, whose own abort would do the same, without end.
     */
    private superseded;
    private readStream;
    private handleMessage;
    subscribe(idsOrOpts: string[] | {
        contextIds?: string[];
        groupIds?: string[];
    }): Promise<void>;
    /** Whether this connection holds `contextId`'s events. */
    isSubscribed(contextId: string): boolean;
    /**
     * The presence currently known for `contextId`, as `Ephemeral` event data,
     * each entry's `ageMs` advanced by how long ago it arrived. Empty for a
     * context this connection does not hold.
     */
    presenceSeed(contextId: string): Array<Record<string, unknown>>;
    private notePresence;
    unsubscribe(idsOrOpts: string[] | {
        contextIds?: string[];
        groupIds?: string[];
    }): Promise<void>;
    private sendSubscription;
    /** Sends one subscription change and returns why it failed, or `null`. */
    private postSubscription;
    private forceReconnect;
    private scheduleReconnect;
    close(): void;
}
