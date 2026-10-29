import Foundation
import MeroKit

/// An agreement: a subgroup of a workspace (namespace) with one context.
/// (The web's `AgreementRow`.)
public struct AgreementRef: Hashable, Identifiable, Sendable {
    public let namespaceId: String
    public let workspaceName: String
    /// The subgroup id.
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
/// app's invitation flow does (`enterAgreement` + `settleIntoAgreement`).
public struct AgreementDirectory: Sendable {
    public let backend: any MeroAppBackend
    public let store: PrivateStore
    public let timing: SyncTiming

    public init(backend: any MeroAppBackend, store: PrivateStore, timing: SyncTiming = SyncTiming()) {
        self.backend = backend
        self.store = store
        self.timing = timing
    }

    public func client(_ contextId: String) -> SignClient {
        SignClient.make(contract: backend.contract, contextId: contextId)
    }

    /// The account's workspaces, without the personal namespace (it holds the
    /// private store and is never a workspace — `listWorkspaces`).
    public func workspaces() async throws -> [AppNamespace] {
        var out: [AppNamespace] = []
        for namespace in try await backend.listNamespaces() where !(await store.isPersonal(namespace.id)) {
            out.append(namespace)
        }
        return out.sorted { Self.name(of: $0).localizedCaseInsensitiveCompare(Self.name(of: $1)) == .orderedAscending }
    }

    /// The agreements in a workspace that have a context.
    public func agreements(in workspace: AppNamespace) async throws -> [AgreementRef] {
        try await backend.listSubgroups(namespaceId: workspace.id).compactMap { subgroup in
            guard let contextId = subgroup.contextIds.first else { return nil }
            return AgreementRef(
                namespaceId: workspace.id, workspaceName: Self.name(of: workspace),
                agreementId: subgroup.groupId,
                name: Self.agreementName(subgroup.name, id: subgroup.groupId),
                contextId: contextId)
        }
    }

    /// Every agreement in every workspace.
    public func allAgreements() async throws -> [AgreementRef] {
        var out: [AgreementRef] = []
        for workspace in try await workspaces() {
            out += (try? await agreements(in: workspace)) ?? []
        }
        return out
    }

    // MARK: Entering

    /// Enter an agreement's context, joining its open subgroup if needed,
    /// retried while a fresh workspace membership projects (`enterAgreement`).
    public func enter(_ contextId: String) async throws {
        for attempt in 0..<max(timing.enterAttempts, 1) {
            if attempt > 0 { try await Task.sleep(for: timing.delay) }
            if (try? await backend.isMember(contextId: contextId)) == true { return }
            if (try? await backend.joinContext(contextId: contextId)) != nil { return }
        }
        throw SignModelError.message(
            "Your account isn't in that agreement yet. If you were just invited, the workspace may still be syncing — try again shortly.")
    }

    /// Everything after entering, as the web's `settleIntoAgreement`: wait for
    /// state, register as a participant (`register_self_as_participant`, which
    /// grants Sign to the caller's own account and nobody else), settle on the
    /// name, then record the agreement and the identity it was joined with in
    /// the private context (`join_shared_context` → `IdentityMapping`).
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

    /// "Already registered" is success; a failure that isn't syncing stops.
    func registerSelf(_ contextId: String) async {
        for attempt in 0..<max(timing.registerAttempts, 1) {
            if attempt > 0 { try? await Task.sleep(for: timing.delay) }
            do {
                try await client(contextId).registerSelfAsParticipant()
                return
            } catch {
                let text = SignErrorText.message(error)
                if text.localizedCaseInsensitiveContains("already registered") { return }
                if !SignErrorText.isSyncing(text) { return }
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
