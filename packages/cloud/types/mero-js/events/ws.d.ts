import type { GroupMembershipEventData, GroupMigrationEventData } from './group.js';
export type { GroupMembershipEventData, GroupMigrationEventData };
export interface WsEventData {
    contextId: string;
    /** The context-event discriminator (core serializes it as a sibling of
     * `data`, e.g. `"AppVersionChanged"`). Undefined for events without a tag. */
    type?: string;
    data: unknown;
}
/** Anything the `'event'` stream can deliver: context events plus the
 * group-keyed membership and migration families. */
type WsEvent = WsEventData | GroupMembershipEventData | GroupMigrationEventData;
type WsEventHandler = (event: WsEvent) => void;
type WsConnectHandler = () => void;
type WsErrorHandler = (error: Error) => void;
/**
 * @experimental WebSocket event client. The SSE client (`SseClient`) is the
 * recommended transport for production — use `MeroJs.events` instead of `MeroJs.ws`.
 */
export declare class WsClient {
    private baseUrl;
    private getAuthToken;
    private ws;
    private closed;
    private reconnectAttempt;
    private reconnectTimer;
    private subscribedContextIds;
    private subscribedGroupIds;
    private listeners;
    private static readonly MAX_BACKOFF_MS;
    constructor(opts: {
        baseUrl: string;
        getAuthToken: () => Promise<string>;
    });
    on(event: 'connect', handler: WsConnectHandler): void;
    on(event: 'event', handler: WsEventHandler): void;
    on(event: 'error', handler: WsErrorHandler): void;
    off(event: 'connect', handler: WsConnectHandler): void;
    off(event: 'event', handler: WsEventHandler): void;
    off(event: 'error', handler: WsErrorHandler): void;
    private emit;
    connect(): Promise<void>;
    private handleMessage;
    subscribe(idsOrOpts: string[] | {
        contextIds?: string[];
        groupIds?: string[];
    }): void;
    unsubscribe(idsOrOpts: string[] | {
        contextIds?: string[];
        groupIds?: string[];
    }): void;
    private resubscribeAfterReconnect;
    private buildSubscriptionParams;
    private sendMessage;
    private scheduleReconnect;
    close(): void;
}
