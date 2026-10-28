import Foundation
import MeroKit

/// One company: its audiences, making one, inviting people, entering one.
@MainActor
public final class CompanyModel: ObservableObject {
    @Published public private(set) var audiences: [AudienceSummary] = []
    @Published public private(set) var isLoading = false
    @Published public private(set) var hasLoaded = false
    @Published public private(set) var isWorking = false
    /// What is in flight: "create", "invite", "invite:<audience>", "enter:<audience>".
    @Published public private(set) var pending: String?
    @Published public var error: String?

    public let company: CompanySummary
    public let backend: any MeroAppBackend
    private let applicationId: String?
    /// Just joined: an empty list means "still syncing", not "no audiences".
    public let justJoined: Bool

    public init(company: CompanySummary, backend: any MeroAppBackend, applicationId: String?, justJoined: Bool = false) {
        self.company = company
        self.backend = backend
        self.applicationId = applicationId
        self.justJoined = justJoined
    }

    public var isSyncing: Bool { justJoined && hasLoaded && audiences.isEmpty }

    public func load() async {
        isLoading = true
        defer {
            isLoading = false
            hasLoaded = true
        }
        do {
            audiences = try await backend.listSubgroups(namespaceId: company.id).map {
                AudienceSummary(
                    companyId: company.id, audienceId: $0.groupId, contextId: $0.contextIds.first,
                    name: $0.name ?? "", companyName: company.name)
            }
            .sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
            error = nil
        } catch {
            self.error = ErrorText.describe(error)
        }
    }

    /// While a just-joined company has no audiences listed, re-read every few
    /// seconds (the web's join sync). Runs until cancelled or one appears.
    public func syncWhileEmpty(every interval: Duration = .seconds(3)) async {
        while !Task.isCancelled, justJoined, audiences.isEmpty {
            try? await Task.sleep(for: interval)
            guard !Task.isCancelled else { return }
            await load()
        }
    }

    /// Create an audience: an open subgroup (every company member can reach
    /// it) and the context that holds its updates.
    public func create(name: String) async -> AudienceSummary? {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return await run("create") {
            let groupId = try await self.backend.createSubgroup(namespaceId: self.company.id, name: trimmed, isPublic: true)
            let app = try await self.applicationId()
            let contextId = try await self.backend.createContext(
                groupId: groupId, applicationId: app, name: trimmed, initArgs: .object([:]))
            let audience = AudienceSummary(
                companyId: self.company.id, audienceId: groupId, contextId: contextId, name: trimmed,
                companyName: self.company.name)
            self.audiences = (self.audiences + [audience])
                .sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
            return audience
        }
    }

    /// Open an audience: join its context first when the account is not in it yet.
    public func enter(_ audience: AudienceSummary) async -> AudienceSummary? {
        guard let contextId = audience.contextId else {
            error = UpdatesError.noAudienceContext(audience.title).errorDescription
            return nil
        }
        return await run("enter:\(audience.audienceId)") {
            if try await !self.backend.isMember(contextId: contextId) {
                try await self.backend.joinContext(contextId: contextId)
            }
            return audience
        }
    }

    /// A link that joins the whole company and lands on its audience list.
    public func companyInvitation() async -> UpdatesInvitation? {
        await run("invite") {
            let signed = try await self.backend.createInvitation(namespaceId: self.company.id)
            return UpdatesInvitation(
                invitation: signed, kind: .namespace, namespaceId: self.company.id, companyName: self.company.name)
        }
    }

    /// A link that joins the company and lands in one audience.
    public func audienceInvitation(_ audience: AudienceSummary) async -> UpdatesInvitation? {
        await run("invite:\(audience.audienceId)") {
            let signed = try await self.backend.createInvitation(namespaceId: self.company.id)
            return UpdatesInvitation(
                invitation: signed, kind: .audience, namespaceId: self.company.id, companyName: self.company.name,
                audienceId: audience.audienceId, contextId: audience.contextId, audienceName: audience.name)
        }
    }

    private func applicationId() async throws -> String {
        if let applicationId, !applicationId.isEmpty { return applicationId }
        let namespaces = try await backend.listNamespaces()
        guard let app = namespaces.first(where: { $0.id == company.id })?.applicationId, !app.isEmpty else {
            throw UpdatesError.noApplication
        }
        return app
    }

    private func run<T>(_ key: String, _ body: () async throws -> T) async -> T? {
        pending = key
        isWorking = true
        defer {
            pending = nil
            isWorking = false
        }
        do {
            let value = try await body()
            error = nil
            return value
        } catch {
            self.error = ErrorText.describe(error)
            return nil
        }
    }
}
