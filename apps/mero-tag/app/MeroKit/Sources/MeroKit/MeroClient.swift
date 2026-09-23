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
    /// One authority for the whole client, deliberately. Access tokens expire
    /// after an hour and `POST /auth/refresh` is single-use — two sub-clients
    /// refreshing independently would replay a consumed refresh token, which
    /// core reads as theft and answers by revoking the entire family. Sharing it
    /// is what makes the refresh single-flight across RPC, admin, blobs and SSE.
    public let authority: SessionAuthority
    public let rpc: RpcClient
    public let admin: AdminApi
    public let auth: AuthApi
    public let sse: SseClient
    public let blobs: BlobApi

    public init(store: TokenStore = KeychainTokenStore(), session: URLSession = .shared) {
        let authority = SessionAuthority(store: store, session: session)
        self.store = store
        self.authority = authority
        self.rpc = RpcClient(store: store, session: session, authority: authority)
        self.admin = AdminApi(store: store, session: session, authority: authority)
        self.auth = AuthApi(store: store, session: session, authority: authority)
        self.sse = SseClient(store: store, session: session, authority: authority)
        self.blobs = BlobApi(store: store, session: session, authority: authority)
    }

    public var isConfigured: Bool {
        (store.nodeUrl?.isEmpty == false) && (store.accessToken?.isEmpty == false)
    }

    /// Called once when the node has ended the session for good — a revoked
    /// token family, a replayed refresh, a grant the token does not carry. The
    /// credentials are already cleared by the time this runs; the app's job is
    /// to show the login screen rather than a frozen one.
    public func onSessionEnded(_ handler: (@Sendable (AuthFailure) -> Void)?) async {
        await authority.setSessionEndedHandler(handler)
    }

    public func logout() {
        store.clear()
        Task { await authority.reset() }
    }
}
