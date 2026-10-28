import Foundation
import MeroKit

/// What the item list shows: everything, one kind, or one tag.
public enum ItemFilter: Hashable, Sendable {
    case all
    case kind(String)
    case tag(String)
}

/// One vault on screen (the web's `useVaultSession` + `VaultPage`): opening
/// the session, keeping it fresh, the decrypted items, and every action on
/// them. (Kotlin `VaultModel`.)
@MainActor
public final class VaultModel: ObservableObject {
    public enum Phase: Equatable {
        /// Opening; `notice` says what the relay is still doing while it retries.
        case opening(notice: String?)
        /// Open, in one of the session's states.
        case open(SessionState)
        /// A refusal that does not clear by itself.
        case failed(String)
    }

    @Published public private(set) var phase: Phase = .opening(notice: nil)
    @Published public private(set) var secrets: [Secret] = []
    @Published public private(set) var info: VaultInfoRecord?
    @Published public private(set) var approvals: [DeviceRecord] = []
    @Published public private(set) var awaitingApproval = false
    @Published public private(set) var holders: Holders?
    /// The last failed action, for a dismissable banner.
    @Published public var error: String?
    @Published public var filter: ItemFilter = .all
    @Published public var query = ""

    public let ref: VaultRef
    public let api: any VaultScreenAPI
    public let session: VaultSession
    private let preferences: PassPreferences
    private let events: (() -> AsyncThrowingStream<AppContextEvent, Error>)?
    private var reloading = false
    private var reloadAgain = false

    public init(
        ref: VaultRef, api: any VaultScreenAPI, device: DeviceKeyPair, label: String, preferences: PassPreferences,
        events: (() -> AsyncThrowingStream<AppContextEvent, Error>)? = nil
    ) {
        self.ref = ref
        self.api = api
        self.preferences = preferences
        self.events = events
        session = VaultSession(
            api: api, device: device, fingerprint: PassCrypto.fingerprint(of: device.publicRaw), label: label)
    }

    /// The model for a vault over the account's relay.
    public convenience init(
        ref: VaultRef, backend: any MeroAppBackend, device: DeviceKeyPair, label: String, preferences: PassPreferences
    ) {
        let canSubscribe = backend.canSubscribe
        self.init(
            ref: ref, api: PassVaultAPI(contract: backend.contract, contextId: ref.contextId), device: device,
            label: label, preferences: preferences,
            events: canSubscribe ? { backend.events(contextId: ref.contextId) } : nil)
    }

    // MARK: Derived

    public var state: SessionState? {
        if case .open(let s) = phase { return s }
        return nil
    }

    public var role: Role? { info?.myRole }
    public var me: String? { info?.myAccount }
    public var isAdmin: Bool { role == .admin }
    public var canWrite: Bool { state == .ready && (role == .admin || role == .editor) }
    /// Items can be listed (names may still be locked while waiting).
    public var readable: Bool { state == .ready || state == .waiting }
    public var myCode: String { PassCrypto.confirmationCode(session.fingerprint) }

    public var live: [Secret] { secrets.filter { !$0.trashed } }
    public var trashed: [Secret] { secrets.filter(\.trashed).sorted { $0.trashedAt > $1.trashedAt } }
    public var tags: [String] { Array(Set(live.flatMap(\.tags))).sorted() }
    public var counts: [String: Int] { Dictionary(grouping: live, by: \.kind).mapValues(\.count) }
    public var flagged: Int { PasswordTools.analyse(live).filter { !$0.issues.isEmpty }.count }

    public var shown: [Secret] {
        live.filter { s in
            switch filter {
            case .all: return true
            case .kind(let kind): return s.kind == kind
            case .tag(let tag): return s.tags.contains(tag)
            }
        }
        .filter { ItemView.matches($0, query: query) }
        .sorted(by: ItemView.byName)
    }

    public func secret(_ id: String) -> Secret? { secrets.first { $0.id == id } }

    /// "End-to-end encrypted · you are an Admin", as the web's vault header.
    public var subtitle: String {
        guard let role else { return "End-to-end encrypted" }
        let text: String
        switch role {
        case .admin: text = "you are an Admin"
        case .editor: text = "you are an Editor"
        case .viewer: text = "you can view"
        case .pending: text = "waiting for an Admin to let you in"
        case .removed: text = "you were removed from this vault"
        }
        return "End-to-end encrypted · \(text)"
    }

    // MARK: Lifecycle

    /// Open the session, retrying while the relay is still joining or syncing
    /// the vault, then read it once. `false` when it cannot open.
    @discardableResult
    public func open() async -> Bool {
        var delay: Duration = .seconds(2)
        while !Task.isCancelled {
            do {
                try await session.open()
                await reload()
                return true
            } catch {
                guard PassErrorText.isTransient(error) else {
                    phase = .failed(PassErrorText.describe(error))
                    return false
                }
                phase = .opening(notice: PassErrorText.describe(error))
                try? await Task.sleep(for: delay)
                delay = min(delay * 2, .seconds(15))
            }
        }
        return false
    }

    /// Open, then keep the vault fresh until the task is cancelled: live
    /// events when the relay streams, a poll otherwise and while waiting.
    public func run() async {
        guard await open() else { return }
        let streaming = events != nil
        await withTaskGroup(of: Void.self) { group in
            if let events {
                group.addTask { [weak self] in
                    do {
                        for try await _ in events() { await self?.reload() }
                    } catch {}
                }
            }
            group.addTask { [weak self] in
                while !Task.isCancelled {
                    try? await Task.sleep(for: PassConstants.pollInterval)
                    guard let self else { return }
                    // With a live stream, poll only while waiting for the key.
                    let waiting = await self.state != .ready
                    if !streaming || waiting { await self.reload() }
                }
            }
        }
    }

    /// Try opening again after a failure that did not clear on its own.
    public func retry() async {
        phase = .opening(notice: nil)
        await run()
    }

    /// Re-read keys, chores, approvals and items.
    public func reload() async {
        if reloading {
            reloadAgain = true
            return
        }
        reloading = true
        defer { reloading = false }
        repeat {
            reloadAgain = false
            await reloadOnce()
        } while reloadAgain
    }

    private func reloadOnce() async {
        do {
            let s = try await session.refreshKeys()
            if s == .ready {
                if let recovery = preferences.recoveryKey { _ = try? await session.adoptRecoveryKey(recovery) }
                // A phone cannot read the team's member list (the web passes it
                // as `allowed`), so it hands keys to the vault's own role holders.
                _ = try? await session.housekeep(allowed: nil)
                approvals = try await session.pendingApprovals()
                holders = try await session.holders()
                awaitingApproval = false
            } else {
                approvals = []
                holders = nil
                awaitingApproval = s == .waiting ? try await session.awaitingApproval() : false
            }
            secrets = try await session.list()
            info = await session.info
            phase = .open(await session.state)
        } catch {
            if case .open = phase { self.error = PassErrorText.describe(error) } else {
                phase = .failed(PassErrorText.describe(error))
            }
        }
    }

    // MARK: Actions

    private func run(_ body: () async throws -> Void) async -> Bool {
        error = nil
        do {
            try await body()
            await reload()
            return true
        } catch {
            self.error = PassErrorText.describe(error)
            return false
        }
    }

    /// Validate and save an item. Returns its id, or throws with words to show.
    @discardableResult
    public func save(_ draft: SecretDraft, editing: Secret?) async throws -> String {
        guard let name = draft.name.nilIfBlank else { throw PassModelError.message("Give the secret a name.") }
        let kind = SecretKind(rawValue: draft.kind) ?? .login
        for f in kind.fields where f.totp {
            if let v = draft.fields[f.key]?.nilIfBlank, Totp.parse(v) == nil {
                throw PassModelError.message("\(f.label): not a base32 seed or an otpauth://totp URI.")
            }
        }
        let keep = Set(kind.fields.map(\.key))
        let cleaned = SecretDraft(
            kind: kind.rawValue, name: name, tags: draft.tags.compactMap(\.nilIfBlank),
            fields: draft.fields.filter { keep.contains($0.key) && !$0.value.isEmpty })
        do {
            var id = editing?.id ?? ""
            if let editing {
                try await session.update(editing, to: cleaned)
            } else {
                id = try await session.add(cleaned)
            }
            await reload()
            return id
        } catch {
            throw PassModelError.message(PassErrorText.describe(error))
        }
    }

    @discardableResult public func trash(_ id: String) async -> Bool { await run { try await api.trashSecret(id: id) } }
    @discardableResult public func restore(_ id: String) async -> Bool {
        await run { try await api.restoreSecret(id: id) }
    }
    @discardableResult public func purge(_ id: String) async -> Bool { await run { try await api.purgeSecret(id: id) } }

    public func history(_ id: String) async -> [Revision] {
        do {
            return try await session.history(id)
        } catch {
            self.error = PassErrorText.describe(error)
            return []
        }
    }

    /// Put an earlier value back (the web's `restore`).
    @discardableResult
    public func restoreRevision(_ revision: Revision, of secret: Secret) async -> Bool {
        await run {
            var after = SecretDraft(kind: secret.kind, name: secret.name, tags: secret.tags, fields: secret.fields)
            switch revision.field {
            case "name": after.name = revision.previous
            case "tags":
                after.tags = (try? JSONDecoder().decode([String].self, from: Data(revision.previous.utf8))) ?? []
            default: after.fields[revision.field] = revision.previous
            }
            try await session.update(secret, to: after)
        }
    }

    @discardableResult public func approve(_ request: DeviceRecord) async -> Bool {
        await run { _ = try await session.approve(request) }
    }

    @discardableResult public func deny(_ request: DeviceRecord) async -> Bool {
        await run { try await session.deny(request) }
    }

    public func activity() async -> [AuditRecord] {
        do {
            return try await api.auditLogs()
        } catch {
            self.error = PassErrorText.describe(error)
            return []
        }
    }

    /// A link that lands someone in this vault (and grants the whole team).
    public func invite(backend: any MeroAppBackend) async throws -> String {
        try await TeamModel.vaultInvite(backend: backend, ref: ref)
    }
}
