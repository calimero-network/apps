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
        do {
            try await client.auth.login(nodeUrl: nodeUrl, username: username, password: password)
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

    public func logout() {
        store?.stop()
        client.logout()
        service = nil
        store = nil
        phase = .loggedOut
    }
}
