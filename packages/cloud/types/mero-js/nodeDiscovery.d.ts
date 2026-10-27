/**
 * Local-node discovery.
 *
 * Calimero dev/desktop nodes expose a public, unauthenticated health endpoint
 * at `GET {nodeUrl}/admin-api/health` that returns `{ "data": { "status":
 * "alive" } }`. The most common local layouts run on a small, well-known set of
 * ports, so instead of forcing the user to type a URL we probe those ports and
 * offer whatever is actually running.
 */
/**
 * Default ports probed when discovering local nodes. Covers the two-node dev
 * stacks used across the Calimero apps (RPC + alt ports for node1 / node2).
 */
export declare const DEFAULT_LOCAL_NODE_PORTS: readonly [2428, 2429, 2528, 2529];
export interface DiscoverLocalNodesOptions {
    /** Ports to probe. Defaults to {@link DEFAULT_LOCAL_NODE_PORTS}. */
    ports?: readonly number[];
    /** Per-probe timeout in ms. Defaults to 2000. */
    timeoutMs?: number;
    /** Abort the whole discovery (e.g. when the modal closes). */
    signal?: AbortSignal;
}
/** Build the canonical base URL for a local node on the given port. */
export declare function localNodeUrl(port: number): string;
/**
 * Resolve an API `path` against a node `baseUrl`. Ensures the base ends with a
 * slash first, so a base that carries a path prefix (e.g. a `NODE_PATH_PREFIX`
 * deployment like `http://host/node1`) keeps that segment instead of having it
 * stripped by relative URL resolution.
 */
export declare function nodeEndpoint(baseUrl: string, path: string): string;
/**
 * Probe a single node's health endpoint. Resolves `true` only when the node
 * answers with a 2xx and (when the body is JSON) reports a non-dead status.
 * Any network error, timeout, or non-ok response resolves `false` — never
 * throws (except on an external abort, which is swallowed as `false`).
 */
export declare function probeNodeHealth(baseUrl: string, options?: {
    timeoutMs?: number;
    signal?: AbortSignal;
}): Promise<boolean>;
/**
 * Probe the configured local ports in parallel and return the base URLs that
 * responded as healthy, in the same order as the `ports` argument (which
 * defaults to ascending). Returns an empty array when nothing local is running.
 */
export declare function discoverLocalNodes(options?: DiscoverLocalNodesOptions): Promise<string[]>;
