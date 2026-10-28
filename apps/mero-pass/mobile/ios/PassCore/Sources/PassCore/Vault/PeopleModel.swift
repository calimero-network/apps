import Foundation

/// A vault's people and the devices holding its key (the web's `VaultPeople`):
/// roles, removal, revocation, the newcomers' role and key rotation. Removing
/// someone or revoking a device as an Admin rotates the key, so nothing
/// written afterwards is readable to them. (Kotlin `PeopleModel`.)
@MainActor
public final class PeopleModel: ObservableObject {
    @Published public private(set) var members: [MemberRecord] = []
    @Published public private(set) var devices: [DeviceRecord] = []
    @Published public private(set) var phase: LoadPhase = .loading
    /// What a long action is doing ("Rotating…", "Re-encrypting 3 of 9…").
    @Published public private(set) var status: String?
    @Published public var error: String?

    public let session: VaultSession
    public let api: any VaultScreenAPI

    public init(session: VaultSession, api: any VaultScreenAPI) {
        self.session = session
        self.api = api
    }

    public static let roleHelp: [Role: String] = [
        .admin: "can change roles, rotate the key and permanently delete",
        .editor: "can add, edit and trash secrets",
        .viewer: "can read, cannot change anything",
        .pending: "registered a device, not let in yet",
        .removed: "removed, will not be let back in automatically",
    ]

    public func load() async {
        do {
            async let m = api.listMembers()
            async let d = api.listDevices()
            let (members, devices) = try await (m, d)
            self.members = members.sorted { order($0.role) < order($1.role) || order($0.role) == order($1.role) && $0.account < $1.account }
            self.devices = devices
            phase = .loaded
        } catch {
            phase = members.isEmpty ? .failed(PassErrorText.describe(error)) : .loaded
        }
    }

    private func order(_ role: Role) -> Int {
        switch role {
        case .admin: return 0
        case .editor: return 1
        case .viewer: return 2
        case .pending: return 3
        case .removed: return 4
        }
    }

    private func act(_ label: String, _ body: () async throws -> String?) async -> Bool {
        error = nil
        status = label
        do {
            status = try await body()
            await load()
            return true
        } catch {
            status = nil
            self.error = PassErrorText.describe(error)
            return false
        }
    }

    @discardableResult
    public func setRole(_ account: String, to role: Role) async -> Bool {
        await act("Changing role…") {
            try await api.setRole(account: account, role: role)
            return nil
        }
    }

    /// Remove someone and rotate, so nothing written afterwards reaches them.
    @discardableResult
    public func remove(_ account: String) async -> Bool {
        await act("Removing and rotating…") {
            try await api.removeMember(account: account)
            try await session.refreshKeys()
            _ = try await session.rotate(allowed: nil)
            return "Removed. The vault key was rotated."
        }
    }

    /// Revoke a device. An Admin's revocation also rotates the key.
    @discardableResult
    public func revoke(_ device: DeviceRecord) async -> Bool {
        await act("Revoking…") {
            try await api.revokeDevice(fingerprint: device.fingerprint)
            if await session.isAdmin {
                try await session.refreshKeys()
                _ = try await session.rotate(allowed: nil)
                return "Revoked. The vault key was rotated."
            }
            return "Revoked."
        }
    }

    @discardableResult
    public func setDefaultRole(_ role: Role) async -> Bool {
        await act("Saving…") {
            try await api.setDefaultRole(role)
            try await session.refreshKeys()
            return nil
        }
    }

    @discardableResult
    public func rotate() async -> Bool {
        await act("Rotating the vault key and re-encrypting…") {
            let n = try await session.rotate(allowed: nil) { [weak self] done, total in
                Task { @MainActor in self?.status = "Re-encrypting \(done) of \(total)…" }
            }
            return "Rotated. \(n) secret\(n == 1 ? "" : "s") re-encrypted."
        }
    }

    public func clearStatus() { status = nil }
}
