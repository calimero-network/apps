import * as react_jsx_runtime from 'react/jsx-runtime';
import * as React from 'react';
import React__default, { CSSProperties, ReactNode } from 'react';
import * as _calimero_network_mero_js from './mero-js/index.js';
import { MeroJs, MeroClient, DelegatedAccountSession, TokenStore, DelegatedCredential, BootstrapResult, SignedGroupOpenInvitation, InviteFailureReason, InviteRedeemer, RedeemOutcome, BootstrapFailure, SetMetadataRequest, SseEventData, GroupMembershipEventData, GroupMigrationEventData, Codec, AddGroupMembersRequest, GetBlobInfoResponseData, CreateContextRequest, CreateGroupInNamespaceRequest, CreateNamespaceRequest, CreateNamespaceInvitationRequest, CreateNamespaceInvitationResponseData, CreateRecursiveInvitationResponseData, GroupUpgradeStatusResponseData, GroupContextEntry, GroupInfo, CreateGroupInvitationRequest, MetadataRecord, ClassifiedError, JoinGroupRequest, JoinNamespaceRequest, MigrationStatus, MigrationStatusRollup, MemberMigrationStatusEntry, MigrateMyEntriesSummary, Namespace, SubgroupEntry, NodeIdentity, RemoveGroupMembersRequest, ReparentGroupRequest, ResyncContextRequest, SetDefaultCapabilitiesRequest, SetSubgroupVisibilityRequest, SetTeeAdmissionPolicyRequest, UpdateMemberRoleRequest, UpgradeGroupRequest, UploadBlobRequest, TokenData } from './mero-js/index.js';
export * from './mero-js/index.js';
export { AccountAdminDeps, BootstrapFailure, BootstrapFromInvitationInput, BootstrapResult, BootstrapStep, BootstrapSuccess, CAPABILITIES, Codec, DEFAULT_LOCAL_NODE_PORTS, DelegatedCredential, DelegatedAccountSession as DelegatedSession, DiscoverLocalNodesOptions, EphemeralClient, EphemeralEntry, FoundedDelegatedNamespace, HA_ACCOUNT_NOT_LINKED_MESSAGE, HA_REFUSAL_MESSAGES, InvitationNotClaimableError, JoinWithNodeFailure, JoinWithNodeInput, JoinWithNodeResult, JoinWithNodeStep, JoinWithNodeSuccess, MetadataRecord, NoRelayError, NotForAccountError, RegistryBundle, RelayResolutionFailure, RelayResolutionStep, ResolveRelayFromInvitationInput, ResolveRelayResult, ResolvedApplication, ResolvedInvitationRelay, applicationIdForBundle, bootstrapFromInvitation, clearDelegatedCredential, createAccountAdmin, createDelegatedContext, createNodeAdmin, discoverLocalNodes, hasCap, joinWithNode, listDelegatedContexts, localNodeUrl, nodeEndpoint, normaliseAccount, pinRelayNodeKey, probeNodeHealth, readDelegatedCredential, readPinnedRelayNodeKey, readRelayMap, relayForContext, rememberRelay, resolveApplicationIdFromRegistry, resolveRelayFromInvitation, saveDelegatedCredential, selectLatestBundle, withCap, withoutCap } from './mero-js/index.js';

/**
 * Application mode determines the permission scope
 */
declare enum AppMode {
    /**
     * @deprecated since 2.1.0 — SingleContext is no longer supported and will
     * be removed in 3.0.0. Auth-frontend no longer drives
     * context/namespace/group selection; the auth callback returns only
     * `access_token`, `refresh_token`, `application_id`, and `node_url`.
     * Switch to {@link AppMode.MultiContext} and have your app manage
     * context selection itself.
     *
     * Migration: see `example/app/src/pages/context/SelectContext.tsx` for a
     * reference implementation. It uses `useContexts` /
     * `useNamespacesForApplication` for listing, then calls
     * `mero.admin.createNamespace` / `createGroupInNamespace` /
     * `createContext` directly (rather than the `useCreate*` hooks) so the
     * underlying server error surfaces to the user instead of being
     * swallowed by `useAsyncMutation`.
     */
    SingleContext = "single-context",
    /** Multi-context: user can manage multiple contexts */
    MultiContext = "multi-context",
    /** Admin: full administrative access */
    Admin = "admin"
}
/**
 * Connection type for the login modal
 */
declare enum ConnectionType {
    /**
     * @deprecated The login modal no longer has Local/Remote tabs — it always
     * shows node discovery + manual URL entry. Behaves the same as `Remote`.
     */
    RemoteAndLocal = "remote-and-local",
    /** Open the login modal (node discovery + manual URL entry) */
    Remote = "remote",
    /**
     * @deprecated The hardcoded default-local-node view was removed. Behaves
     * the same as `Remote`.
     */
    Local = "local",
    /** Custom URL (skip modal) */
    Custom = "custom"
}
/**
 * Custom connection configuration
 */
interface CustomConnectionConfig {
    type: ConnectionType.Custom;
    url: string;
}
/**
 * Context for an application
 */
interface AppContext {
    contextId: string;
    executorId: string;
    applicationId: string;
}
/**
 * Result of an RPC execution
 */
interface ExecutionResult<T = unknown> {
    success: boolean;
    result?: T;
    error?: string;
}
interface ApplicationContextRecord {
    contextId: string;
    applicationId: string;
}
interface ContextDiscoveryOptions {
    applicationId: string;
    knownContextIds?: string[];
    targetAlias?: string;
    pollIntervalMs?: number;
    timeoutMs?: number;
}
interface ContextDiscoveryState {
    context: ApplicationContextRecord | null;
    loading: boolean;
    error: Error | null;
    discover: () => Promise<ApplicationContextRecord | null>;
    reset: () => void;
}
/**
 * Mero context value exposed by useMero hook
 */
interface MeroContextValue {
    /**
     * The connected client, or null.
     *
     * Two shapes, because there are two ways to connect: a node login yields a
     * `MeroJs`, an account + relay connection yields a relay-transport
     * `MeroClient`. Both expose `rpc` as an `ExecuteTransport`, which is what a
     * generated ABI client depends on — so application logic is identical across
     * the two and needs no branch.
     *
     * The union is deliberately not flattened behind a cast. A relay client has
     * no `admin`, so code reaching for one should not typecheck as though it
     * were there; narrow with {@link MeroContextValue.isDelegated} first.
     */
    mero: MeroJs | MeroClient | null;
    /** Whether the user is authenticated */
    isAuthenticated: boolean;
    /** Whether the connection is online */
    isOnline: boolean;
    /** The current node URL */
    nodeUrl: string | null;
    /** The application ID */
    applicationId: string | null;
    /** The context ID (from auth flow) */
    contextId: string | null;
    /** The context identity / executor public key (from auth flow) */
    contextIdentity: string | null;
    /** Connect to a node URL and start auth flow */
    connectToNode: (url: string) => void;
    /**
     * Adopt a delegated connection: an account, a device that account certified,
     * and a relay that writes on its behalf.
     *
     * Installs the relay client immediately — there is no redirect and no token to
     * wait for, because every request carries its own warrant.
     */
    connectWithAccount: (session: DelegatedAccountSession) => void;
    /**
     * Whether the connection is delegated (account + relay) rather than a node
     * login. True means `mero` is a relay-transport client, authenticated by the
     * account's device certificate: `rpc` writes under warrants, and `admin` and
     * `events` answer caller-scoped — this account's own contexts and namespaces,
     * and events only for contexts it is a member of.
     */
    isDelegated: boolean;
    /** True when the node serves this page from the app's own origin (see `MeroProviderConfig.servedByNode`). */
    servedByNode?: boolean;
    /**
     * What this connection may do, so an app asks WHAT IS ALLOWED instead of
     * which transport it runs on. A node login can do everything; an account on
     * a relay can create contexts (delegated creation) but not namespaces or
     * invitations — those are a node's own operations today. A capability that
     * later becomes available to accounts turns true here with no app change.
     */
    can: MeroCapabilities;
    /**
     * The admin API to write against, whatever the session: the node's own admin
     * client on a node, the account admin (`createAccountAdmin`) on an account.
     * `null` until connected.
     */
    admin: _calimero_network_mero_js.AdminApiClient | null;
    /**
     * The app's registry identity, as the provider was given it. An account
     * founding a namespace names this application for it, since a namespace
     * founded through a relay starts with none.
     */
    app: {
        packageName?: string;
        packageVersion?: string;
        registryUrl?: string;
    };
    /** The cloud an account asks for routing; the hosted one when unset. */
    cloudBaseUrl?: string;
    /** Logout and clear tokens */
    logout: () => void;
    /** Loading state */
    isLoading: boolean;
}
/**
 * MeroProvider configuration
 */
interface MeroProviderConfig {
    /** release-v2, development clusters only: the app's raw WASM, uploaded when no package is named (default `${BASE_URL}app.wasm`). */
    bundleUrl?: string;
    /** Application mode */
    mode: AppMode;
    /** Package name (for registry-based apps) */
    packageName?: string;
    /** Package version (optional, defaults to latest) */
    packageVersion?: string;
    /** Registry URL (optional) */
    registryUrl?: string;
    /**
     * The cloud an account asks which relay serves a namespace or an account.
     * Unset is the hosted cloud, which is right for every deployed app; this is
     * for a local or staging setup whose namespaces the hosted cloud never saw.
     */
    cloudBaseUrl?: string;
    /** Request timeout in milliseconds */
    timeoutMs?: number;
    /**
     * Origins the OAuth callback is allowed to authenticate against. Defends
     * against a malicious `node_url` in the callback URL (token exfiltration):
     * the node login was initiated with is always trusted, and this allowlist
     * additionally permits direct-callback entry to known nodes. When neither is
     * available (no initiated node and no allowlist) a callback node_url is
     * rejected and a security error is logged.
     */
    allowedNodeUrls?: string[];
    /**
     * Set when a node serves this page from the app's own origin
     * (`{label}.localhost:2428`). The node is then `window.location.origin`: the
     * client talks to it there whatever the callback's `node_url` says, and
     * `ConnectButton` skips the node dialog and goes straight to login.
     */
    servedByNode?: boolean;
    /**
     * Token store for access/refresh tokens. Defaults to a localStorage-backed
     * store that persists across reloads.
     *
     * SECURITY: localStorage tokens — including the refresh token — are readable
     * by any script on the page, so an XSS bug can exfiltrate them. For sensitive
     * deployments pass a `MemoryTokenStore` (session-only) or a store backed by an
     * HttpOnly cookie set by your auth service.
     */
    tokenStore?: TokenStore;
}
/** See {@link MeroContextValue.can}. */
interface MeroCapabilities {
    /** Found a namespace. */
    readonly createNamespace: boolean;
    /** Create a context inside a namespace this connection belongs to. */
    readonly createContext: boolean;
    /** Mint an invitation to a namespace. */
    readonly invite: boolean;
    /** Upgrade a group's application. A node's only: a relay carries just the first choice. */
    readonly upgrade: boolean;
}

declare const MeroContext: React__default.Context<MeroContextValue | null>;
/**
 * Permission grants requested for the client token at login.
 *
 * Cores since 0.11.0-rc.9 default-deny admin-api routes the token holds no
 * scope for; cores >=0.11.0-rc.11 map the governance/blob/alias routes to the
 * client-grantable `namespace` / `group` / `blob` / `context:alias`
 * permissions, so app tokens must request them here or every workspace,
 * group, blob and context-alias call 403s.
 *
 * `context:list` is included even in single-context mode because every app
 * calls GET /admin-api/contexts/:id/identities-owned right after login, which
 * maps to a `context:list` requirement.
 *
 * `context:subscribe` is what `/sse`, `/sse/subscription` and `/ws` require
 * (core's `PermissionValidator`, `validator.rs`, maps all three to
 * `Context(Subscribe(Global))`). Without it every event stream an app opens is
 * refused `403` + `X-Auth-Error: permission_denied`, so the app renders, reads
 * and writes, and simply never receives a live update. Only `AppMode.Admin`
 * escaped, because `admin` covers every route.
 *
 * MEASURED against merod 0.11.0-rc.41 (build 88e323b): a client key minted with
 * the MultiContext list below minus `context:subscribe` gets `403` on
 * `GET /sse`; the same list with it gets `200`.
 *
 * `context:delete` is what `DELETE /admin-api/contexts/:id` requires
 * (`validator.rs`). An app that may create contexts may delete them, so
 * `useDeleteContext` works on a node instead of answering 403.
 *
 * Public: whatever mints a token for a mero-react app on its behalf (the
 * desktop's per-app key, admin-dashboard's, auth-frontend's allowlist) should
 * test against this rather than a hand copy. Three copies went without
 * `context:delete` and every app's context delete answered 403.
 */
declare function getPermissionsForMode(mode: AppMode): string[];
interface MeroProviderProps extends MeroProviderConfig {
    children: React__default.ReactNode;
}
declare function MeroProvider({ children, mode, packageName, packageVersion, registryUrl, cloudBaseUrl, timeoutMs, allowedNodeUrls, servedByNode, tokenStore: tokenStoreProp, }: MeroProviderProps): react_jsx_runtime.JSX.Element;
declare function useMero(): MeroContextValue;

/**
 * Theme tokens for mero-react components.
 *
 * Defaults match the green palette used across Calimero apps (admin-dashboard,
 * tauri-app, app-registry). Pass a partial `MeroTheme` to `ConnectButton` or
 * `LoginModal` to override any token.
 */

interface MeroTheme {
    /** Primary accent / CTA color */
    primary?: string;
    /** Primary accent on hover */
    primaryHover?: string;
    /** Text color rendered on top of `primary` (e.g. inside the Connect button when connected) */
    primaryText?: string;
    /** Main surface color (modal background, button background) */
    background?: string;
    /** Secondary surface color (input fields, info chips) */
    backgroundSecondary?: string;
    /** Tertiary surface color (subtle elevation) */
    backgroundTertiary?: string;
    /** Border color */
    border?: string;
    /** Primary text color */
    text?: string;
    /** Muted / secondary text color */
    textSecondary?: string;
    /** Error / danger color */
    error?: string;
    /** Modal backdrop color */
    overlay?: string;
    /** Border radius (any CSS length) */
    radius?: string;
}
type ResolvedMeroTheme = Required<MeroTheme>;
declare const defaultMeroTheme: Readonly<ResolvedMeroTheme>;
/**
 * Merge a partial theme with the defaults.
 *
 * Filtering rules — values that fall back to the default:
 *   - `undefined` (the prop key wasn't set, or was set to `undefined`)
 *   - empty string `''`
 *   - whitespace-only strings (e.g. `'   '`)
 *
 * These are dropped because they're invalid CSS and would produce
 * invisible elements (transparent backgrounds, missing borders, etc.).
 * If you genuinely want the browser default for a token, omit the key
 * from the theme prop rather than passing an empty string.
 *
 * Any other non-empty string is forwarded as-is — CSS syntax itself
 * is NOT validated.
 */
declare function resolveMeroTheme(theme?: MeroTheme): ResolvedMeroTheme;
/**
 * Single source of truth mapping each `MeroTheme` token name to the CSS
 * custom-property name it surfaces as. Used by `themeToCssVars` to emit the
 * inline-style map and by component code (e.g. `LoginModal`) to read the
 * variable in inline styles via `var(--mero-*, fallback)`.
 *
 * Adding a new token? Add it here, in `MeroTheme`, and in `defaultMeroTheme`,
 * and the rest of the system picks it up automatically.
 */
declare const MERO_CSS_VARS: Record<keyof MeroTheme, string>;
/**
 * Build a `style` object that exposes a resolved theme as CSS variables, so
 * descendant CSS rules (e.g. those in `styles.css`) pick up the overrides.
 */
declare function themeToCssVars(theme: ResolvedMeroTheme): CSSProperties;
/**
 * Returns a `var(--mero-*, fallback)` reference for a theme token, suitable
 * for inline styles in portal-rendered components where descendant CSS
 * variables also need to support global `:root` overrides.
 */
declare function cssVar(theme: ResolvedMeroTheme, key: keyof MeroTheme): string;

interface ConnectButtonProps {
    /**
     * Connection behaviour. `Custom` (object form) connects straight to the
     * given URL, skipping the modal; every other value opens the LoginModal
     * (local node discovery + manual URL entry). A page the node serves
     * (`servedByNode`) skips the modal and logs in at its own origin.
     */
    connectionType?: ConnectionType | CustomConnectionConfig;
    /** Custom class name */
    className?: string;
    /** Custom styles */
    style?: React__default.CSSProperties;
    /** Theme overrides — accepts any subset of `MeroTheme` tokens */
    theme?: MeroTheme;
    /**
     * Render only the Calimero logo, no text. Produces a square 40×40 icon
     * button. The label is still announced to screen readers via `aria-label`.
     * Default: false.
     */
    logoOnly?: boolean;
    /**
     * Override the default labels per state. A bare string is shorthand for
     * `{ connect: '<string>' }`. The connected and reconnecting states keep
     * their defaults unless explicitly overridden.
     */
    label?: string | {
        connect?: string;
        connected?: string;
        reconnecting?: string;
    };
    /**
     * Offer the **Cloud** tab — sign in with a Calimero account — next to the
     * node dialog. Default true in a browser, false inside a Calimero Desktop
     * window (already bound to the desktop's node; see `isDesktopWindow`). With
     * false the modal has no tabs, and this button reads no enrolment callback,
     * leaving it to whichever component does.
     */
    cloud?: boolean;
    /**
     * Overrides for the account path, for local development only.
     */
    accountDefaults?: {
        /**
         * Point enrolment at a wallet other than the hosted one — for working ON
         * the wallet, e.g. one served from `localhost:8090`.
         */
        walletUrl?: string;
    };
}
/**
 * ConnectButton - Displays connection status and handles login/logout
 */
declare function ConnectButton({ connectionType, className, style, theme, logoOnly, label, cloud: cloudProp, accountDefaults, }: ConnectButtonProps): react_jsx_runtime.JSX.Element;

interface ConnectButtonAccountProps {
    className?: string;
    style?: React__default.CSSProperties;
    theme?: MeroTheme;
    /**
     * Overrides for local development. An app in production passes none of this,
     * and the pane asks the person for nothing at all.
     *
     * Nothing here is a value an end user could know, which is precisely why none
     * of it is a form field any more:
     *
     * - the **relay** is discovered — the certificate the enrolment returns proves
     *   the cloud's account→relay lookup, so there is nothing to type and a prefill
     *   would only be a staler second source of truth;
     * - the **context** is chosen after connecting, from the account's own contexts,
     *   which `admin.getContexts()` answers caller-scoped through the request proof.
     */
    /**
     * Show the "I have an account" path. Default true in a browser, false inside
     * a Calimero Desktop window, which is already bound to the desktop's node
     * (see `isDesktopWindow`).
     */
    cloud?: boolean;
    defaults?: {
        /**
         * Point enrolment at a wallet other than the hosted one.
         *
         * Exists for working ON the wallet: a wallet served from `localhost:8090`
         * cannot be reached through the hosted URL, and without this the only way to
         * test a wallet change would be to deploy it.
         */
        walletUrl?: string;
    };
}
declare function ConnectButtonAccount({ className, style, theme, defaults, cloud: cloudProp, }: ConnectButtonAccountProps): react_jsx_runtime.JSX.Element;

interface LoginModalProps {
    /** Callback when user connects */
    onConnect: (url: string) => void;
    /** Callback when modal is closed */
    onClose: () => void;
    /**
     * @deprecated Ignored. The modal always shows node discovery + manual URL
     * entry; the old hardcoded-default "Local" view was removed. Kept so
     * existing call sites keep compiling.
     */
    connectionType?: ConnectionType | CustomConnectionConfig;
    /** Whether the modal is open */
    isOpen: boolean;
    /** Theme overrides — accepts any subset of `MeroTheme` tokens */
    theme?: MeroTheme;
    /**
     * Ports probed when discovering local nodes. Defaults to the well-known
     * Calimero dev ports (2428, 2429, 2528, 2529). Mostly an escape hatch for
     * non-standard setups and tests.
     */
    localNodePorts?: readonly number[];
    /**
     * The second way in: a **Cloud** tab, signing in with a Calimero account by
     * enrolling this tab's device key at the wallet.
     *
     * - **Omitted** (the default): the tab is shown, sourced from
     *   `useAccountEnrolment()` inside the modal — enrolment starts from the tab,
     *   and a page coming back from the wallet is completed here, whether or not
     *   the modal is open. Nothing to wire; the modal must be inside a
     *   `MeroProvider`.
     * - **`false`**: no Cloud tab and no tabs at all — the node dialog as it was.
     * - **An object**: the caller's own enrolment, used verbatim; the modal reads
     *   none itself. The values are `useAccountEnrolment`'s, as `ConnectButton`
     *   passes them.
     *
     * Inside a Calimero Desktop window every form is as `false` — the window is
     * already bound to the desktop's node, so there is no relay and no passkey to
     * go through. `cloudOnDesktop` turns that off.
     */
    cloud?: false | {
        /** Start enrolment — normally `useAccountEnrolment().goToWallet`. */
        onEnrol: () => void;
        /** What the last enrolment had to say, shown on the Cloud tab. */
        note?: string | null;
        /** The wallet enrolment goes to. Shown only when `customWallet`. */
        walletUrl?: string;
        /** Whether `walletUrl` is an override rather than the hosted wallet. */
        customWallet?: boolean;
    };
    /**
     * Show the Cloud tab inside a Calimero Desktop window too. Default false:
     * the desktop logs in to its own node, so `cloud` — omitted or an object —
     * is ignored there (see `isDesktopWindow`).
     */
    cloudOnDesktop?: boolean;
    /**
     * The tab selected when the modal opens. Ignored with `cloud={false}`.
     *
     * Default `'node'` — except that a modal sourcing its own Cloud tab opens on
     * `'cloud'` when the page is coming back from the wallet, so whatever the
     * completion has to say is where the person is looking. An explicit value
     * always wins.
     */
    initialTab?: LoginModalTab;
}
/** The two tabs of the connect dialog, when it has a Cloud tab. */
type LoginModalTab = 'node' | 'cloud';
/**
 * LoginModal - Connection modal component
 */
declare function LoginModal({ onConnect, onClose, isOpen, theme, localNodePorts, cloud, cloudOnDesktop, initialTab: initialTabProp, }: LoginModalProps): React.ReactPortal | null;

interface AccountSignInPanelProps {
    /** Start enrolment — normally `useAccountEnrolment().goToWallet`. */
    onEnrol: () => void;
    /** What the last enrolment had to say (an error, or "nowhere to write yet"). */
    note?: string | null;
    /** The wallet enrolment goes to. Shown only when `customWallet`. */
    walletUrl?: string;
    /** Whether `walletUrl` is an override rather than the hosted wallet. */
    customWallet?: boolean;
    /** Theme overrides — accepts any subset of `MeroTheme` tokens */
    theme?: MeroTheme;
}
declare function AccountSignInPanel({ onEnrol, note, walletUrl, customWallet, theme, }: AccountSignInPanelProps): react_jsx_runtime.JSX.Element;

interface CalimeroLogoProps extends React__default.SVGAttributes<SVGSVGElement> {
    /** Width / height shorthand (applied to both). Default: 24. */
    size?: number | string;
}
declare function CalimeroLogo({ size, color, style, ...rest }: CalimeroLogoProps): react_jsx_runtime.JSX.Element;

interface MigrationPendingBannerProps {
    /** Context whose authored entries to check / convert. */
    contextId: string;
    className?: string;
    /** Override the default prompt text. */
    children?: ReactNode;
    /** Fired once a convert leaves nothing pending (`remaining === 0`). */
    onMigrated?: () => void;
}
/**
 * Shows only when the current identity has entries below the target schema
 * (skew #1). A single button runs the one-tap `migrate_my_entries` convert and
 * the banner clears itself once nothing is pending.
 */
declare function MigrationPendingBanner({ contextId, className, children, onMigrated, }: MigrationPendingBannerProps): react_jsx_runtime.JSX.Element | null;

interface MigrationAdminPanelProps {
    /** Namespace whose migration rollup to display. */
    namespaceId: string;
    /** Re-fetch interval; migration facts arrive via heartbeat gossip. */
    pollIntervalMs?: number;
    className?: string;
}
/**
 * Operator view of a namespace's migration rollup (skew #3): the cohort
 * counters, `membersPendingSignature`, and a per-member table. Read-only —
 * pair with the upgrade-trigger hooks to drive a migration.
 */
declare function MigrationAdminPanel({ namespaceId, pollIntervalMs, className }: MigrationAdminPanelProps): react_jsx_runtime.JSX.Element;

/**
 * The delegated connect path, entered from an invitation instead of an account.
 *
 * `ConnectButtonAccount` enrols the device and then asks the cloud which relays
 * serve the ACCOUNT. For a first-time account that answer is `[]` and there is
 * nothing to connect to — correctly, since nothing yet serves an account that is
 * a member of nothing. This hook is the other door into the same connection: it
 * takes an invitation, resolves a relay from the NAMESPACE, presents the signed
 * join, and then connects through the node that carried it.
 *
 * It is `MeroContext`'s own `connectWithAccount` at the end, not a second
 * connection mechanism — the only difference is how the relay was found.
 */

interface UseDelegatedBootstrapOptions {
    /** Point at a cloud other than the hosted manager. For local rigs. */
    readonly cloudBaseUrl?: string;
}
interface UseDelegatedBootstrapResult {
    /** The enrolled account and its certificate, or `null` if none was ever held. */
    readonly credential: DelegatedCredential | null;
    /**
     * Whether this account is signed in with nowhere to write.
     *
     * True means: an enrolled credential is held and no relay is known for it, so
     * the account→relay lookup has nothing and an invitation is what changes that.
     * Being signed in is NOT the missing part — that is the whole point, since you
     * have to be signed in to be invited.
     *
     * False covers "already has a relay" and "never enrolled", which need the two
     * other entry points rather than this one.
     */
    readonly needsBootstrap: boolean;
    readonly running: boolean;
    /** The last attempt's outcome, kept so a UI can name the failing step. */
    readonly result: BootstrapResult | null;
    /**
     * Admit this account to the invitation's namespace and connect through the
     * admitting node.
     *
     * Resolves rather than throws for every expected refusal: the step names are
     * the point, because an empty intersection, an unreachable admitter and a
     * namespace with no fleet assignment need three different actions.
     */
    readonly bootstrap: (input: {
        readonly namespaceId: string;
        readonly invitation: SignedGroupOpenInvitation;
        /**
         * A node to present the join to, skipping the cloud lookup — an operator's,
         * a local rig's, or one a future invitation carries.
         */
        readonly nodeUrl?: string;
        /** The context the invitation is for, so its relay is known before any listing. */
        readonly contextId?: string;
    }) => Promise<BootstrapResult>;
}
declare function useDelegatedBootstrap(options?: UseDelegatedBootstrapOptions): UseDelegatedBootstrapResult;

/** The action an invite link carries: `calimero://<package>/join?invitation=…`. */
declare const JOIN_ACTION = "join";
/** The query parameter every app's invite builder emits. */
declare const INVITATION_PARAM = "invitation";
/**
 * The link an inviter shares, for every app: `https://links.calimero.network/<slug>/join?invitation=…`.
 *
 * One shape, so one path gets it into the app. The links page opens the app's
 * frontend with the query appended (web, PWA, a cold desktop start), and a
 * desktop that is already running hands it over as a `deep-link` bridge event;
 * `primeInvitationCapture` listens to both. Nobody pastes it anywhere.
 *
 * `slug` is the app's deep-link handler, which for a Calimero app is its package id.
 * `extra` rides along beside the token, for an app whose link carries more
 * than the token (a display name, a target id).
 */
declare function buildInviteLink(slug: string, token: string, extra?: Record<string, string | undefined>): string;
/** One captured invitation, with the ack the app owes the store. */
interface CapturedInvitation {
    /** The raw invitation token, ready to parse. */
    token: string;
    /** Every query parameter the link carried, the token included. */
    params: Record<string, string>;
    /** Ack it so the store stops replaying it. Call once handled OR declined. */
    resolve: () => void;
    /**
     * Whether to attempt the join without being asked.
     *
     * False once this invitation has spent its automatic attempts. The token is
     * still handed over — so a field can be prefilled and one click retries it —
     * but a link that can never join stops re-firing on every load.
     */
    autoJoin: boolean;
}
type Listener = (invitation: CapturedInvitation) => void;
/**
 * How many loads may auto-join one invitation before it needs a human.
 *
 * An unacked intent is replayed on every load by design, so that a transient
 * failure (node still starting, no member online yet) is retried rather than
 * lost. Without a ceiling a *permanent* failure is retried just as eagerly and
 * forever — which is what made every restart of the node re-fire a link that
 * had already been used.
 */
declare const MAX_AUTO_JOIN_ATTEMPTS = 3;
/** The token in a raw deep-link payload, or `null` if it carries none. */
declare function invitationFromRaw(raw: string): string | null;
/** The current URL with the invitation parameter removed. */
declare function urlWithoutInvitation(href: string): string;
/**
 * Start listening for inbound invitation links.
 *
 * Call once before React mounts: the launcher appends `?invitation=…` to the
 * app's own URL, and a router would otherwise replace the URL before any
 * component could read it.
 *
 * `appKey` namespaces the attempt ledger. Two apps served from one origin (the
 * dev server, a preview deployment) would otherwise share it.
 *
 * `slug` is this app's deep-link slug (its package id). Given it, a `join` link
 * addressed to a different app is dropped instead of being offered here.
 */
declare function primeInvitationCapture(appKey?: string, options?: {
    slug?: string | readonly string[];
}): void;
/**
 * Subscribe to invitations. Replays one already captured, so a component that
 * mounts after the link was opened still sees it.
 */
declare function onInvitation(listener: Listener): () => void;
/**
 * The captured invitation right now, without subscribing.
 *
 * Unlike `onInvitation`, this does not consume it and does not register a
 * listener — it answers "is an invitation inbound?" for code that only needs
 * to know, such as a bootstrap deciding where to land the user.
 */
declare function peekInvitation(): CapturedInvitation | null;
/**
 * Be told when the captured invitation changes: one arrives, or it is acked.
 *
 * Unlike `onInvitation` this takes nothing: the invitation stays buffered for
 * whoever redeems it. It is for UI that only needs to know one is pending — the
 * logged-out invitation screen — and pairs with `peekInvitation` as a
 * `useSyncExternalStore` source.
 */
declare function subscribeInvitation(watcher: () => void): () => void;
/** Test seam: drop the controller and any buffered intent. */
declare function resetInvitationCaptureForTests(): void;

/**
 * What to tell a person about a failed join, or `null` to show the node's own
 * message (an `unknown` failure has nothing better to offer).
 *
 * `noun` is what the app calls the thing being joined: "team", "space", "vault".
 * The reason is mero-js's (`redeemInvitation`), read off the node's status.
 */
/**
 * The reasons mero-js names for a join refusal, including the two it added for
 * a link already used and a removal. Listed here as well so this builds against
 * a mero-js that does not name them yet; such a mero-js reports both as
 * `refused`.
 */
type JoinFailureReason = InviteFailureReason | 'already-used' | 'removed';
declare function describeInviteFailure(reason: JoinFailureReason, noun?: string): string | null;

/** What the token carries, once the app's codec has read it. */
interface ParsedInvitation {
    namespaceId: string;
    /** The invitation struct the node's join body expects. */
    invitation: unknown;
    /** The human name the inviter embedded, if any. */
    teamName?: string;
}
/**
 * Where redemption has got to, for rendering.
 *
 * `joining` is the state the apps used to lack: following an invite
 * link put the app on a page with no sign anything was happening, for as long
 * as the join took — up to 95s when no member of the namespace was online.
 */
type InviteState = {
    stage: "idle";
} | {
    stage: "awaiting-confirmation";
    teamName?: string;
} | {
    stage: "joining";
    teamName?: string;
} | {
    stage: "joined";
    namespaceId: string;
    teamName?: string;
} | {
    stage: "already-member";
    namespaceId: string;
    teamName?: string;
} | {
    stage: "failed";
    /** The node's own words, or this package's for an unreadable link. */
    message: string;
    /** Why; `describeInviteFailure` turns it into something to show. */
    reason: InviteFailureReason;
    retryable: boolean;
};
interface UseInviteRedemptionOptions<P extends ParsedInvitation = ParsedInvitation> {
    /**
     * Read a raw token into its parts. Return `null` (or throw) if it is not a
     * usable invitation — the app owns this because the codecs differ slightly.
     * Extra fields the app returns (a vault name, a context id) come back as
     * `parsed` and are handed to `redeem`.
     */
    parse: (token: string, params: Record<string, string>) => P | null;
    /**
     * The two calls that differ between apps, for the standard join: join the
     * namespace, then check membership (mero-js `redeemInvitation`).
     */
    redeemer?: InviteRedeemer;
    /**
     * An app's own join flow, for one that does more than join the namespace
     * (enter a context, pick where to land). Takes precedence over `redeemer`.
     * Report a failure as a `failed` outcome rather than throwing; a throw is
     * read as an `unknown`, retryable failure.
     */
    redeem?: (parsed: P) => Promise<RedeemOutcome>;
    /**
     * Ask before joining, rather than joining on arrival.
     *
     * Not a stylistic choice, and deliberately per-app. Joining is a state
     * change: it puts you in someone else's namespace and gives them a peer that
     * syncs their data. For an app holding secrets — mero-pass is the clear case
     * — doing that on page load means a forwarded link, or a background tab that
     * refreshes, joins silently. Decoding is pure and local, so the scope can be
     * shown first and the join can need a click.
     *
     * With this set the state goes `awaiting-confirmation` and waits for
     * `accept()`; `decline()` acks the invitation so it stops coming back.
     *
     * On by default: an invitation reaches an app only by a link being opened,
     * and every app asks before it joins. Off only for a caller that has already
     * asked in its own words.
     */
    confirm?: boolean;
    /**
     * Called once, after a join has landed and before anything navigates. The
     * `already-member` case calls it too: the app still has to go and look at a
     * namespace it may never have opened.
     */
    onJoined?: (namespaceId: string, teamName?: string) => void;
    /**
     * Hold off until the app can actually join — a session, a resolved
     * application id. The invitation is buffered meanwhile, not dropped.
     */
    enabled?: boolean;
}
interface InviteRedemption<P extends ParsedInvitation = ParsedInvitation> {
    state: InviteState;
    /** The captured token, for prefilling a manual join field. */
    token: string | null;
    /** What the invitation names, available while confirming. */
    parsed: P | null;
    /** Go ahead with a join that is `awaiting-confirmation`. */
    accept: () => void;
    /** Decline it, and ack it so it does not come back. */
    decline: () => void;
    /** Retry the captured invitation by hand, past the automatic attempt cap. */
    retry: () => void;
    /** Take the result off the screen. */
    dismiss: () => void;
}
/**
 * Redeem an invitation that arrived by link, and report progress.
 *
 * Mount this once, high enough that it is not unmounted by routing. Capture is
 * process-wide and buffers, so mounting late is safe; being unmounted mid-join
 * only loses the on-screen state, never the invitation (it is acked on the
 * outcome, not on the render).
 */
declare function useInviteRedemption<P extends ParsedInvitation = ParsedInvitation>({ parse, redeemer, redeem, confirm, onJoined, enabled, }: UseInviteRedemptionOptions<P>): InviteRedemption<P>;

/** How long "You're in" stays up before the dialog closes by itself. */
declare const INVITATION_READY_MS = 1200;
interface InvitationDialogProps {
    /** The app's `useInviteRedemption(...)`. */
    redemption: InviteRedemption;
    /** What the app calls the thing being joined: "team", "workspace", "vault". */
    noun?: string;
    /** Shown above the title, so a person knows which app is asking. */
    appName?: string;
    /**
     * Optional: the joined namespace's data has been read, empty or not. For an
     * app whose root already knows; others leave this out and let the page that
     * reads the data clear the flag with `useJoinSync({ settled })`.
     */
    synced?: boolean;
    /**
     * Optional: the app's own words under the question, for an invitation whose
     * grant needs spelling out ("Joining gives you this vault and the rest of
     * the team it belongs to.").
     */
    detail?: string;
    /** Optional: which step a slow join is on, shown while joining. */
    status?: string | null;
}
/** The stage the dialog shows: redemption's, plus the wait for the data. */
type InvitationDialogStage = 'awaiting-confirmation' | 'joining' | 'syncing' | 'ready' | 'already-member' | 'failed';
declare function InvitationDialog({ redemption, noun, appName, synced, detail, status, }: InvitationDialogProps): React.ReactPortal | null;

/**
 * Hear every mark and clear in this page. The flag is set by redemption (at
 * the app root) and cleared by whichever page reads the namespace's data
 * (`useJoinSync`), so this is how the one learns about the other without the
 * app threading page state up to its root.
 */
declare function subscribeJustJoined(listener: () => void): () => void;
/**
 * Call this the moment a join succeeds, before navigating. The app that reads
 * the flag is usually a different route from the one that accepted the invite.
 */
declare function markNamespaceJustJoined(namespaceId: string): void;
declare function clearNamespaceJustJoined(namespaceId: string): void;
declare function isNamespaceJustJoined(namespaceId: string | null): boolean;

/**
 * Base window for the gate. A governance op plus the namespace's own state
 * typically land in under a second on a healthy mesh; past this we give up
 * ONLY if nothing is actively in flight.
 */
declare const JOIN_SYNC_WATCHDOG_MS = 30000;
/**
 * Hard ceiling. Bounds a genuinely stuck sync so the gate can never pin the UI
 * forever, even while something keeps reporting activity.
 */
declare const JOIN_SYNC_MAX_MS = 120000;
/** How often the watchdog re-checks activity past the base window. */
declare const JOIN_SYNC_POLL_MS = 2000;
interface JoinSyncOptions {
    /** The namespace being shown. `null` while nothing is selected. */
    namespaceId: string | null;
    /**
     * The app's own answer to "has this namespace's data actually arrived?" —
     * the one thing that cannot be shared, because every app reads a different
     * collection. Pass `true` once a real read has come back, INCLUDING an empty
     * one: "no documents yet" is a settled answer, and waiting for a non-empty
     * result would gate an genuinely empty workspace forever.
     */
    settled: boolean;
    /**
     * Optional: a sync is making forward progress. Holds the gate open past the
     * base window, up to the hard ceiling. Leave undefined if the app has no
     * such signal — the gate then simply expires at the base window.
     *
     * A stuck or backing-off sync must report `false`, not `true`: the point of
     * the base window is to stop waiting on something that is not coming.
     */
    active?: boolean;
}
interface JoinSyncState {
    /**
     * Show the "syncing from peers" affordance. True only for a namespace this
     * session just joined, whose data has not arrived, within the watchdog.
     */
    isSyncing: boolean;
    /** Drop the gate now — for a "show me anyway" control. */
    dismiss: () => void;
}
/**
 * Gate the window between "you joined" and "your data is here".
 *
 * Without it a just-joined namespace renders its ordinary empty state, and the
 * user cannot tell an empty workspace from one that is still arriving. That
 * ambiguity is the whole reason this exists: the two look identical, and the
 * honest one is the less alarming of the two.
 */
declare function useJoinSync({ namespaceId, settled, active, }: JoinSyncOptions): JoinSyncState;

interface JoinSyncBannerProps {
    /** Usually `useJoinSync(...).isSyncing`. Renders nothing when false. */
    show: boolean;
    /** What is arriving, in the app's own words: "documents", "vaults", "sheets". */
    what?: string;
    /** Wire to `useJoinSync(...).dismiss` for a "show me anyway" escape. */
    onDismiss?: () => void;
    /** Escape hatches for apps with their own design system. */
    className?: string;
    style?: CSSProperties;
    children?: ReactNode;
}
/**
 * Deliberately inline-styled rather than using a stylesheet or utility classes.
 *
 * The apps in this monorepo do not share a CSS stack — Tailwind, CSS modules
 * and plain stylesheets are all represented — so anything class-based would
 * render unstyled in most of them. Inline styles are the only thing that looks
 * the same everywhere, and `className`/`style` are there for apps that want to
 * take it over. Colours come from CSS custom properties with literal
 * fallbacks, so an app that defines them gets its own palette for free and one
 * that does not still gets something legible in both themes.
 */
declare function JoinSyncBanner({ show, what, onDismiss, className, style, children, }: JoinSyncBannerProps): react_jsx_runtime.JSX.Element | null;

interface InvitationGateProps {
    /**
     * The app, shown as usual unless an invitation is waiting on a login. Leave
     * out to mount the gate beside the app instead, as a full-page layer.
     */
    children?: ReactNode;
    /**
     * The app's invitation codec, the same `parse` it gives `useInviteRedemption`.
     * Decoding needs no session, so the screen can name what is being joined.
     * Without it the screen falls back to the noun.
     */
    parse?: (token: string, params: Record<string, string>) => ParsedInvitation | null;
    /** What the app calls the thing being joined: "team", "workspace", "vault". */
    noun?: string;
    /** The app's name, so a person knows where the invitation is taking them. */
    appName?: string;
    /** Optional: the app's own words about what joining gives you. */
    detail?: string;
    /** Passed to the login button (theme, `cloud`, `connectionType`). */
    connectButtonProps?: Omit<ConnectButtonProps, 'label'>;
}
/** The captured invitation, re-rendering when one arrives or is acked. */
declare function usePendingInvitation(): CapturedInvitation | null;
declare function InvitationGate({ children, parse, noun, appName, detail, connectButtonProps, }: InvitationGateProps): react_jsx_runtime.JSX.Element | null;

interface JoinInvitationInput {
    readonly namespaceId: string;
    /** The context the invitation was for, when it names one; a workspace invitation names none. */
    readonly contextId?: string;
    readonly invitation: SignedGroupOpenInvitation;
}
type JoinInvitationStep = BootstrapFailure['step'] | 'node-join';
type JoinInvitationResult = {
    readonly ok: true;
} | {
    readonly ok: false;
    readonly step: JoinInvitationStep;
    /** What went wrong, in words a person can act on. */
    readonly reason: string;
    /** True when no retry can succeed: a fresh invitation is the only cure. */
    readonly final: boolean;
    /** The HTTP status of the refusal, when there was one. */
    readonly status?: number;
};
/**
 * Whether a node's join failure means the invitation itself will never work.
 *
 * Errs toward false: a dropped invitation is unrecoverable for the user, a
 * retried one costs a round trip, so a timeout or anything unfamiliar keeps
 * it. Phrases, not bare words — `"invalid"` alone would also match an
 * "invalid response" from a proxy, a transient failure.
 */
declare function isFinalInvitationError(message: string | undefined | null): boolean;
declare function useJoinInvitation(): {
    joinInvitation: (input: JoinInvitationInput) => Promise<JoinInvitationResult>;
    joining: boolean;
    /** The namespaces this connection is a member of: a node's own, or an account's across its relays. */
    memberships: () => Promise<string[]>;
    /**
     * The `{ join, memberships }` pair mero-js's `redeemInvitation` drives, for
     * whichever connection this is, so an app redeems an invitation (join once,
     * then check membership) with no transport of its own. `join` throws on a
     * refusal, carrying its HTTP status for the outcome's reason.
     */
    invitationRedeemer: (input: JoinInvitationInput) => InviteRedeemer;
};

/**
 * useAccountEnrolment — the account sign-in flow, with no UI.
 *
 * Moved out of {@link ConnectButtonAccount} unchanged, so that `ConnectButton`'s
 * Cloud tab and `ConnectButtonAccount` share one copy of it: the device keys,
 * the redirect to the wallet, and the completion when the tab comes back.
 *
 * - `goToWallet` generates (or reuses) this tab's device keys and leaves for the
 *   wallet. mero-js's `deviceEnrolmentUrl` remembers the request under a fresh
 *   state.
 * - On the way back, the callback is read ONCE during render, the certificate
 *   is completed and saved (`completeDeviceEnrolment` refuses an answer to a
 *   request this browser did not start, and spends its state), the account's
 *   relays are looked up, and `connectWithAccount` connects.
 * - `note` is what the person should be told about that — an error, or a
 *   connection with nowhere to write yet.
 * - `returning` is true when this page load carries an enrolment callback,
 *   success or error, so a caller can show the place the note appears.
 */
/**
 * Whether this page load is the one coming back from the wallet — a completed
 * enrolment or a declined one — WITHOUT consuming it.
 *
 * `useAccountEnrolment` reads the callback once and strips it from the address
 * bar, so a second reader finds nothing. That makes `returning` from the hook
 * unusable for the one decision that has to be taken before the hook runs: a
 * component that owns `LoginModal`'s `isOpen` and wants the dialog open on the
 * way back. This is the answer for it, as a `useState` initialiser:
 *
 * ```tsx
 * const [open, setOpen] = useState(isReturningFromWallet);
 * <LoginModal isOpen={open} ... />  // sources its own Cloud tab, lands on it
 * ```
 *
 * The parent's initialiser runs before the modal's hook reads the fragment, so
 * the two agree. `ConnectButton` needs none of this: it owns both.
 */
declare function isReturningFromWallet(location?: {
    hash: string;
} | undefined): boolean;
interface UseAccountEnrolmentOptions {
    /**
     * Point enrolment at a wallet other than the hosted one.
     *
     * Exists for working ON the wallet: a wallet served from `localhost:8090`
     * cannot be reached through the hosted URL, and without this the only way to
     * test a wallet change would be to deploy it.
     */
    walletUrl?: string;
    /**
     * When false, the hook reads no callback and completes nothing, so a
     * component that has the account path switched off leaves the fragment for
     * whichever component does handle it. Default true, except inside a
     * Calimero Desktop window (see `isDesktopWindow`), whose app is already
     * bound to the desktop's node and has no wallet callback to complete.
     */
    enabled?: boolean;
}
interface AccountEnrolment {
    /** Leave for the wallet to enrol this tab's device key. */
    goToWallet: () => Promise<void>;
    /** What to tell the person about the last enrolment, or null. */
    note: string | null;
    /** Whether this page load carries an enrolment callback (success or error). */
    returning: boolean;
    /** The wallet enrolment goes to: the override, else the hosted one. */
    walletUrl: string;
    /** Whether `walletUrl` is an override rather than the hosted wallet. */
    customWallet: boolean;
}
declare function useAccountEnrolment({ walletUrl: walletOverride, enabled, }?: UseAccountEnrolmentOptions): AccountEnrolment;

interface UseEphemeralOptions<T> {
    /** Encoding for the presence slice. Defaults to JSON. */
    codec?: Codec<T>;
    /** Base value for the first `setPresence` merge. */
    initial?: T;
    /** Minimum ms between publishes. Trailing edge — the latest value wins. */
    throttleMs?: number;
    /** Include your own echoed presence in `peers`. Default false. */
    includeSelf?: boolean;
}
/** Shape returned by {@link useEphemeral}. */
interface UseEphemeralResult<T> {
    peers: Map<string, T>;
    setPresence: (partial: Partial<T>) => void;
    ageOf: (author: string) => number | undefined;
    error: Error | null;
}
/**
 * Observe and publish ephemeral presence (cursors, typing, online) for a
 * context.
 *
 * ONE read path: the subscription. When a client subscribes, the node replays
 * that context's current presence to that connection as ordinary entries
 * before the live deltas start, so seeding and updating share a single shape
 * ({@link EphemeralEntry}) and a reconnect — `SseClient` auto-reconnects and
 * re-subscribes — re-seeds itself. There is no snapshot fetch and no
 * client-side reconciliation pass.
 *
 * Freshness is computed entirely from local clock deltas: a replayed entry is
 * current as of `Date.now() - ageMs`, a live delta as of `Date.now()`. No
 * cross-machine clock comparison is ever performed.
 *
 * No client-side TTL or heartbeat: the node sweeps at 7s and emits removals,
 * and re-publishes on your behalf every 2.5s. A replay is treated as
 * AUTHORITATIVE — see the replay-reconcile pass in the read effect — so a peer
 * swept while the SSE connection was down does not survive the reconnect.
 *
 * `error` is derived, not accumulated: standing conditions (no `ephemeral`
 * surface) are recomputed every render, one-shot async failures are latched
 * keyed by the context they happened in, and whether a latched failure is even
 * relevant (an unresolved identity when `includeSelf` is true) is decided at
 * read time. Nothing survives a context switch.
 */
declare function useEphemeral<T>(contextId: string | null, options?: UseEphemeralOptions<T>): UseEphemeralResult<T>;
/**
 * Shape accepted by the metadata-setter hooks — re-exported from mero-js so
 * callers have one canonical type. A `set*Metadata` call **replaces the whole
 * record**: `data` defaults to `{}` and wholly replaces the stored map; omit
 * `name` to keep the current name.
 */
type SetMetadataInput = SetMetadataRequest;
/** Options a mutation hook that can fail meaningfully accepts. */
interface MutationOptions {
    /**
     * Rethrow a failed request from the action, after recording it in `error`
     * and `failure`.
     *
     * By default an action resolves `null` on failure, which a caller awaiting it
     * cannot tell apart from "not connected" — and a `catch` around it never
     * runs, so a refused join reads as a successful one. Set this when the
     * caller branches on the outcome.
     */
    throwOnError?: boolean;
}
/**
 * Execute RPC methods against a context.
 * Tracks loading/error state. Unmount-safe.
 */
declare function useExecute(contextId: string | null, executorId: string | null): {
    execute: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T | null>;
    loading: boolean;
    error: Error | null;
};
/** Event payload delivered to a `useSubscription` callback. */
type SubscriptionEventData = SseEventData | GroupMembershipEventData | GroupMigrationEventData;
/** Ids to subscribe to. Either can be omitted, but not both. */
interface SubscriptionInput {
    contextIds?: string[];
    groupIds?: string[];
}
/**
 * Subscribe to SSE events for context and/or group IDs.
 * StrictMode-safe: tracks the SseClient instance in a ref to avoid
 * double-connect on mount/unmount/remount cycles.
 */
declare function useSubscription(contextIds: string[], callback: (event: SubscriptionEventData) => void): void;
declare function useSubscription(input: SubscriptionInput, callback: (event: SubscriptionEventData) => void): void;
/**
 * Fetch contexts for the current node, optionally filtered by application ID.
 */
declare function useContexts(applicationId?: string | null): {
    contexts: ApplicationContextRecord[];
    loading: boolean;
    error: Error | null;
    refetch: () => Promise<void>;
};
declare function useApplicationContexts(applicationId?: string | null): {
    contexts: ApplicationContextRecord[];
    loading: boolean;
    error: Error | null;
    refetch: () => Promise<void>;
};
declare function useGroupMembers(groupId?: string | null): {
    members: _calimero_network_mero_js.GroupMember[];
    loading: boolean;
    error: Error | null;
    refetch: () => Promise<void>;
};
declare function useGroupContexts(groupId?: string | null): {
    contexts: GroupContextEntry[];
    loading: boolean;
    error: Error | null;
    refetch: () => Promise<void>;
};
declare function useGroupInvitations(): {
    createInvitation: (groupId: string, request?: CreateGroupInvitationRequest) => Promise<_calimero_network_mero_js.CreateGroupInvitationResponseData | _calimero_network_mero_js.CreateRecursiveGroupInvitationResponseData | null>;
    loading: boolean;
    error: Error | null;
};
declare function useJoinGroup(): {
    joinGroup: (request: JoinGroupRequest) => Promise<_calimero_network_mero_js.JoinGroupResponseData | null>;
    loading: boolean;
    error: Error | null;
};
/**
 * Takes the member's ACCOUNT (64 hex), as `useGroupMembers` rows are keyed by
 * and `useNodeIdentity().identity?.accountId` returns - NOT a signing key.
 * Both are 32-byte strings, so passing a key names nobody and raises nothing.
 */
declare function useGroupCapabilities(groupId?: string | null, memberId?: string | null): {
    capabilities: number | null;
    loading: boolean;
    error: Error | null;
    refetch: () => Promise<number | null>;
    setCapabilities: (nextCapabilities: number) => Promise<number | null>;
};
declare function useContextDiscovery(options: ContextDiscoveryOptions): ContextDiscoveryState;
declare function useCreateContext(): {
    createContext: (request: CreateContextRequest) => Promise<{
        contextId: string;
    } | null>;
    loading: boolean;
    error: Error | null;
};
interface CreatePrivateContextRequest {
    readonly namespaceId: string;
    readonly applicationId: string;
    /** The accounts that share it with you, and nobody else — e.g. the other person of a DM. */
    readonly members: readonly string[];
    readonly initializationParams?: number[];
}
/**
 * Create a context only you and `members` are in (a DM, a small room): its own
 * restricted group in the namespace, members added directly — they are in the
 * namespace already, so nobody is invited. Same call on either connection:
 *
 *  - a node login makes the group, adds the members and creates the context
 *    with its own admin calls (as mero-chat's DMs do);
 *  - an account has the relay serving the namespace do the same three steps,
 *    each under its own warrant (mero-js createDelegatedContext).
 */
declare function useCreatePrivateContext(): {
    createPrivateContext: (request: CreatePrivateContextRequest) => Promise<{
        contextId: string;
    } | null>;
    loading: boolean;
    error: Error | null;
};
declare function useDeleteContext(): {
    deleteContext: (contextId: string) => Promise<_calimero_network_mero_js.DeleteContextResponseData | null>;
    loading: boolean;
    error: Error | null;
};
/**
 * Join a context. `failure` says what kind of refusal a failed join was, and
 * whether trying again later could work; pass `{ throwOnError: true }` to have
 * `joinContext` reject instead of resolving `null`.
 */
declare function useJoinContext(options?: MutationOptions): {
    joinContext: (contextId: string) => Promise<_calimero_network_mero_js.JoinContextResponseData | null>;
    loading: boolean;
    error: Error | null;
    failure: ClassifiedError | null;
};
declare function useJoinSubgroupInheritance(): {
    joinSubgroupInheritance: (groupId: string) => Promise<{
        groupId: string;
        memberPublicKey: string;
        wasInherited: boolean;
    } | null>;
    loading: boolean;
    error: Error | null;
};
declare function useContextGroup(contextId?: string | null): {
    groupId: string | null;
    loading: boolean;
    error: Error | null;
    refetch: () => Promise<void>;
};
declare function useGroupInfo(groupId?: string | null): {
    groupInfo: GroupInfo | null;
    loading: boolean;
    error: Error | null;
    refetch: () => Promise<void>;
};
declare function useDeleteGroup(): {
    deleteGroup: (groupId: string) => Promise<_calimero_network_mero_js.DeleteGroupResponseData | null>;
    loading: boolean;
    error: Error | null;
};
declare function useSyncGroup(): {
    syncGroup: (groupId: string) => Promise<_calimero_network_mero_js.SyncGroupResponseData | null>;
    loading: boolean;
    error: Error | null;
};
/**
 * Takes the invitee's signing KEY (bs58) - the one call on this resource that
 * does, because someone being added may have no account here yet. Every other
 * member call, including `useRemoveGroupMembers`, takes the ACCOUNT, so a value
 * round-tripped from an add is the wrong one to remove with.
 */
declare function useAddGroupMembers(): {
    addGroupMembers: (groupId: string, request: AddGroupMembersRequest) => Promise<void | null>;
    loading: boolean;
    error: Error | null;
};
/**
 * Takes the member's ACCOUNT (64 hex), as `useGroupMembers` rows are keyed by
 * and `useNodeIdentity().identity?.accountId` returns - NOT a signing key.
 * Both are 32-byte strings, so passing a key names nobody and raises nothing.
 */
declare function useRemoveGroupMembers(): {
    removeGroupMembers: (groupId: string, request: RemoveGroupMembersRequest) => Promise<void | null>;
    loading: boolean;
    error: Error | null;
};
declare function useNamespaces(): {
    namespaces: Namespace[];
    loading: boolean;
    error: Error | null;
    refetch: () => Promise<void>;
};
declare function useNamespace(namespaceId?: string | null): {
    namespace: Namespace | null;
    loading: boolean;
    error: Error | null;
    refetch: () => Promise<void>;
};
/**
 * Who this node is: `accountId` is what member-addressing takes and what
 * `useGroupMembers` rows are keyed by — `publicKey` is the signing key and
 * addresses nobody. Both are 32-byte strings, so a swap fails silently.
 */
declare function useNodeIdentity(): {
    identity: NodeIdentity | null;
    loading: boolean;
    error: Error | null;
    refetch: () => Promise<void>;
};
declare function useNamespacesForApplication(applicationId?: string | null): {
    namespaces: Namespace[];
    loading: boolean;
    error: Error | null;
    refetch: () => Promise<void>;
};
declare function useCreateNamespace(): {
    createNamespace: (request: CreateNamespaceRequest) => Promise<_calimero_network_mero_js.CreateNamespaceResponseData | null>;
    loading: boolean;
    error: Error | null;
};
declare function useDeleteNamespace(): {
    deleteNamespace: (namespaceId: string) => Promise<_calimero_network_mero_js.DeleteNamespaceResponseData | null>;
    loading: boolean;
    error: Error | null;
};
declare function useCreateNamespaceInvitation(): {
    createNamespaceInvitation: (namespaceId: string, request?: CreateNamespaceInvitationRequest) => Promise<CreateNamespaceInvitationResponseData | CreateRecursiveInvitationResponseData | null>;
    loading: boolean;
    error: Error | null;
};
/**
 * Join a namespace by invitation. `failure` says what kind of refusal a failed
 * join was, and whether trying again later could work; pass
 * `{ throwOnError: true }` to have `joinNamespace` reject instead of resolving
 * `null`.
 *
 * To follow an invitation link, prefer {@link useRedeemInvitation}: it also
 * recognises a join that landed although its request failed.
 */
declare function useJoinNamespace(options?: MutationOptions): {
    joinNamespace: (namespaceId: string, request: JoinNamespaceRequest) => Promise<_calimero_network_mero_js.JoinNamespaceResponseData | null>;
    loading: boolean;
    error: Error | null;
    failure: ClassifiedError | null;
};
/**
 * Follow an invitation: join its namespace once, then check membership, and
 * report what happened as a {@link RedeemOutcome}.
 *
 * Unlike {@link useJoinNamespace}, a request that failed but whose join landed
 * anyway — the desktop proxy aborts at 30s, a join with no member online takes
 * longer — is `already-member`, not a failure. `shouldRetain(outcome)` from
 * mero-js says whether to keep the invitation for another attempt.
 *
 * `redeem` resolves `null` only when there is no client to send it through.
 */
declare function useRedeemInvitation(): {
    redeem: (namespaceId: string, invitation: JoinNamespaceRequest["invitation"], options?: {
        groupName?: string;
        teamName?: string;
    }) => Promise<RedeemOutcome | null>;
    outcome: RedeemOutcome | null;
    loading: boolean;
};
declare function useCreateGroupInNamespace(): {
    createGroupInNamespace: (namespaceId: string, request?: CreateGroupInNamespaceRequest) => Promise<_calimero_network_mero_js.CreateGroupInNamespaceResponseData | null>;
    loading: boolean;
    error: Error | null;
};
declare function useNamespaceGroups(namespaceId?: string | null): {
    groups: SubgroupEntry[];
    loading: boolean;
    error: Error | null;
    refetch: () => Promise<void>;
};
/**
 * Takes the member's ACCOUNT (64 hex), as `useGroupMembers` rows are keyed by
 * and `useNodeIdentity().identity?.accountId` returns - NOT a signing key.
 * Both are 32-byte strings, so passing a key names nobody and raises nothing.
 */
declare function useUpdateMemberRole(): {
    updateMemberRole: (groupId: string, identity: string, request: UpdateMemberRoleRequest) => Promise<void | null>;
    loading: boolean;
    error: Error | null;
};
declare function useSetDefaultCapabilities(): {
    setDefaultCapabilities: (groupId: string, request: SetDefaultCapabilitiesRequest) => Promise<void | null>;
    loading: boolean;
    error: Error | null;
};
declare function useSetSubgroupVisibility(): {
    setSubgroupVisibility: (groupId: string, request: SetSubgroupVisibilityRequest) => Promise<void | null>;
    loading: boolean;
    error: Error | null;
};
declare function useDefaultCapabilities(groupId?: string | null): {
    defaultCapabilities: number | null;
    loading: boolean;
    error: Error | null;
    refetch: () => Promise<void>;
};
declare function useSubgroupVisibility(groupId?: string | null): {
    subgroupVisibility: string | null;
    loading: boolean;
    error: Error | null;
    refetch: () => Promise<void>;
};
declare function useSetTeeAdmissionPolicy(): {
    setTeeAdmissionPolicy: (groupId: string, request: SetTeeAdmissionPolicyRequest) => Promise<void | null>;
    loading: boolean;
    error: Error | null;
};
declare function useSetGroupMetadata(): {
    setGroupMetadata: (groupId: string, request: SetMetadataInput) => Promise<void | null>;
    loading: boolean;
    error: Error | null;
};
/**
 * Takes the member's ACCOUNT (64 hex), as `useGroupMembers` rows are keyed by
 * and `useNodeIdentity().identity?.accountId` returns - NOT a signing key.
 * Both are 32-byte strings, so passing a key names nobody and raises nothing.
 */
declare function useSetMemberMetadata(): {
    setMemberMetadata: (groupId: string, identity: string, request: SetMetadataInput) => Promise<void | null>;
    loading: boolean;
    error: Error | null;
};
declare function useSetContextMetadata(): {
    setContextMetadata: (groupId: string, contextId: string, request: SetMetadataInput) => Promise<void | null>;
    loading: boolean;
    error: Error | null;
};
declare function useGroupMetadata(groupId?: string | null): {
    metadata: MetadataRecord | null;
    loading: boolean;
    error: Error | null;
    refetch: () => Promise<void>;
};
declare function useMemberMetadata(groupId?: string | null, identity?: string | null): {
    metadata: MetadataRecord | null;
    loading: boolean;
    error: Error | null;
    refetch: () => Promise<void>;
};
declare function useUpgradeGroup(): {
    upgradeGroup: (groupId: string, request: UpgradeGroupRequest) => Promise<_calimero_network_mero_js.UpgradeGroupResponseData | null>;
    loading: boolean;
    error: Error | null;
};
/**
 * Install a registry package version onto the node — the discrete "Download"
 * step an Updates flow runs before an `upgradeGroup`. Resolves the installed
 * application id (`InstallApplicationResponseData`). Downloading does not by
 * itself change what any group runs; pair it with a subsequent upgrade.
 */
declare function useInstallFromRegistry(): {
    installFromRegistry: (packageName: string, version: string) => Promise<_calimero_network_mero_js.InstallApplicationResponseData | null>;
    loading: boolean;
    error: Error | null;
};
/**
 * Kick off a full state re-pull for a context — operator recovery for a
 * context stranded mid-sync. `force` re-pulls even when the node does not
 * flag the context as stranded.
 */
declare function useResyncContext(): {
    resyncContext: (contextId: string, request?: ResyncContextRequest) => Promise<_calimero_network_mero_js.ResyncContextResponseData | null>;
    loading: boolean;
    error: Error | null;
};
declare function useGroupUpgradeStatus(groupId?: string | null): {
    upgradeStatus: GroupUpgradeStatusResponseData;
    loading: boolean;
    error: Error | null;
    refetch: () => Promise<void>;
};
declare function useRetryGroupUpgrade(): {
    retryGroupUpgrade: (groupId: string) => Promise<_calimero_network_mero_js.UpgradeGroupResponseData | null>;
    loading: boolean;
    error: Error | null;
};
/** Move `childGroupId` under a new parent. */
declare function useReparentGroup(): {
    reparentGroup: (childGroupId: string, request: ReparentGroupRequest) => Promise<_calimero_network_mero_js.ReparentGroupResponseData | null>;
    loading: boolean;
    error: Error | null;
};
declare function useSubgroups(groupId?: string | null): {
    subgroups: SubgroupEntry[];
    loading: boolean;
    error: Error | null;
    refetch: () => Promise<void>;
};
declare function useDetachContextFromGroup(): {
    detachContextFromGroup: (groupId: string, contextId: string) => Promise<void | null>;
    loading: boolean;
    error: Error | null;
};
/**
 * Subscribe to a namespace's `GroupMigration` events, invoking `onEvent` per
 * frame and unsubscribing on unmount.
 *
 * A non-admin subscriber never sees `CascadeProgress`; core delivers that to
 * namespace admins only, so a UI must not wait on it to decide progress.
 */
/**
 * Fallback poll cadence for `useMigrationStatus` when the SSE stream is
 * unavailable (no token, a proxy that buffers, an older node) and the caller
 * named no interval of its own. Chosen to match the heartbeat cadence that
 * migration facts actually arrive on; an explicit `pollIntervalMs` overrides it.
 */
declare const DEFAULT_MIGRATION_POLL_INTERVAL_MS = 5000;
declare function useMigrationEvents(namespaceId: string | null | undefined, onEvent: (event: GroupMigrationEventData) => void): boolean;
/**
 * Migration-status rollup for a namespace (skew #3).
 *
 * Live: subscribes to the `GroupMigration` event family and re-reads on each
 * frame. It re-READS rather than folding the event's counters in, because the
 * rollup is recomputed from raw member rows and is the authoritative answer.
 * `pollIntervalMs` stays as the fallback when SSE is unavailable, and when the
 * caller names none it defaults to `DEFAULT_MIGRATION_POLL_INTERVAL_MS` for
 * exactly as long as the stream is down - so the panel can never sit silently
 * frozen with neither transport.
 * Derived counters are null-safe before the first load.
 */
declare function useMigrationStatus(namespaceId?: string | null, options?: {
    pollIntervalMs?: number;
}): {
    status: MigrationStatus | null;
    rollup: MigrationStatusRollup | null;
    members: MemberMigrationStatusEntry[];
    allMigrated: boolean;
    /**
     * When this node watched the fleet converge, or `null`. Durable, unlike
     * `allMigrated`, which is recomputed from in-TTL heartbeats and lapses back
     * to false when a member simply goes quiet.
     */
    fleetCompletedAt: number | null;
    membersPendingSignature: number;
    /** Members whose migrate aborted (migration-check failed or apply errored). */
    failed: number;
    loading: boolean;
    error: Error | null;
    refetch: () => Promise<void>;
};
/**
 * Bundle-version skew (#2): reads the context's installed `applicationVersion`
 * (semver) and compares it to the app-declared `expected` build constant. Any
 * mismatch (either direction) is `isStale` → "reload to update". Subscribes to
 * `AppVersionChanged` so a live flip updates `appVersion` without a refetch.
 */
declare function useAppVersion(contextId?: string | null, expected?: string): {
    appVersion: string | undefined;
    expected: string | undefined;
    isStale: boolean;
    loading: boolean;
    error: Error | null;
    refetch: () => Promise<void>;
};
/**
 * "Is a newer version available?" for an Updates view. Reads a package's
 * published versions from the registry and compares the newest to the running
 * `currentVersion` (e.g. a context's `applicationVersion`). `updateAvailable`
 * is true only when the registry's newest is strictly greater. This is the
 * registry-side check the admin acts on; gate rendering on admin status at the
 * call site. Pure read — fetching nothing until both `registryUrl` and
 * `packageName` are provided.
 */
declare function useLatestVersion(registryUrl?: string | null, packageName?: string | null, currentVersion?: string | null): {
    versions: string[];
    latestVersion: string;
    currentVersion: string | null | undefined;
    updateAvailable: boolean;
    loading: boolean;
    error: Error | null;
    refetch: () => Promise<void>;
};
/**
 * What app version does this group run, and is there a downloaded-but-not-yet-
 * applied update? Replaces the appKey-vs-installed-blob comparison apps
 * otherwise hand-roll: `pendingApply` is true when the group's `appKey` (the
 * blob it targets) is present, non-zero, and differs from the blob actually
 * installed for its `targetApplicationId`. Deciding whether to render or gate on
 * that status (admin-only actions, etc.) is the call site's job.
 *
 * Resolution stays cheap: the group's record comes from `listNamespaces()` when
 * the id is a namespace, else from `getGroupInfo()`; `getApplication()` then
 * reads the installed version and blob. `activeUpgrade` is returned only when it
 * arrives for free on the group-info path (it is not fetched separately).
 * Subscribes to `AppVersionChanged` and refetches, since any version flip in the
 * workspace can make the rollup stale.
 */
declare function useGroupAppVersion(groupId?: string): {
    loading: boolean;
    error: Error | null;
    refetch: () => Promise<void>;
    /** Semver of the application the group currently targets (`null` until loaded). */
    version: string | null;
    /** The group's `targetApplicationId`. */
    applicationId: string | null;
    /** The installed blob differs from the one the group targets (see hook doc). */
    pendingApply: boolean;
    /** Only populated via the group-info path; `null` in the namespace path. */
    activeUpgrade: GroupUpgradeStatusResponseData;
};
/**
 * The caller's own identity-gated entries pending re-signature (skew #1).
 * `pending` is `pendingCount > 0` (from `count_my_pending`); `authorize()` runs
 * the one-tap `migrate_my_entries` convert and folds the resulting `remaining`
 * back into the count.
 */
declare function useMyAuthoredMigration(contextId?: string | null): {
    summary: MigrateMyEntriesSummary | null;
    pendingCount: number;
    pending: boolean;
    authorize: () => Promise<MigrateMyEntriesSummary | null>;
    loading: boolean;
    error: Error | null;
    refresh: () => Promise<void>;
};
/**
 * Options for the blob READ hooks.
 *
 * `contextId` is what picks the mode, and the two modes have wildly different
 * costs:
 *
 * - **omitted** — local-only read. The node answers from its own blob store
 *   and returns immediately, or 404s.
 * - **supplied** — network discovery. The node probes that context's peers
 *   (availability nodes first) for a holder. Core bounds the search by a ~30s
 *   deadline, and for {@link useBlobUrl} the byte transfer is on top of that.
 *
 * So `loading` is load-bearing UI state on these hooks, not decoration: a
 * discovery read can plausibly spin for half a minute before it resolves
 * either way. Render a spinner (or a cancel affordance) accordingly.
 */
interface BlobHookOptions {
    /** Context whose peers to probe. Omit for a local-only read. */
    contextId?: string;
}
/** Options for {@link useBlobUrl}. */
interface UseBlobUrlOptions extends BlobHookOptions {
    /**
     * MIME type stamped on the `Blob` the object URL points at. The blob read
     * itself carries no type, and a peer-sourced answer has no `mimeType` at
     * all, so pass it when the consumer needs one (`<img>` sniffs; a download
     * `<a>` and an `<iframe>` do not).
     */
    type?: string;
}
/**
 * A blob's presence and size, WITHOUT downloading it — the cheap half of the
 * blob surface, and the one to ask before pulling something large.
 *
 * `blobId` follows the same `string | null` convention as the other read
 * hooks: null/undefined means "no read", not "read nothing" — nothing is
 * fetched and `info` stays null.
 *
 * `hash` and `mimeType` on the result are genuinely optional: a peer probe
 * answers with presence and size only, so a discovery-sourced hit carries
 * neither. `info.source` (`'local' | 'peer'`, undefined on nodes that predate
 * the header) tells the two apart — do not treat a missing `mimeType` as a
 * malformed response.
 *
 * `notFound` distinguishes the legitimate "no holder" outcome (the node
 * answered 404) from a transport failure. `error` is set in BOTH cases — this
 * hook does not swallow the 404, it only labels it.
 *
 * Latency: immediate without `contextId`, up to core's ~30s discovery deadline
 * with one. See {@link BlobHookOptions}.
 */
declare function useBlobInfo(blobId?: string | null, options?: BlobHookOptions): {
    info: GetBlobInfoResponseData | null;
    notFound: boolean;
    loading: boolean;
    error: Error | null;
    refetch: () => Promise<void>;
};
/**
 * A blob's bytes as an object URL, ready for `<img src>`, an `<a href>`
 * download, or an `<iframe>`.
 *
 * Lifecycle is handled here so the consumer never has to revoke: the URL is
 * revoked on unmount, and whenever `blobId`/`contextId`/`type` change. `url`
 * goes back to null synchronously on such a change, so a revoked URL is never
 * handed out as the current one — render off `url` and it is always live.
 *
 * A response for a superseded `blobId` is dropped before an object URL is even
 * created, so an out-of-order arrival can neither overwrite the newer result
 * nor leak.
 *
 * Latency: this is the expensive hook. Without `contextId` it is a local read;
 * with one it is discovery (core's ~30s deadline) PLUS the transfer of the
 * bytes. Prefer {@link useBlobInfo} to decide whether the download is worth
 * starting, and always render `loading`.
 *
 * `notFound` marks the node's 404 ("no peer holds this") apart from a
 * transport failure; `error` is set for both.
 */
declare function useBlobUrl(blobId?: string | null, options?: UseBlobUrlOptions): {
    url: string | null;
    notFound: boolean;
    loading: boolean;
    error: Error | null;
    refetch: () => Promise<void>;
};
/**
 * Upload bytes to the node's blob store. Mutation-shaped, like the other
 * write hooks: `uploadBlob` resolves to `{ blobId, size }`, or null when the
 * client is absent or the call failed (read `error` for which).
 *
 * Pass `contextId` to announce the blob to that context, which is what lets
 * the context's other members later discover it with {@link useBlobUrl} /
 * {@link useBlobInfo}. Without it the blob is only readable on this node.
 */
declare function useUploadBlob(): {
    uploadBlob: (request: UploadBlobRequest) => Promise<_calimero_network_mero_js.BlobInfo | null>;
    loading: boolean;
    error: Error | null;
};

/**
 * Storage utilities for mero-react
 *
 * Provides localStorage-based token storage and other persistence utilities.
 */

declare const localStorageTokenStorage: {
    get(): Promise<TokenData | null>;
    set(token: TokenData): Promise<void>;
    clear(): Promise<void>;
};
/**
 * Get the stored node URL
 */
declare function getNodeUrl(): string | null;
/**
 * Set the node URL
 */
declare function setNodeUrl(url: string): void;
/**
 * Clear the node URL
 */
declare function clearNodeUrl(): void;
/**
 * Get the node URL that minted the token bundle currently in the TokenStore.
 */
declare function getTokenNodeUrl(): string | null;
/**
 * Record the node URL that minted the token bundle now in the TokenStore.
 */
declare function setTokenNodeUrl(url: string): void;
/**
 * Clear the token bundle's node URL
 */
declare function clearTokenNodeUrl(): void;
/**
 * Get the stored application ID
 */
declare function getApplicationId(): string | null;
/**
 * Set the application ID
 */
declare function setApplicationId(id: string): void;
/**
 * Clear the application ID
 */
declare function clearApplicationId(): void;
/**
 * Get the stored context ID
 */
declare function getContextId(): string | null;
/**
 * Set the context ID
 */
declare function setContextId(id: string): void;
/**
 * Clear the context ID
 */
declare function clearContextId(): void;
/**
 * Get the stored context identity
 */
declare function getContextIdentity(): string | null;
/**
 * Set the context identity
 */
declare function setContextIdentity(id: string): void;
/**
 * Clear the context identity
 */
declare function clearContextIdentity(): void;
/**
 * Clear all mero-react storage
 */
declare function clearAllStorage(): void;

/**
 * Is this page running inside a Calimero Desktop (Tauri) window?
 *
 * The desktop opens every app in its own webview, already bound to the node it
 * runs, so the Cloud sign-in (wallet → relay, no node) is the wrong door there:
 * it would leave the desktop's own node behind, and the wallet redirect would
 * navigate the app window off to another origin.
 *
 * Two signals, either is enough:
 * - `__TAURI_INTERNALS__` with a callable `invoke`, which Tauri injects natively
 *   into every webview it creates, remote URLs included;
 * - `__TAURI_FETCH_PROXY_INJECTED__`, the marker the desktop's app-window
 *   init script sets, in case a future Tauri stops exposing the former there.
 *
 * Read at call time and SSR-safe: false whenever there is no `window`.
 */
declare function isDesktopWindow(): boolean;

export { type AccountEnrolment, AccountSignInPanel, type AccountSignInPanelProps, type AppContext, AppMode, type ApplicationContextRecord, type BlobHookOptions, CalimeroLogo, type CalimeroLogoProps, type CapturedInvitation, ConnectButton, ConnectButtonAccount, type ConnectButtonAccountProps, type ConnectButtonProps, ConnectionType, type ContextDiscoveryOptions, type ContextDiscoveryState, type CreatePrivateContextRequest, type CustomConnectionConfig, DEFAULT_MIGRATION_POLL_INTERVAL_MS, type ExecutionResult, INVITATION_PARAM, INVITATION_READY_MS, InvitationDialog, type InvitationDialogProps, type InvitationDialogStage, InvitationGate, type InvitationGateProps, type InviteRedemption, type InviteState, JOIN_ACTION, JOIN_SYNC_MAX_MS, JOIN_SYNC_POLL_MS, JOIN_SYNC_WATCHDOG_MS, type JoinFailureReason, type JoinInvitationInput, type JoinInvitationResult, type JoinInvitationStep, JoinSyncBanner, type JoinSyncBannerProps, type JoinSyncOptions, type JoinSyncState, LoginModal, type LoginModalProps, type LoginModalTab, MAX_AUTO_JOIN_ATTEMPTS, MERO_CSS_VARS, type MeroCapabilities, MeroContext, type MeroContextValue, MeroProvider, type MeroProviderConfig, type MeroProviderProps, type MeroTheme, MigrationAdminPanel, type MigrationAdminPanelProps, MigrationPendingBanner, type MigrationPendingBannerProps, type MutationOptions, type ParsedInvitation, type ResolvedMeroTheme, type SetMetadataInput, type SubscriptionEventData, type SubscriptionInput, type UseAccountEnrolmentOptions, type UseBlobUrlOptions, type UseDelegatedBootstrapOptions, type UseDelegatedBootstrapResult, type UseEphemeralOptions, type UseEphemeralResult, type UseInviteRedemptionOptions, buildInviteLink, clearAllStorage, clearApplicationId, clearContextId, clearContextIdentity, clearNamespaceJustJoined, clearNodeUrl, clearTokenNodeUrl, cssVar, defaultMeroTheme, describeInviteFailure, getApplicationId, getContextId, getContextIdentity, getNodeUrl, getPermissionsForMode, getTokenNodeUrl, invitationFromRaw, isDesktopWindow, isFinalInvitationError, isNamespaceJustJoined, isReturningFromWallet, localStorageTokenStorage, markNamespaceJustJoined, onInvitation, peekInvitation, primeInvitationCapture, resetInvitationCaptureForTests, resolveMeroTheme, setApplicationId, setContextId, setContextIdentity, setNodeUrl, setTokenNodeUrl, subscribeInvitation, subscribeJustJoined, themeToCssVars, urlWithoutInvitation, useAccountEnrolment, useAddGroupMembers, useAppVersion, useApplicationContexts, useBlobInfo, useBlobUrl, useContextDiscovery, useContextGroup, useContexts, useCreateContext, useCreateGroupInNamespace, useCreateNamespace, useCreateNamespaceInvitation, useCreatePrivateContext, useDefaultCapabilities, useDelegatedBootstrap, useDeleteContext, useDeleteGroup, useDeleteNamespace, useDetachContextFromGroup, useEphemeral, useExecute, useGroupAppVersion, useGroupCapabilities, useGroupContexts, useGroupInfo, useGroupInvitations, useGroupMembers, useGroupMetadata, useGroupUpgradeStatus, useInstallFromRegistry, useInviteRedemption, useJoinContext, useJoinGroup, useJoinInvitation, useJoinNamespace, useJoinSubgroupInheritance, useJoinSync, useLatestVersion, useMemberMetadata, useMero, useMigrationEvents, useMigrationStatus, useMyAuthoredMigration, useNamespace, useNamespaceGroups, useNamespaces, useNamespacesForApplication, useNodeIdentity, usePendingInvitation, useRedeemInvitation, useRemoveGroupMembers, useReparentGroup, useResyncContext, useRetryGroupUpgrade, useSetContextMetadata, useSetDefaultCapabilities, useSetGroupMetadata, useSetMemberMetadata, useSetSubgroupVisibility, useSetTeeAdmissionPolicy, useSubgroupVisibility, useSubgroups, useSubscription, useSyncGroup, useUpdateMemberRole, useUpgradeGroup, useUploadBlob };

/**
 * v1's login session (mero-js `DelegatedSession`). The combined entry exports
 * mero-react's account-session alias under that name, so this keeps the login
 * one reachable for the code that meant it.
 */
export type { DelegatedSession as DelegatedLoginSession } from './mero-js/login/index.js';

/** release-v2: what the cloud adds to the v1 surface (see src/backend.ts). */
export { CloudAdmin, CloudEvents, CloudMero, CloudRpc, DEFAULT_REGISTRY_URL, LocalEphemeral, NotOnCloudError, PACKAGE_PREFIX, classify, configureCloud, contextIdOf, createCloudAdmin, currentApplicationId, currentContextId, defaultClusterUrl, ensureBundle, ensurePackage, groupIdOf, invitationOf, latestRegistryVersion, mockQuotesAllowed, packageApplicationId, parseGroupId, parsePackageApplicationId, readSession, setCurrentApplicationId, setCurrentContextId, tokenOf, writeSession } from './cloud/backend.js';
