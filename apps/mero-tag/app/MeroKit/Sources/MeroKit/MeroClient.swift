import Foundation

/// Top-level entry point. Holds the token store and exposes the RPC, admin,
/// auth, and SSE sub-clients. Construct one per app and inject it everywhere.
///
/// ```swift
/// let client = MeroClient()                 // Keychain-backed in the app
/// try await client.auth.login(nodeUrl: "http://…", username: "admin", password: "…")
/// let trackers: [Tracker] = try await client.rpc.execute(
///     contextId: ctx, method: "get_trackers", args: RpcClient.NoArgs())
/// for await event in client.sse.events(contexts: [ctx]) { … }
/// ```
public final class MeroClient {
    public let store: TokenStore
    public let rpc: RpcClient
    public let admin: AdminApi
    public let auth: AuthApi
    public let sse: SseClient
    public let blobs: BlobApi

    public init(store: TokenStore = KeychainTokenStore(), session: URLSession = .shared) {
        self.store = store
        self.rpc = RpcClient(store: store, session: session)
        self.admin = AdminApi(store: store, session: session)
        self.auth = AuthApi(store: store, session: session)
        self.sse = SseClient(store: store, session: session)
        self.blobs = BlobApi(store: store, session: session)
    }

    public var isConfigured: Bool {
        (store.nodeUrl?.isEmpty == false) && (store.accessToken?.isEmpty == false)
    }

    public func logout() {
        store.clear()
    }
}
