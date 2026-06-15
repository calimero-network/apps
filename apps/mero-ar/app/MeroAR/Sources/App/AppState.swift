import Foundation
import MeroKit

/// Session state: holds the MeroKit client and, once connected, the service +
/// scene store for the active room. Context id is entered at login (printed by
/// `make node`); later phases add in-app room create/join.
@MainActor
public final class AppState: ObservableObject {
    public enum Phase { case loggedOut, inRoom }

    @Published public var phase: Phase = .loggedOut
    @Published public var username = ""
    @Published public var loginError: String?
    @Published public var isLoggingIn = false

    public let client: MeroClient
    public private(set) var service: MeroARService?
    public private(set) var store: SceneStore?

    public init(client: MeroClient = MeroClient()) { self.client = client }

    public func login(nodeUrl: String, username: String, password: String, contextId: String) async {
        isLoggingIn = true; loginError = nil
        defer { isLoggingIn = false }
        do {
            try await client.auth.login(nodeUrl: nodeUrl, username: username, password: password)
            let service = MeroARService(client: client, contextId: contextId, memberId: username)
            let store = SceneStore(service: service)
            self.username = username
            self.service = service
            self.store = store
            self.phase = .inRoom
            await store.bootstrap(username: username)
        } catch {
            loginError = error.localizedDescription
        }
    }

    public func leave() {
        store?.stop()
        client.logout()
        service = nil; store = nil
        phase = .loggedOut
    }
}
