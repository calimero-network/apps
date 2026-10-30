import Foundation
import MeroKit

/// A workspace and its agreements, for the Agreements tab.
public struct WorkspaceSection: Identifiable, Equatable, Sendable {
    public let workspace: AppNamespace
    public let agreements: [AgreementRow]

    public var id: String { workspace.id }
    public var name: String { AgreementDirectory.name(of: workspace) }
}

public struct AgreementRow: Identifiable, Equatable, Sendable {
    public let agreement: AgreementRef
    /// Whether the account has entered it.
    public let joined: Bool

    public var id: String { agreement.contextId }
}

/// The Agreements tab: every workspace and the agreements in it.
@MainActor
public final class AgreementsModel: ObservableObject {
    @Published public private(set) var sections: [WorkspaceSection] = []
    @Published public private(set) var phase: LoadPhase = .loading
    @Published public private(set) var opening: String?
    @Published public var notice: String?

    public let directory: AgreementDirectory

    public init(directory: AgreementDirectory) { self.directory = directory }

    public func load() async {
        if sections.isEmpty { phase = .loading }
        do {
            var out: [WorkspaceSection] = []
            for workspace in try await directory.workspaces() {
                let agreements = (try? await directory.agreements(in: workspace)) ?? []
                var rows: [AgreementRow] = []
                for agreement in agreements {
                    let joined = (try? await directory.backend.isMember(contextId: agreement.contextId)) == true
                    rows.append(AgreementRow(agreement: agreement, joined: joined))
                }
                out.append(WorkspaceSection(workspace: workspace, agreements: rows))
            }
            sections = out
            phase = .loaded
        } catch {
            phase = sections.isEmpty ? .failed(SignErrorText.describe(error)) : .loaded
        }
    }

    /// Make sure the account is in the agreement before it is shown: enter it
    /// and settle in (register, record) when it wasn't. True when it can open.
    public func prepare(_ row: AgreementRow) async -> Bool {
        if row.joined { return true }
        opening = row.agreement.contextId
        defer { opening = nil }
        do {
            try await directory.enter(row.agreement.contextId)
            await directory.settle(contextId: row.agreement.contextId, nameHint: row.agreement.name)
            await load()
            return true
        } catch {
            notice = SignErrorText.describe(error)
            return false
        }
    }
}

/// A participant of an agreement.
public struct PersonRow: Identifiable, Equatable, Sendable {
    public let account: String
    public let name: String?
    public let level: PermissionLevel
    public let isMe: Bool

    public var id: String { account }
    public var displayName: String { name ?? SignIds.short(account) }
}

/// One agreement: its documents and its people.
@MainActor
public final class AgreementModel: ObservableObject {
    @Published public private(set) var snapshot: AgreementSnapshot?
    @Published public private(set) var people: [PersonRow] = []
    @Published public private(set) var phase: LoadPhase = .loading
    @Published public private(set) var isSyncing = false

    public let directory: AgreementDirectory
    public let names: NameDirectory
    public private(set) var agreement: AgreementRef
    private var settled = false

    public init(directory: AgreementDirectory, names: NameDirectory, agreement: AgreementRef) {
        self.directory = directory
        self.names = names
        self.agreement = agreement
    }

    public var documents: [DocumentEntry] {
        (snapshot?.documents ?? []).sorted { $0.document.uploadedAt > $1.document.uploadedAt }
    }

    public func load() async {
        if snapshot == nil { phase = .loading }
        do {
            var loaded = try await directory.snapshot(agreement)
            // Entered but never registered (opened outside an invitation):
            // settle in once, as the invitation flow would have.
            if !loaded.isParticipant, !settled {
                settled = true
                await directory.settle(contextId: agreement.contextId, nameHint: agreement.name)
                loaded = try await directory.snapshot(agreement)
            }
            agreement = loaded.agreement
            snapshot = loaded
            isSyncing = false
            phase = .loaded
            await loadPeople(loaded)
        } catch {
            if SignErrorText.isSyncing(error) {
                isSyncing = true
                phase = snapshot == nil ? .loading : .loaded
            } else {
                phase = snapshot == nil ? .failed(SignErrorText.describe(error)) : .loaded
            }
        }
    }

    private func loadPeople(_ snapshot: AgreementSnapshot) async {
        var rows: [PersonRow] = []
        for participant in snapshot.details.participants {
            let name = await names.name(of: participant.userId.hex, in: agreement.namespaceId)
            rows.append(
                PersonRow(
                    account: SignIds.hex(participant.userId), name: name, level: participant.permissionLevel,
                    isMe: SignIds.same(participant.userId, snapshot.me)))
        }
        people = rows.sorted { a, b in
            if a.isMe != b.isMe { return a.isMe }
            return a.displayName.localizedCaseInsensitiveCompare(b.displayName) == .orderedAscending
        }
    }
}
