import Foundation
import MeroKit
import MeroKitUI

/// Session state: owns the Cloud client and, once a room is open, the service
/// and scene store for it.
///
/// Sign-in is Cloud only. ``MeroClient/signInWithCloud(callbackScheme:)`` opens
/// the Calimero wallet in the system auth sheet; the person approves this device
/// with their passkey; the SDK verifies the device certificate, finds the relay
/// that serves the account, and logs in there. There is no node URL and no
/// password anywhere in the app.
@MainActor
public final class AppState: ObservableObject {
    public enum Phase: Equatable { case restoring, signedOut, lobby, inRoom }

    /// The URL scheme the wallet returns to (`meroar://enrol`). Registered in
    /// `project.yml` → `CFBundleURLTypes`.
    public static let callbackScheme = "meroar"

    @Published public private(set) var phase: Phase = .restoring
    /// Display name sent to the room's roster on `join`.
    @Published public var displayName: String
    /// The last room entered, offered as "Continue where you left off".
    @Published public private(set) var lastRoomId: String
    @Published public private(set) var lastRoomName: String
    @Published public private(set) var isEntering = false
    @Published public var roomError: String?

    public let client: MeroClient
    public private(set) var service: MeroARService?
    public private(set) var store: SceneStore?

    private let defaults: UserDefaults

    private enum Key {
        static let roomId = "meroar.roomId"
        static let roomName = "meroar.roomName"
        static let displayName = "meroar.username"
    }

    public init(client: MeroClient? = nil, defaults: UserDefaults = .standard) {
        // Device keys, the Cloud session and the relay tokens live in this app's
        // own Keychain service, so Mero AR never shares a session with another
        // Calimero app installed on the same phone.
        self.client = client ?? MeroClient(cloud: CloudSignIn.keychain(service: "network.calimero.meroar"))
        self.defaults = defaults
        self.lastRoomId = defaults.string(forKey: Key.roomId) ?? ""
        self.lastRoomName = defaults.string(forKey: Key.roomName) ?? ""
        self.displayName = defaults.string(forKey: Key.displayName) ?? ""
    }

    // MARK: - Session

    /// Reconnect a Cloud session from a previous launch, and walk back into the
    /// last room if there was one. Lands on the lobby if the room can't be
    /// reopened, and on sign-in if there is no session.
    public func restore() async {
        guard await client.restoreCloudSession(), client.isAuthenticated else {
            phase = .signedOut
            return
        }
        phase = .lobby
        if !lastRoomId.isEmpty, client.connection?.relay != nil {
            await enter(roomOrInvite: lastRoomId, quiet: true)
        }
    }

    /// "Continue with Calimero".
    public func signIn() async {
        await client.signInWithCloud(callbackScheme: Self.callbackScheme)
        if client.isAuthenticated { phase = .lobby }
    }

    /// A wallet callback delivered by the system (`onOpenURL`) rather than
    /// through the auth sheet.
    public func handle(url: URL) async {
        guard await client.handleEnrolmentCallback(url) else { return }
        if client.isAuthenticated, phase == .signedOut { phase = .lobby }
    }

    public func signOut() async {
        leaveRoom()
        await client.logout()
        phase = .signedOut
    }

    // MARK: - Rooms

    /// The name to join with: what the person typed, else a short account id.
    public var effectiveDisplayName: String {
        let typed = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        if !typed.isEmpty { return typed }
        guard let account = client.account else { return "Guest" }
        return "Guest \(account.prefix(4))"
    }

    /// Enter a room from whatever was pasted: an invitation link, a bare
    /// invitation token, or a room id.
    public func enter(roomOrInvite input: String, quiet: Bool = false) async {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            roomError = "Paste an invite link, or the room's ID."
            return
        }
        isEntering = true
        roomError = nil
        defer { isEntering = false }

        do {
            let contextId: String
            if let invite = RoomInvite.decode(pasted: text) {
                contextId = try await redeem(invite)
                if !invite.roomName.isEmpty { remember(roomName: invite.roomName) }
            } else {
                contextId = text
            }
            guard let connection = client.connection, let relay = connection.relay else {
                throw MeroARError.noRelay
            }
            let service = try await MeroARService.open(
                relay: relay, mero: connection.mero, contextId: contextId,
                account: connection.session.account,
                mintInvitation: MeroARService.cloudMinter(client.cloudSignIn, connection: connection))
            let store = SceneStore(service: service)
            let name = effectiveDisplayName

            self.service = service
            self.store = store
            remember(roomId: contextId, displayName: name)
            phase = .inRoom
            await store.bootstrap(username: name)
            if let roomName = store.room?.name, !roomName.isEmpty { remember(roomName: roomName) }
        } catch {
            if !quiet { roomError = userMessage(error) }
        }
    }

    public func leaveRoom() {
        store?.stop()
        store = nil
        service = nil
        if phase == .inRoom { phase = .lobby }
    }

    /// Redeem an invitation as this account and return the room to enter.
    ///
    /// The SDK resolves the admitting relay through the Cloud manager, signs the
    /// member-join op with this device's certificate, and — for an account with
    /// no relay yet — adopts the admitting relay. Cross-node sync is
    /// asynchronous, so the room is polled for on the relay before entering.
    ///
    /// A refused join is KEPT, not discarded: "already a member" is fine to
    /// continue from, a rejected signature is terminal, and only the room's
    /// absence afterwards tells them apart.
    private func redeem(_ invite: RoomInvite) async throws -> String {
        let hadRelay = client.connection?.relay != nil
        var joinRefusal: Error?
        do {
            _ = try await client.cloudSignIn.join(
                namespaceId: invite.namespaceId, invitation: invite.invitation)
        } catch {
            joinRefusal = error
        }

        // A relayless account just earned a relay: connect to it.
        if !hadRelay { await client.restoreCloudSession() }
        guard let relay = client.connection?.relay else {
            if let joinRefusal { throw MeroARError.invitationRefused(userMessage(joinRefusal)) }
            throw MeroARError.noRelay
        }

        for attempt in 1...8 {
            if (try? await relay.describe(invite.contextId)) != nil { return invite.contextId }
            if attempt < 8 { try? await Task.sleep(nanoseconds: 1_500_000_000) }
        }
        if let joinRefusal { throw MeroARError.invitationRefused(userMessage(joinRefusal)) }
        throw MeroARError.roomNotSynced
    }

    private func remember(roomId: String, displayName: String) {
        if roomId != lastRoomId {
            lastRoomName = ""
            defaults.removeObject(forKey: Key.roomName)
        }
        lastRoomId = roomId
        defaults.set(roomId, forKey: Key.roomId)
        defaults.set(displayName, forKey: Key.displayName)
    }

    private func remember(roomName: String) {
        lastRoomName = roomName
        defaults.set(roomName, forKey: Key.roomName)
    }
}
