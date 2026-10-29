import Foundation
import MeroKit

/// One spreadsheet: a context bound directly to the workspace's namespace root.
public struct SpreadsheetItem: Identifiable, Hashable, Sendable {
    public let id: String
    public let name: String
    /// True when the name is a placeholder, not something anyone typed.
    public let unnamed: Bool

    public init(id: String, name: String, unnamed: Bool = false) {
        self.id = id
        self.name = name
        self.unnamed = unnamed
    }
}

/// Where a read stands.
public enum LoadPhase: Equatable, Sendable {
    case idle
    case loading
    case loaded
    case failed(String)
}

/// Workspaces (namespaces) and their spreadsheets (contexts), the web app's
/// picker (`app/src/lib/workspaces.ts`): switching, founding a workspace,
/// creating a spreadsheet, inviting and joining.
@MainActor
public final class WorkspaceModel: ObservableObject {
    @Published public private(set) var workspaces: [AppNamespace] = []
    @Published public private(set) var activeWorkspaceId: String?
    @Published public private(set) var spreadsheets: [SpreadsheetItem] = []
    @Published public private(set) var phase: LoadPhase = .idle
    @Published public private(set) var spreadsheetsPhase: LoadPhase = .idle
    /// A workspace joined from an invitation whose spreadsheets have not arrived yet.
    @Published public private(set) var syncingWorkspaceId: String?

    public let backend: any MeroAppBackend
    public let account: String
    private let applicationId: String?
    private let store: SheetsStore

    public init(backend: any MeroAppBackend, applicationId: String?, store: SheetsStore) {
        self.backend = backend
        self.account = backend.account
        self.applicationId = applicationId
        self.store = store
    }

    public var activeWorkspace: AppNamespace? { workspaces.first { $0.id == activeWorkspaceId } }
    public var hasRelay: Bool { backend.hasRelay }
    public var isSyncing: Bool {
        syncingWorkspaceId != nil && syncingWorkspaceId == activeWorkspaceId && spreadsheets.isEmpty
    }

    /// A workspace's name as people see it (`namespaceLabel`).
    public static func displayName(_ ns: AppNamespace) -> String {
        let name = ns.name?.trimmingCharacters(in: .whitespaces) ?? ""
        return name.isEmpty ? "Mero Sheets · \(ns.id.prefix(6))" : name
    }

    /// A spreadsheet whose own name has not resolved yet (`spreadsheetFallbackLabel`).
    public static func fallbackName(_ contextId: String) -> String { "Untitled · \(contextId.prefix(6))" }

    /// The contract in a spreadsheet.
    public func client(for contextId: String) -> SheetsClient {
        SheetsClient(contract: backend.contract, contextId: contextId)
    }

    public func spreadsheet(_ id: String) -> SpreadsheetItem? { spreadsheets.first { $0.id == id } }

    // MARK: Loading

    /// List workspaces and open the remembered one (or the first), then its spreadsheets.
    public func load() async {
        if workspaces.isEmpty { phase = .loading }
        do {
            let list = try await backend.listNamespaces()
            workspaces = list.sorted {
                Self.displayName($0).localizedCaseInsensitiveCompare(Self.displayName($1)) == .orderedAscending
            }
            phase = .loaded
        } catch {
            phase = .failed(SheetsFormat.errorText(error))
            return
        }
        let remembered = store.activeWorkspace
        let next =
            workspaces.first { $0.id == activeWorkspaceId }?.id
            ?? workspaces.first { $0.id == remembered }?.id
            ?? workspaces.first?.id
        if next != activeWorkspaceId { spreadsheets = [] }
        activeWorkspaceId = next
        if let next { store.activeWorkspace = next }
        await loadSpreadsheets()
    }

    /// Switch to another workspace.
    public func selectWorkspace(_ id: String) async {
        guard id != activeWorkspaceId else { return }
        activeWorkspaceId = id
        store.activeWorkspace = id
        spreadsheets = []
        await loadSpreadsheets()
    }

    /// The active workspace's spreadsheets, named by their workbook (`get_project`),
    /// else the name this device gave, else a placeholder.
    public func loadSpreadsheets() async {
        guard let ns = activeWorkspaceId else {
            spreadsheets = []
            spreadsheetsPhase = .loaded
            return
        }
        if spreadsheets.isEmpty { spreadsheetsPhase = .loading }
        do {
            let ids = try await backend.listContexts(groupId: ns)
            let contract = backend.contract
            let names = await withTaskGroup(of: (String, String).self) { group -> [String: String] in
                for id in ids {
                    group.addTask {
                        let name = (try? await SheetsClient(contract: contract, contextId: id).getProject().name) ?? ""
                        return (id, name.trimmingCharacters(in: .whitespacesAndNewlines))
                    }
                }
                var out: [String: String] = [:]
                for await (id, name) in group { out[id] = name }
                return out
            }
            guard ns == activeWorkspaceId else { return }
            spreadsheets = ids.map { id in
                if let name = names[id], !name.isEmpty { return SpreadsheetItem(id: id, name: name) }
                if let name = store.spreadsheetName(id) { return SpreadsheetItem(id: id, name: name) }
                return SpreadsheetItem(id: id, name: Self.fallbackName(id), unnamed: true)
            }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
            spreadsheetsPhase = .loaded
            if !spreadsheets.isEmpty, syncingWorkspaceId == ns { syncingWorkspaceId = nil }
        } catch {
            spreadsheetsPhase = .failed(SheetsFormat.errorText(error))
        }
    }

    /// Make sure the account may call the contract in a spreadsheet (members of the
    /// workspace are; a context in an open group is joined). Best-effort.
    public func ensureMember(_ contextId: String) async {
        guard (try? await backend.isMember(contextId: contextId)) == false else { return }
        try? await backend.joinContext(contextId: contextId)
    }

    // MARK: Writes

    /// Found a workspace and open it. Returns a hosting notice when the cloud
    /// would not host it (an invitation from it will not reach anyone yet).
    @discardableResult
    public func createWorkspace(name: String) async throws -> String? {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw SheetsError.message("Give the workspace a name.") }
        let founded = try await backend.foundNamespace(name: trimmed)
        store.activeWorkspace = founded.namespaceId
        activeWorkspaceId = founded.namespaceId
        spreadsheets = []
        await load()
        if !workspaces.contains(where: { $0.id == founded.namespaceId }) {
            workspaces.append(AppNamespace(id: founded.namespaceId, name: trimmed, applicationId: applicationId ?? ""))
            activeWorkspaceId = founded.namespaceId
        }
        return founded.haEnabled ? nil : (founded.haError ?? "the cloud is not hosting it")
    }

    /// Create a spreadsheet in the active workspace, as the web does: a context,
    /// then `init_project(name)` (the workbook's title, which every member reads)
    /// and its first tab. Returns the new spreadsheet's id.
    @discardableResult
    public func createSpreadsheet(name: String) async throws -> String {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw SheetsError.message("Give the spreadsheet a name.") }
        guard let ns = activeWorkspace else { throw SheetsError.message("Open a workspace first.") }
        let appId = ns.applicationId.isEmpty ? (applicationId ?? "") : ns.applicationId
        guard !appId.isEmpty else { throw SheetsError.message("The app's id is not known yet. Try again in a moment.") }
        let contextId = try await backend.createContext(
            groupId: ns.id, applicationId: appId, name: trimmed, initArgs: .object([:]))
        store.setSpreadsheetName(trimmed, for: contextId)
        let client = client(for: contextId)
        try await client.initProject(name: trimmed)
        try await client.createSheet(name: MeroSheets.firstSheetName)
        await loadSpreadsheets()
        if !spreadsheets.contains(where: { $0.id == contextId }) {
            spreadsheets.append(SpreadsheetItem(id: contextId, name: trimmed))
        }
        return contextId
    }

    /// Mint an invitation link to the active workspace; `spreadsheet` (the one
    /// open) is opened for whoever joins.
    public func inviteLink(spreadsheet: SpreadsheetItem? = nil) async throws -> String {
        guard let ns = activeWorkspace else { throw SheetsError.message("Open a workspace first.") }
        let signed = try await backend.createInvitation(namespaceId: ns.id)
        return try SheetsInvitation(
            invitation: signed, workspaceName: Self.displayName(ns), contextId: spreadsheet?.id,
            spreadsheetName: spreadsheet.map { $0.unnamed ? nil : $0.name } ?? nil
        ).link()
    }

    /// Redeem an invitation and remember its workspace as the open one. The
    /// caller then reconnects the session (`MeroAppSession.didJoinNamespace()`).
    public func join(_ invitation: SheetsInvitation) async throws {
        let id = invitation.namespaceId
        guard !id.isEmpty else { throw SheetsError.message("That invitation does not name a workspace.") }
        _ = try await backend.joinNamespace(namespaceId: id, invitation: invitation.invitation)
        store.activeWorkspace = id
        syncingWorkspaceId = id
        activeWorkspaceId = id
        spreadsheets = []
        await load()
    }

    /// Mark a workspace as just joined, so an empty list reads as "syncing".
    public func markSyncing(_ id: String?) {
        syncingWorkspaceId = id
    }
}

/// A failure the app words itself.
public enum SheetsError: Error, LocalizedError, Equatable {
    case message(String)

    public var errorDescription: String? {
        switch self {
        case .message(let text): return text
        }
    }
}
