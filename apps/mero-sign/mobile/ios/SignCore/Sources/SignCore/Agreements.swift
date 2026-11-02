import Foundation
import MeroKit

/// An agreement: an app instance in a workspace (a Calimero organization).
/// (The web's `AgreementRow`.)
public struct AgreementRef: Hashable, Identifiable, Sendable {
    public let namespaceId: String
    public let workspaceName: String
    /// The app instance id (the same as ``contextId``: v1 told a subgroup and its context apart).
    public let agreementId: String
    public let name: String
    public let contextId: String

    public var id: String { contextId }

    public init(namespaceId: String, workspaceName: String, agreementId: String, name: String, contextId: String) {
        self.namespaceId = namespaceId
        self.workspaceName = workspaceName
        self.agreementId = agreementId
        self.name = name
        self.contextId = contextId
    }
}

/// How long and how often to wait on a freshly joined agreement.
public struct SyncTiming: Sendable {
    public var enterAttempts: Int
    public var stateAttempts: Int
    public var registerAttempts: Int
    public var delay: Duration

    public init(enterAttempts: Int = 45, stateAttempts: Int = 12, registerAttempts: Int = 5, delay: Duration = .seconds(2)) {
        self.enterAttempts = enterAttempts
        self.stateAttempts = stateAttempts
        self.registerAttempts = registerAttempts
        self.delay = delay
    }

    /// No waiting, for tests.
    public static let immediate = SyncTiming(enterAttempts: 3, stateAttempts: 3, registerAttempts: 3, delay: .zero)
}

/// Workspaces and the agreements in them, and entering one the way the web
/// app does (`app/src/lib/agreements.ts`: `listAgreements`, `enterAgreement`).
public struct AgreementDirectory: Sendable {
    public let backend: any MeroAppBackend
    public let admin: any SignAdmin
    public let store: PrivateStore
    public let timing: SyncTiming

    public init(backend: any MeroAppBackend, admin: any SignAdmin, store: PrivateStore, timing: SyncTiming = SyncTiming()) {
        self.backend = backend
        self.admin = admin
        self.store = store
        self.timing = timing
    }

    public func client(_ contextId: String) -> SignClient {
        SignClient.make(contract: backend.contract, contextId: contextId)
    }

    /// The account's workspaces (organizations of this app), by name.
    public func workspaces() async throws -> [AppNamespace] {
        try await backend.listNamespaces()
            .sorted { Self.name(of: $0).localizedCaseInsensitiveCompare(Self.name(of: $1)) == .orderedAscending }
    }

    /// The agreements in a workspace: Mero Sign's app instances in that organization, by name.
    public func agreements(in workspace: AppNamespace) async throws -> [AgreementRef] {
        try await admin.instances()
            .filter { $0.org == workspace.id }
            .map {
                AgreementRef(
                    namespaceId: workspace.id, workspaceName: Self.name(of: workspace), agreementId: $0.appId,
                    name: Self.agreementName($0.name, id: $0.appId), contextId: $0.appId)
            }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    /// Every agreement in every workspace.
    public func allAgreements() async throws -> [AgreementRef] {
        let workspaces = try await workspaces()
        let instances = try await admin.instances()
        return workspaces.flatMap { workspace in
            instances.filter { $0.org == workspace.id }.map {
                AgreementRef(
                    namespaceId: workspace.id, workspaceName: Self.name(of: workspace), agreementId: $0.appId,
                    name: Self.agreementName($0.name, id: $0.appId), contextId: $0.appId)
            }
        }
    }

    /// Whether the account is on the agreement's roster (the web's `joined`):
    /// opened before, so its documents are the account's to sign or read.
    public func isJoined(_ contextId: String) async -> Bool {
        guard let roster = try? await client(contextId).listParticipants() else { return false }
        return roster.contains { SignIds.same($0, backend.account) }
    }

    // MARK: Entering

    /// Check the account reaches the agreement. On Calimero 1.0 every member of
    /// the workspace reaches its agreements; there is nothing to join.
    public func enter(_ contextId: String) async throws {
        for attempt in 0..<max(timing.enterAttempts, 1) {
            if attempt > 0 { try await Task.sleep(for: timing.delay) }
            if (try? await backend.isMember(contextId: contextId)) == true { return }
        }
        throw SignModelError.message("Your account can't open that agreement. Ask whoever invited you to check your workspace role.")
    }

    /// Everything after entering, as the web's `enterAgreement`: read the
    /// agreement's name, register as a signer if not on the roster
    /// (`registerSelfAsParticipant`; a guest or a removed account is refused
    /// and may still read), then record the agreement and the identity it was
    /// joined with in the private library (`joinSharedContext` → `IdentityMapping`).
    ///
    /// Returns the agreement's name as every node sees it.
    @discardableResult
    public func settle(contextId: String, nameHint: String?) async -> String {
        let contractName = await waitForState(contextId)
        await registerSelf(contextId)
        let name = Self.resolveName(fromContract: contractName, fromInvitation: nameHint, contextId: contextId)
        await store.record(agreementContextId: contextId, sharedIdentity: backend.account, name: name)
        return name
    }

    /// The contract's `context_name`, once the context answers.
    func waitForState(_ contextId: String) async -> String? {
        for attempt in 0..<max(timing.stateAttempts, 1) {
            if attempt > 0 { try? await Task.sleep(for: timing.delay) }
            do {
                return try await client(contextId).getContextDetails(contextIdStr: contextId).contextName
            } catch {
                if !SignErrorText.isSyncing(error) { return nil }
            }
        }
        return nil
    }

    /// On the roster already, or `Conflict` / `Forbidden`, is done; a failure that isn't syncing stops.
    func registerSelf(_ contextId: String) async {
        if let roster = try? await client(contextId).listParticipants(),
            roster.contains(where: { SignIds.same($0, backend.account) })
        {
            return
        }
        for attempt in 0..<max(timing.registerAttempts, 1) {
            if attempt > 0 { try? await Task.sleep(for: timing.delay) }
            do {
                try await client(contextId).registerSelfAsParticipant()
                return
            } catch {
                if SignErrorText.isConflict(error) || SignErrorText.isForbidden(error) { return }
                if !SignErrorText.isSyncing(error) { return }
            }
        }
    }

    // MARK: Names

    public static func name(of workspace: AppNamespace) -> String {
        if let name = workspace.name?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty { return name }
        return "Workspace \(workspace.id.prefix(8))…"
    }

    static func agreementName(_ name: String?, id: String) -> String {
        if let name = name?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty { return name }
        return "Agreement \(id.prefix(8))…"
    }

    /// The contract's name wins: it is the value every node agrees on. The
    /// invitation's is the inviter's own words, used while the context syncs
    /// (`resolveAgreementName`).
    public static func resolveName(fromContract: String?, fromInvitation: String?, contextId: String) -> String {
        for candidate in [fromContract, fromInvitation] {
            if let value = candidate?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty { return value }
        }
        return "Agreement \(contextId.prefix(8))…"
    }
}
