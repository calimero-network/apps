import Foundation
import MeroKit

/// Session state: owns the `Mero` client and, once connected, the service +
/// scene store for the active room.
///
/// Login goes through the shared SDK, so this app inherits its single-flight
/// token refresh and reactive 401→refresh retry — a session no longer dies when
/// the access token expires mid-scan.
@MainActor
public final class AppState: ObservableObject {
    public enum Phase { case loggedOut, connecting, inRoom }

    @Published public var phase: Phase = .loggedOut
    @Published public var username = ""
    @Published public var loginError: String?
    @Published public var isLoggingIn = false
    /// Last session's connection details, so the login card comes up prefilled.
    @Published public var lastNodeURL: String
    @Published public var lastRoomId: String

    public private(set) var mero: Mero?
    public private(set) var service: MeroARService?
    public private(set) var store: SceneStore?

    /// Tokens live in this app's own Keychain service. The vendored client used
    /// `network.calimero.merotag`, which made Mero AR and Mero Tag fight over one
    /// set of tokens whenever both were installed on a device.
    private let tokenStore: any TokenStore
    private let defaults: UserDefaults

    private enum Key {
        static let nodeURL = "meroar.nodeURL"
        static let roomId = "meroar.roomId"
        static let username = "meroar.username"
    }

    public init(
        tokenStore: any TokenStore = KeychainTokenStore(service: "network.calimero.meroar"),
        defaults: UserDefaults = .standard
    ) {
        self.tokenStore = tokenStore
        self.defaults = defaults
        self.lastNodeURL = defaults.string(forKey: Key.nodeURL) ?? "http://localhost:2450"
        self.lastRoomId = defaults.string(forKey: Key.roomId) ?? ""
        self.username = defaults.string(forKey: Key.username) ?? ""
    }

    /// True when a stored token bundle + room could restore a session without
    /// asking for a password.
    public var canResume: Bool {
        tokenStore.getTokens() != nil && !lastRoomId.isEmpty && URL(string: lastNodeURL)?.scheme != nil
    }

    // ── Login / resume ────────────────────────────────────────────────────────

    /// No setup code. core#3276/#3277 (0.11.0-rc.17) deleted the first-login
    /// bootstrap secret this used to carry: the admin account is created at
    /// `merod init` now, so there is no "very first login" state left for a
    /// secret to unlock. core still parses the key, only to discard it, and
    /// `Credentials` in the SDK has no third field to put it in.
    public func login(
        nodeUrl: String, username: String, password: String, contextId: String
    ) async {
        guard let base = URL(string: trim(nodeUrl)), base.scheme != nil else {
            loginError = "Enter a valid node URL (e.g. http://localhost:2450)."
            return
        }
        guard !username.isEmpty, !password.isEmpty else {
            loginError = "Username and password are required."
            return
        }
        guard !contextId.isEmpty else {
            loginError = "Paste an invite, or enter the room id to join."
            return
        }

        isLoggingIn = true
        loginError = nil
        defer { isLoggingIn = false }

        let client = Mero(config: MeroConfig(baseURL: base, tokenStore: tokenStore))
        do {
            _ = try await client.authenticate(Credentials(username: username, password: password))
            // The one field takes either a room id or an invitation. An
            // invitation has to be redeemed on this node first — join the
            // namespace and wait for the room to sync — which yields the context
            // id the rest of the flow expects. Everything downstream is unchanged.
            let room: String
            if let invite = RoomInvite.decode(pasted: contextId) {
                room = try await MeroARService.redeem(invite, mero: client)
            } else {
                room = contextId
            }
            try await enterRoom(
                client: client, nodeUrl: trim(nodeUrl), contextId: room, username: username)
        } catch {
            loginError = message(for: error)
        }
    }

    /// Re-enter the last room using the stored token bundle. A stale access token
    /// is refreshed by the SDK on the first 401; only a revoked session falls back
    /// to the login card.
    public func resume() async {
        guard canResume, let base = URL(string: lastNodeURL) else { return }
        phase = .connecting
        let client = Mero(config: MeroConfig(baseURL: base, tokenStore: tokenStore))
        do {
            try await enterRoom(
                client: client, nodeUrl: lastNodeURL, contextId: lastRoomId,
                username: username.isEmpty ? "guest" : username)
        } catch {
            // Don't shout at someone who never asked to log in — just show the card.
            phase = .loggedOut
            if case MeroError.authRevoked = error { tokenStore.clear() }
        }
    }

    private func enterRoom(client: Mero, nodeUrl: String, contextId: String, username: String) async throws {
        // Two steps, because they answer different questions: the first proves
        // this node is in the context at all (and joins if an invitation was
        // never opened here), the second asks the room which ACCOUNT it will see
        // our writes as. Since rc.23 those are not the same value.
        try await MeroARService.ensureIdentity(mero: client, contextId: contextId)
        let memberId = try await MeroARService.whoami(mero: client, contextId: contextId)
        let service = MeroARService(mero: client, contextId: contextId, memberId: memberId)
        let store = SceneStore(service: service)

        self.mero = client
        self.service = service
        self.store = store
        self.username = username
        self.lastNodeURL = nodeUrl
        self.lastRoomId = contextId
        defaults.set(nodeUrl, forKey: Key.nodeURL)
        defaults.set(contextId, forKey: Key.roomId)
        defaults.set(username, forKey: Key.username)
        self.phase = .inRoom
        await store.bootstrap(username: username)
    }

    public func leave() {
        store?.stop()
        let client = mero
        Task { await client?.logout() }
        mero = nil
        service = nil
        store = nil
        phase = .loggedOut
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private func trim(_ value: String) -> String {
        var text = value.trimmingCharacters(in: .whitespacesAndNewlines)
        while text.hasSuffix("/") { text.removeLast() }
        return text
    }

    /// Short, user-facing message — the SDK's error cases carry enough to tell a
    /// bad password from an unreachable node.
    private func message(for error: Error) -> String {
        switch error {
        case MeroError.authRevoked:
            return "That session was revoked — sign in again."
        case MeroError.authenticationFailed:
            return "Login failed — check the username and password."
        case MeroError.network(let detail):
            return "Can't reach the node: \(detail)"
        case MeroARError.noIdentity:
            return MeroARError.noIdentity.errorDescription ?? "No identity in that room."
        default:
            if let urlError = error as? URLError { return "Can't reach the node (\(urlError.code))." }
            return (error as? LocalizedError)?.errorDescription ?? "Something went wrong."
        }
    }
}
