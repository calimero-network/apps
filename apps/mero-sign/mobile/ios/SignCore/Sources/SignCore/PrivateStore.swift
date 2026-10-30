import Foundation
import MeroKit

/// A signature in the library, with its PNG when it could be fetched.
public struct SavedSignature: Identifiable, Equatable, Sendable {
    public let id: UInt64
    public let name: String
    public let blobId: String
    public let size: UInt64
    /// Nanoseconds (`env::time_now`).
    public let createdAt: UInt64
    public let png: Data?

    public init(id: UInt64, name: String, blobId: String, size: UInt64, createdAt: UInt64, png: Data?) {
        self.id = id
        self.name = name
        self.blobId = blobId
        self.size = size
        self.createdAt = createdAt
        self.png = png
    }
}

/// Where the private context's id is remembered between launches, as the web
/// keeps it in `localStorage['defaultContext']`. It is checked again before use.
public protocol PrivateContextCache: AnyObject, Sendable {
    func load(account: String) -> String?
    func save(_ contextId: String?, account: String)
}

/// ``PrivateContextCache`` in `UserDefaults`.
public final class DefaultsPrivateContextCache: PrivateContextCache, @unchecked Sendable {
    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    public func load(account: String) -> String? { defaults.string(forKey: "sign.privateContext.\(account)") }

    public func save(_ contextId: String?, account: String) {
        defaults.set(contextId, forKey: "sign.privateContext.\(account)")
    }
}

/// ``PrivateContextCache`` in memory, for tests and previews.
public final class MemoryPrivateContextCache: PrivateContextCache, @unchecked Sendable {
    private var values: [String: String] = [:]
    private let lock = NSLock()

    public init() {}

    public func load(account: String) -> String? {
        lock.lock()
        defer { lock.unlock() }
        return values[account]
    }

    public func save(_ contextId: String?, account: String) {
        lock.lock()
        defer { lock.unlock() }
        values[account] = contextId
    }
}

/// The account's PRIVATE context: its signature library and the registry of
/// the agreements it joined, with the identity it joined each one with
/// (`identity_mappings`). Never shared with anybody.
///
/// Mirrors the web app's `DefaultContextService` + `ensurePersonalWorkspace` +
/// `createPersonalContext`:
///
/// - It lives in an organization of its own, marked by its metadata record
///   (`kind == "mero-sign:personal"`), never found by name.
/// - Inside it, an invite-only team ("Private") holds one app instance whose
///   contract was initialised `{is_private: true, context_name: "default"}`.
/// - A candidate is confirmed with the contract's `is_default_private_context`.
///
/// Created on first need, exactly as the web creates it, so a phone and a
/// browser on the same account share one library.
public actor PrivateStore {
    public let backend: any MeroAppBackend
    public let admin: any SignAdmin
    private let applicationId: String?
    private let cache: PrivateContextCache
    private var contextId: String?
    private var ensuring: Task<String, Error>?

    public init(
        backend: any MeroAppBackend, admin: any SignAdmin, applicationId: String?,
        cache: PrivateContextCache = MemoryPrivateContextCache()
    ) {
        self.backend = backend
        self.admin = admin
        self.applicationId = applicationId
        self.cache = cache
    }

    private func client(_ contextId: String) -> SignClient {
        SignClient.make(contract: backend.contract, contextId: contextId)
    }

    /// The namespace marked as this account's private store, if there is one.
    public func personalNamespace() async throws -> AppNamespace? {
        for namespace in try await backend.listNamespaces() where await isPersonal(namespace.id) {
            return namespace
        }
        return nil
    }

    /// Whether a namespace carries the personal marker. A failed read is "no".
    public func isPersonal(_ namespaceId: String) async -> Bool {
        let record = try? await admin.groupMetadata(namespaceId)
        return record?.data["kind"] == SignConstants.personalKind
    }

    /// The private context, without creating it. Nil when there is none yet.
    public func find() async throws -> String? {
        if let contextId { return contextId }
        if let cached = cache.load(account: backend.account), await isPrivate(cached) {
            contextId = cached
            return cached
        }
        guard let personal = try await personalNamespace() else { return nil }
        var candidates: [String] = []
        for subgroup in try await backend.listSubgroups(namespaceId: personal.id) {
            candidates += subgroup.contextIds
        }
        candidates += (try? await backend.listContexts(groupId: personal.id)) ?? []
        for candidate in candidates where await isPrivate(candidate) {
            remember(candidate)
            return candidate
        }
        return nil
    }

    /// The private context, found or created. One creation at a time: the
    /// web's `globalCreatingFlag`, so two callers never make two stores.
    public func ensure() async throws -> String {
        if let contextId { return contextId }
        if let ensuring { return try await ensuring.value }
        let task = Task { try await self.findOrCreate() }
        ensuring = task
        defer { ensuring = nil }
        return try await task.value
    }

    private func findOrCreate() async throws -> String {
        if let found = try await find() { return found }
        let namespaceId: String
        let appId: String
        if let personal = try await personalNamespace() {
            namespaceId = personal.id
            appId = applicationId ?? personal.applicationId
        } else {
            let founded = try await backend.foundNamespace(name: SignConstants.personalWorkspaceName)
            namespaceId = founded.namespaceId
            // NOT swallowed: the marker IS this namespace's identity. Lost, the
            // next launch would not find it and would start a second library.
            try await admin.setGroupMetadata(
                namespaceId, name: SignConstants.personalWorkspaceName,
                data: ["kind": SignConstants.personalKind])
            appId = try await resolveApplicationId(namespaceId)
        }
        guard !appId.isEmpty else {
            throw SignModelError.message("Mero Sign's application isn't known to your account yet. Try again shortly.")
        }
        // RESTRICTED: the one place that is the wanted answer. Open, anybody
        // admitted to the namespace could reach the library.
        let groupId = try await backend.createSubgroup(
            namespaceId: namespaceId, name: SignConstants.personalGroupName, isPublic: false)
        let created = try await backend.createContext(
            groupId: groupId, applicationId: appId, name: SignConstants.privateContextName,
            initArgs: .object([
                "is_private": .bool(true),
                "context_name": .string(SignConstants.privateContextName),
            ]))
        remember(created)
        return created
    }

    private func resolveApplicationId(_ namespaceId: String) async throws -> String {
        if let applicationId, !applicationId.isEmpty { return applicationId }
        let namespaces = try await backend.listNamespaces()
        return namespaces.first { $0.id == namespaceId }?.applicationId
            ?? namespaces.first?.applicationId ?? ""
    }

    private func isPrivate(_ contextId: String) async -> Bool {
        (try? await client(contextId).isDefaultPrivateContext()) == true
    }

    private func remember(_ id: String) {
        contextId = id
        cache.save(id, account: backend.account)
    }

    // MARK: - Identity mapping

    /// Record an agreement in the private registry with the identity this
    /// account holds in it (`join_shared_context`, which also writes the
    /// `IdentityMapping`): the web's last step after entering an agreement.
    ///
    /// On Calimero 1.0 the identity is the account itself (there are no
    /// devices: `env::account_id() == executor_id()`), so private and shared
    /// identity are the same key, exactly as the web records them for an
    /// account session.
    ///
    /// Best-effort, as on the web: "Already joined this context" is the normal
    /// answer the second time, and a failure must not keep anybody out of an
    /// agreement they were invited to sign.
    @discardableResult
    public func record(agreementContextId: String, sharedIdentity: String, name: String) async -> Bool {
        guard !sharedIdentity.isEmpty else { return false }
        do {
            let store = try await ensure()
            try await client(store).joinSharedContext(
                contextIdStr: agreementContextId, sharedIdentityStr: sharedIdentity, contextName: name)
            return true
        } catch {
            return SignErrorText.message(error).localizedCaseInsensitiveContains("already joined")
        }
    }

    /// The identity this account recorded for an agreement, if it recorded one.
    public func sharedIdentity(for agreementContextId: String) async -> String? {
        guard let store = try? await find() else { return nil }
        return (try? await client(store).getSharedIdentity(contextIdStr: agreementContextId))?.hex
    }

    // MARK: - Signature library

    /// The saved signatures, newest first, with their images.
    public func signatures() async throws -> [SavedSignature] {
        guard let store = try await find() else { return [] }
        let rows = try await client(store).listSignatures()
        return await withTaskGroup(of: SavedSignature.self) { group in
            for row in rows {
                group.addTask {
                    let blobId = SignIds.blobHex(row.blobId)
                    let png = blobId.isEmpty ? nil : try? await self.admin.getBlob(blobId, contextId: store)
                    return SavedSignature(
                        id: row.id, name: row.name, blobId: blobId, size: row.size, createdAt: row.createdAt, png: png)
                }
            }
            var out: [SavedSignature] = []
            for await item in group { out.append(item) }
            return out.sorted { $0.createdAt > $1.createdAt }
        }
    }

    /// Store a drawn signature (PNG) in the library: the blob into the private
    /// context, then `create_signature` with its hex id and byte size.
    @discardableResult
    public func saveSignature(png: Data, name: String) async throws -> SavedSignature {
        let store = try await ensure()
        let blobId = SignIds.blobHex(try await admin.uploadBlob(png, contextId: store))
        guard !blobId.isEmpty else {
            throw SignModelError.message("Your cluster returned a blob id this app can't use.")
        }
        let id = try await client(store).createSignature(name: name, blobIdStr: blobId, dataSize: UInt64(png.count))
        return SavedSignature(
            id: id, name: name, blobId: blobId, size: UInt64(png.count),
            createdAt: UInt64(Date().timeIntervalSince1970 * 1_000_000_000), png: png)
    }

    public func deleteSignature(id: UInt64) async throws {
        guard let store = try await find() else { return }
        try await client(store).deleteSignature(signatureId: id)
    }
}
