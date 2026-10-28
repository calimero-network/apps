import Foundation
import MeroKit

/// A team: a namespace, the people, and the vaults they share.
public struct TeamRow: Identifiable, Hashable, Sendable {
    public let id: String
    public let name: String
    public let memberCount: Int
    public var vaultCount: Int

    public init(id: String, name: String, memberCount: Int, vaultCount: Int) {
        self.id = id
        self.name = name
        self.memberCount = memberCount
        self.vaultCount = vaultCount
    }
}

/// A vault: a subgroup of a team with one context running the contract.
public struct VaultRow: Identifiable, Hashable, Sendable {
    public let id: String
    public let name: String
    /// `nil` while the vault exists but its context has not replicated yet.
    public let contextId: String?
    public var joined: Bool

    public init(id: String, name: String, contextId: String?, joined: Bool) {
        self.id = id
        self.name = name
        self.contextId = contextId
        self.joined = joined
    }
}

/// Where a vault lives, for navigation.
public struct VaultRef: Hashable, Sendable {
    public let namespaceId: String
    public let teamName: String
    public let vaultId: String
    public let vaultName: String
    public let contextId: String

    public init(namespaceId: String, teamName: String, vaultId: String, vaultName: String, contextId: String) {
        self.namespaceId = namespaceId
        self.teamName = teamName
        self.vaultId = vaultId
        self.vaultName = vaultName
        self.contextId = contextId
    }
}

/// A readable label, given whatever the relay told us (the web's `displayName`).
public func displayName(_ candidates: [String?], id: String, fallback: String) -> String {
    for candidate in candidates {
        if let trimmed = candidate?.nilIfBlank { return trimmed }
    }
    return "\(fallback) \(id.prefix(8))…"
}

/// The teams this account is in. (Kotlin `TeamsModel`; the web's `TeamsPage`.)
@MainActor
public final class TeamsModel: ObservableObject {
    @Published public private(set) var teams: [TeamRow] = []
    @Published public private(set) var phase: LoadPhase = .loading
    @Published public private(set) var isCreating = false

    public let backend: any MeroAppBackend

    public init(backend: any MeroAppBackend) { self.backend = backend }

    public var hasRelay: Bool { backend.hasRelay }

    public func load() async {
        if teams.isEmpty { phase = .loading }
        do {
            let namespaces = try await backend.listNamespaces()
            var rows: [TeamRow] = []
            for ns in namespaces {
                let vaults = (try? await backend.listSubgroups(namespaceId: ns.id).count) ?? 0
                rows.append(
                    TeamRow(
                        id: ns.id, name: displayName([ns.name], id: ns.id, fallback: "Team"),
                        memberCount: ns.memberCount, vaultCount: vaults))
            }
            teams = rows.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
            phase = .loaded
        } catch {
            phase = teams.isEmpty ? .failed(PassErrorText.describe(error)) : .loaded
        }
    }

    /// Start a team named `name`; you become its Admin.
    @discardableResult
    public func create(name: String) async throws -> TeamRow {
        guard let trimmed = name.nilIfBlank else { throw PassModelError.message("Give the team a name.") }
        isCreating = true
        defer { isCreating = false }
        do {
            let founded = try await backend.foundNamespace(name: trimmed)
            let row = TeamRow(id: founded.namespaceId, name: trimmed, memberCount: 1, vaultCount: 0)
            if !teams.contains(where: { $0.id == row.id }) { teams.append(row) }
            await load()
            return teams.first { $0.id == row.id } ?? row
        } catch {
            throw PassModelError.message(PassErrorText.describe(error))
        }
    }

    /// An invitation link to the whole team.
    public func invite(_ team: TeamRow) async throws -> String {
        try await TeamModel.teamInvite(backend: backend, namespaceId: team.id, teamName: team.name)
    }
}

/// The vaults in one team: list, create, enter, invite. (Kotlin `TeamModel`;
/// the web's `TeamPage` + `lib/vaults.ts`.)
@MainActor
public final class TeamModel: ObservableObject {
    @Published public private(set) var vaults: [VaultRow] = []
    @Published public private(set) var phase: LoadPhase = .loading
    @Published public private(set) var isCreating = false
    /// The vault being opened (joined first when needed).
    @Published public private(set) var entering: String?

    public let backend: any MeroAppBackend
    public let namespaceId: String
    public let teamName: String
    public let applicationId: String

    public init(backend: any MeroAppBackend, namespaceId: String, teamName: String, applicationId: String) {
        self.backend = backend
        self.namespaceId = namespaceId
        self.teamName = teamName
        self.applicationId = applicationId
    }

    public func load() async {
        if vaults.isEmpty { phase = .loading }
        do {
            let subgroups = try await backend.listSubgroups(namespaceId: namespaceId)
            var rows: [VaultRow] = []
            for group in subgroups {
                let contextId = group.contextIds.first
                var joined = false
                if let contextId { joined = (try? await backend.isMember(contextId: contextId)) ?? false }
                rows.append(
                    VaultRow(
                        id: group.groupId, name: displayName([group.name], id: group.groupId, fallback: "Vault"),
                        contextId: contextId, joined: joined))
            }
            vaults = rows.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
            phase = .loaded
        } catch {
            phase = vaults.isEmpty ? .failed(PassErrorText.describe(error)) : .loaded
        }
    }

    /// Create a vault everyone in the team can open: an OPEN subgroup with a
    /// context whose `init(name)` stores the name in the contract.
    @discardableResult
    public func create(name: String) async throws -> VaultRef {
        guard let trimmed = name.nilIfBlank else { throw PassModelError.message("Give the vault a name.") }
        guard !applicationId.isEmpty else {
            throw PassModelError.message("Still connecting to Calimero. Try again in a moment.")
        }
        isCreating = true
        defer { isCreating = false }
        do {
            let groupId = try await backend.createSubgroup(namespaceId: namespaceId, name: trimmed, isPublic: true)
            let contextId = try await backend.createContext(
                groupId: groupId, applicationId: applicationId, name: trimmed,
                initArgs: .object(["name": .string(trimmed)]))
            vaults.append(VaultRow(id: groupId, name: trimmed, contextId: contextId, joined: true))
            vaults.sort { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
            return ref(groupId: groupId, name: trimmed, contextId: contextId)
        } catch {
            throw PassModelError.message(PassErrorText.describe(error))
        }
    }

    /// Open a vault, joining its context first when this account is not in it yet.
    public func enter(_ vault: VaultRow) async throws -> VaultRef {
        guard let contextId = vault.contextId else {
            throw PassModelError.message("This vault is still syncing. Try again in a moment.")
        }
        if vault.joined { return ref(groupId: vault.id, name: vault.name, contextId: contextId) }
        entering = vault.id
        defer { entering = nil }
        do {
            if !((try? await backend.isMember(contextId: contextId)) ?? false) {
                try await backend.joinContext(contextId: contextId)
            }
            if let index = vaults.firstIndex(where: { $0.id == vault.id }) { vaults[index].joined = true }
            return ref(groupId: vault.id, name: vault.name, contextId: contextId)
        } catch {
            throw PassModelError.message(PassErrorText.describe(error))
        }
    }

    public func teamInvite() async throws -> String {
        try await Self.teamInvite(backend: backend, namespaceId: namespaceId, teamName: teamName)
    }

    /// A link that lands someone in one vault. The grant is still the whole
    /// team: vault access is inherited from it, and the sheet says so.
    public func vaultInvite(_ vault: VaultRow) async throws -> String {
        try await Self.vaultInvite(
            backend: backend,
            ref: VaultRef(
                namespaceId: namespaceId, teamName: teamName, vaultId: vault.id, vaultName: vault.name,
                contextId: vault.contextId ?? ""))
    }

    public static func teamInvite(backend: any MeroAppBackend, namespaceId: String, teamName: String) async throws
        -> String
    {
        do {
            let signed = try await backend.createInvitation(namespaceId: namespaceId)
            return try PassInvitation(invitation: signed, kind: .team, teamName: teamName).link()
        } catch {
            throw PassModelError.message(PassErrorText.describe(error))
        }
    }

    public static func vaultInvite(backend: any MeroAppBackend, ref: VaultRef) async throws -> String {
        do {
            let signed = try await backend.createInvitation(namespaceId: ref.namespaceId)
            return try PassInvitation(
                invitation: signed, kind: .vault, teamName: ref.teamName, vaultId: ref.vaultId,
                vaultName: ref.vaultName, contextId: ref.contextId.nilIfBlank
            ).link()
        } catch {
            throw PassModelError.message(PassErrorText.describe(error))
        }
    }

    private func ref(groupId: String, name: String, contextId: String) -> VaultRef {
        VaultRef(namespaceId: namespaceId, teamName: teamName, vaultId: groupId, vaultName: name, contextId: contextId)
    }
}

/// Where a redeemed invitation lands: a team, or one vault in it.
public struct InvitationDestination: Equatable, Sendable {
    public let namespaceId: String
    public let teamName: String
    public let vault: VaultRef?
}

/// Redeeming an invitation link: confirm, join the team, and (for a vault
/// invite) join the vault, then say where to go. (Kotlin `InvitationModel`;
/// the web's `InvitationPrompt` + `redeemInvite`.)
@MainActor
public final class InvitationModel: ObservableObject {
    public enum Stage: Equatable {
        case idle
        case confirm(title: String, isVault: Bool, teamName: String)
        case joining(title: String)
        case joined(InvitationDestination)
        case failed(String)
    }

    @Published public private(set) var stage: Stage = .idle
    public private(set) var invitation: PassInvitation?

    private let vaultAttempts: Int
    private let vaultRetryDelay: Duration

    public init(vaultAttempts: Int = 4, vaultRetryDelay: Duration = .milliseconds(1500)) {
        self.vaultAttempts = vaultAttempts
        self.vaultRetryDelay = vaultRetryDelay
    }

    /// Read a link or a pasted code. `false` (and a failed stage) when it is not
    /// a Mero Pass invitation.
    @discardableResult
    public func open(_ raw: String) -> Bool {
        guard let parsed = PassInvitation.parse(raw) else {
            invitation = nil
            stage = .failed("This isn't a Mero Pass invitation. Check the link and try again.")
            return false
        }
        invitation = parsed
        stage = .confirm(title: parsed.title, isVault: parsed.kind == .vault, teamName: parsed.teamName ?? "the team")
        return true
    }

    /// Join. `backend` is read again after `didJoin`, which may hand the
    /// session the admitting relay.
    public func accept(
        backend: @escaping @MainActor () -> (any MeroAppBackend)?,
        didJoin: @escaping @MainActor () async -> Void
    ) async {
        guard let invitation, let current = backend() else {
            stage = .failed("Sign in to join.")
            return
        }
        stage = .joining(title: invitation.title)
        let namespaceId = invitation.namespaceId
        do {
            _ = try await current.joinNamespace(namespaceId: namespaceId, invitation: invitation.invitation)
        } catch {
            let text = "\(error)".lowercased()
            let already = ["already a member", "already member", "already joined", "alreadyjoined", "duplicate member"]
            if !already.contains(where: { text.contains($0) }) {
                stage = .failed(PassErrorText.describe(error))
                return
            }
        }
        await didJoin()
        let teamName = invitation.teamName ?? "Team"
        var vault: VaultRef?
        if invitation.kind == .vault, let contextId = invitation.contextId, let vaultId = invitation.vaultId {
            let ref = VaultRef(
                namespaceId: namespaceId, teamName: teamName, vaultId: vaultId,
                vaultName: invitation.vaultName ?? "Vault", contextId: contextId)
            if await joinVault(contextId: contextId, backend: backend) { vault = ref }
        }
        stage = .joined(InvitationDestination(namespaceId: namespaceId, teamName: teamName, vault: vault))
    }

    private func joinVault(contextId: String, backend: @MainActor () -> (any MeroAppBackend)?) async -> Bool {
        for attempt in 0..<vaultAttempts {
            if attempt > 0 { try? await Task.sleep(for: vaultRetryDelay) }
            guard let current = backend() else { return false }
            if (try? await current.isMember(contextId: contextId)) == true { return true }
            if (try? await current.joinContext(contextId: contextId)) != nil { return true }
        }
        return false
    }

    public func reset() {
        invitation = nil
        stage = .idle
    }
}
