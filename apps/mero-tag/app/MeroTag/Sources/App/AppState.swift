import Foundation
import MeroKit

/// Session-level state: holds the MeroKit client and, once logged in, the
/// active service + store. The context id is currently entered at login (the
/// dev-node script prints it). Later phases add in-app space/context creation.
@MainActor
public final class AppState: ObservableObject {
    public enum Phase { case loggedOut, ready }

    @Published public var phase: Phase = .loggedOut
    @Published public var username: String = ""
    @Published public var loginError: String?
    @Published public var isLoggingIn = false
    /// Why the last session ended, when the node ended it rather than the user.
    /// Shown on the way back to the login screen so a forced logout is not
    /// indistinguishable from the app having been restarted.
    @Published public var sessionNotice: String?

    public let client: MeroClient
    public private(set) var service: MeroService?
    public private(set) var store: TrackerStore?

    public init(client: MeroClient = MeroClient()) {
        self.client = client
        // If we already have a saved session, the app could auto-restore here.
    }

    public func login(nodeUrl: String, username: String, password: String, contextId: String) async {
        isLoggingIn = true
        loginError = nil
        defer { isLoggingIn = false }
        sessionNotice = nil
        do {
            try await client.auth.login(nodeUrl: nodeUrl, username: username, password: password)
            // Access tokens expire after an hour and MeroKit now refreshes them
            // on its own. This handler only runs when the node has ended the
            // session for good — a revoked family, a replayed refresh, a grant
            // the token does not carry — none of which a refresh can undo. The
            // credentials are already gone by the time it fires; all that is
            // left is to stop pretending the map is live.
            await client.onSessionEnded { [weak self] reason in
                Task { @MainActor in self?.sessionEnded(reason) }
            }
            // Member id: use the username for now (matches dev flow). A later
            // phase resolves the real context identity via /identities-owned.
            let memberId = username
            let service = MeroService(client: client, contextId: contextId, memberId: memberId)
            let store = TrackerStore(service: service)
            self.username = username
            self.service = service
            self.store = store
            self.phase = .ready
            await store.bootstrap(username: username)
        } catch {
            loginError = error.localizedDescription
        }
    }

    /// The node ended the session. Unlike `logout()` this leaves a reason
    /// behind, because the user did not ask for it.
    public func sessionEnded(_ reason: AuthFailure) {
        guard phase != .loggedOut else { return }
        sessionNotice = reason.userFacingReason + " Please sign in again."
        logout()
    }

    public func logout() {
        store?.stop()
        client.logout()
        service = nil
        store = nil
        phase = .loggedOut
    }
}
