import Foundation
import MeroKit

/// One pipeline: a context directly in its workspace's namespace, as the web
/// app's `addPipeline` creates them.
public struct PipelineRef: Identifiable, Hashable, Codable, Sendable {
    public let namespaceId: String
    public let contextId: String
    public var name: String
    public var workspaceName: String
    public var id: String { contextId }

    public init(namespaceId: String, contextId: String, name: String, workspaceName: String) {
        self.namespaceId = namespaceId
        self.contextId = contextId
        self.name = name
        self.workspaceName = workspaceName
    }
}

/// A workspace (a namespace running Mero CRM) and its pipelines.
public struct Workspace: Identifiable, Hashable, Sendable {
    public let id: String
    public var name: String
    public var memberCount: Int
    public var pipelines: [PipelineRef]

    public init(id: String, name: String, memberCount: Int, pipelines: [PipelineRef]) {
        self.id = id
        self.name = name
        self.memberCount = memberCount
        self.pipelines = pipelines
    }

    public var title: String { name.isEmpty ? "Unnamed workspace" : name }
}

/// Small string storage, so the device-local pipeline names are testable.
public protocol KeyValueStore: AnyObject {
    func string(forKey key: String) -> String?
    func set(_ value: Any?, forKey key: String)
}

extension UserDefaults: KeyValueStore {}

/// A pipeline's name is a label the creating node keeps (`createContext(name)`)
/// plus a context-metadata record the web writes and reads through the node
/// admin API. The app backend reads neither, so the names this device gave its
/// pipelines (and the workspace names invitations carried) are kept here.
public final class LocalNames {
    private let store: KeyValueStore

    public init(store: KeyValueStore = UserDefaults.standard) {
        self.store = store
    }

    public func pipeline(_ contextId: String) -> String? { value("crm.pipeline.\(contextId)") }
    public func setPipeline(_ contextId: String, _ name: String) { store.set(name, forKey: "crm.pipeline.\(contextId)") }
    public func workspace(_ namespaceId: String) -> String? { value("crm.workspace.\(namespaceId)") }
    public func setWorkspace(_ namespaceId: String, _ name: String) { store.set(name, forKey: "crm.workspace.\(namespaceId)") }

    private func value(_ key: String) -> String? {
        guard let s = store.string(forKey: key)?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty else { return nil }
        return s
    }
}

/// The workspace list: the account's namespaces for this app, the pipelines in
/// each, and founding, joining and inviting.
@MainActor
public final class WorkspacesModel: ObservableObject {
    @Published public private(set) var workspaces: [Workspace] = []
    @Published public private(set) var isLoading = false
    @Published public private(set) var hasLoaded = false
    @Published public var error: String?
    @Published public private(set) var isWorking = false

    public let backend: any MeroAppBackend
    private let applicationId: String?
    private let names: LocalNames

    public init(backend: any MeroAppBackend, applicationId: String?, names: LocalNames = LocalNames()) {
        self.backend = backend
        self.applicationId = applicationId
        self.names = names
    }

    /// Whether a relay serves the account. Without one only joining works.
    public var hasRelay: Bool { backend.hasRelay }

    public func load() async {
        guard backend.hasRelay else {
            workspaces = []
            hasLoaded = true
            return
        }
        isLoading = true
        defer {
            isLoading = false
            hasLoaded = true
        }
        do {
            var found: [Workspace] = []
            for ns in try await backend.listNamespaces() {
                let contexts = (try? await backend.listContexts(groupId: ns.id)) ?? []
                let name = ns.name.flatMap { $0.isEmpty ? nil : $0 } ?? names.workspace(ns.id) ?? ""
                found.append(
                    Workspace(
                        id: ns.id, name: name, memberCount: ns.memberCount,
                        pipelines: pipelines(namespaceId: ns.id, workspaceName: name, contexts: contexts)))
            }
            workspaces = found.sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
            error = nil
        } catch {
            self.error = ErrorText.describe(error)
        }
    }

    private func pipelines(namespaceId: String, workspaceName: String, contexts: [String]) -> [PipelineRef] {
        contexts.enumerated().map { index, id in
            let fallback = contexts.count == 1 ? "Pipeline" : "Pipeline \(index + 1)"
            return PipelineRef(
                namespaceId: namespaceId, contextId: id, name: names.pipeline(id) ?? fallback, workspaceName: workspaceName)
        }
    }

    /// Found a workspace with its first pipeline. Returns the pipeline, or nil with ``error`` set.
    public func createWorkspace(name: String, pipelineName: String, currency: String) async -> PipelineRef? {
        let workspace = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard Money.isValidCode(currency) else {
            error = CrmError.invalidCurrency.errorDescription
            return nil
        }
        isWorking = true
        defer { isWorking = false }
        do {
            let founded = try await backend.foundNamespace(name: workspace)
            names.setWorkspace(founded.namespaceId, workspace)
            let pipeline = try await createPipeline(
                namespaceId: founded.namespaceId, workspaceName: workspace, name: pipelineName, currency: currency)
            workspaces.append(Workspace(id: founded.namespaceId, name: workspace, memberCount: 1, pipelines: [pipeline]))
            workspaces.sort { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
            error = nil
            return pipeline
        } catch {
            self.error = ErrorText.describe(error)
            return nil
        }
    }

    /// Add a pipeline to a workspace. Returns it, or nil with ``error`` set.
    public func addPipeline(to workspace: Workspace, name: String, currency: String) async -> PipelineRef? {
        guard Money.isValidCode(currency) else {
            error = CrmError.invalidCurrency.errorDescription
            return nil
        }
        isWorking = true
        defer { isWorking = false }
        do {
            let pipeline = try await createPipeline(
                namespaceId: workspace.id, workspaceName: workspace.name, name: name, currency: currency)
            if let i = workspaces.firstIndex(where: { $0.id == workspace.id }) { workspaces[i].pipelines.append(pipeline) }
            error = nil
            return pipeline
        } catch {
            self.error = ErrorText.describe(error)
            return nil
        }
    }

    private func createPipeline(namespaceId: String, workspaceName: String, name: String, currency: String) async throws
        -> PipelineRef
    {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let label = trimmed.isEmpty ? "Sales" : trimmed
        let app = try await applicationId(for: namespaceId)
        let contextId = try await backend.createContext(
            groupId: namespaceId, applicationId: app, name: label, initArgs: .object([:]))
        names.setPipeline(contextId, label)
        let code = currency.trimmingCharacters(in: .whitespaces).uppercased()
        // Like the web: a new pipeline starts in USD, and a failed switch stays
        // USD until changed in Settings.
        if code != "USD" {
            try? await CrmClient(backend: backend, contextId: contextId).setCurrency(currency: code)
        }
        return PipelineRef(namespaceId: namespaceId, contextId: contextId, name: label, workspaceName: workspaceName)
    }

    /// The application a new pipeline runs: the session's, else the one its namespace was founded with.
    private func applicationId(for namespaceId: String) async throws -> String {
        if let applicationId, !applicationId.isEmpty { return applicationId }
        let namespaces = try await backend.listNamespaces()
        guard let app = namespaces.first(where: { $0.id == namespaceId })?.applicationId, !app.isEmpty else {
            throw CrmError.noApplication
        }
        return app
    }

    /// Redeem an invitation and reload. Returns the joined workspace's id, or nil with ``error`` set.
    public func join(_ invitation: CrmInvitation) async -> String? {
        isWorking = true
        defer { isWorking = false }
        do {
            _ = try await backend.joinNamespace(namespaceId: invitation.namespaceId, invitation: invitation.invitation)
            if let name = invitation.workspaceName { names.setWorkspace(invitation.namespaceId, name) }
            error = nil
        } catch {
            self.error = ErrorText.describe(error)
            return nil
        }
        await load()
        if !workspaces.contains(where: { $0.id == invitation.namespaceId }) {
            workspaces.append(
                Workspace(id: invitation.namespaceId, name: invitation.workspaceName ?? "", memberCount: 0, pipelines: []))
        }
        return invitation.namespaceId
    }

    /// Mint an invitation link to a workspace.
    public func inviteLink(for workspace: Workspace) async -> String? {
        isWorking = true
        defer { isWorking = false }
        do {
            let signed = try await backend.createInvitation(namespaceId: workspace.id)
            error = nil
            return try CrmInvitation(invitation: signed, workspaceName: workspace.name).link()
        } catch {
            self.error = ErrorText.describe(error)
            return nil
        }
    }

    public func workspace(_ id: String) -> Workspace? { workspaces.first { $0.id == id } }
}
