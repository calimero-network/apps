import Foundation
import MeroKit

/// A company: one namespace founded for this app. Its audiences are subgroups.
public struct CompanySummary: Identifiable, Hashable, Sendable {
    public let id: String
    public var name: String
    public var memberCount: Int

    public init(id: String, name: String, memberCount: Int = 0) {
        self.id = id
        self.name = name
        self.memberCount = memberCount
    }

    /// The name, else "Company 1a2b3c" as the web shows an unnamed one.
    public var title: String {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "Company \(id.prefix(6))" : trimmed
    }
}

/// An audience: a subgroup of a company and the one context in it, which is
/// where the updates live.
public struct AudienceSummary: Identifiable, Hashable, Sendable, Codable {
    public let companyId: String
    public let audienceId: String
    /// Nil while the audience has no app instance yet.
    public let contextId: String?
    public var name: String
    public var companyName: String

    public init(companyId: String, audienceId: String, contextId: String?, name: String, companyName: String) {
        self.companyId = companyId
        self.audienceId = audienceId
        self.contextId = contextId
        self.name = name
        self.companyName = companyName
    }

    public var id: String { audienceId }

    public var title: String {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "Audience \(audienceId.prefix(6))" : trimmed
    }
}

/// Where a redeemed invitation lands: one audience, or a company's audience list.
public enum InvitationLanding: Hashable, Sendable {
    case audience(AudienceSummary)
    case company(CompanySummary)
}

/// The company list: the account's namespaces for this app, founding one and
/// joining one by invitation.
@MainActor
public final class CompaniesModel: ObservableObject {
    @Published public private(set) var companies: [CompanySummary] = []
    @Published public private(set) var isLoading = false
    @Published public private(set) var hasLoaded = false
    @Published public private(set) var isWorking = false
    @Published public var error: String?
    /// Why the last founded company cannot be invited to yet (the cloud did not host it).
    @Published public private(set) var hostingNote: String?

    public let backend: any MeroAppBackend

    public init(backend: any MeroAppBackend) {
        self.backend = backend
    }

    /// Whether a node serves the account: always once signed in on Calimero 1.0.
    public var hasRelay: Bool { backend.hasRelay }

    public func load() async {
        guard backend.hasRelay else {
            companies = []
            hasLoaded = true
            return
        }
        isLoading = true
        defer {
            isLoading = false
            hasLoaded = true
        }
        do {
            companies = try await backend.listNamespaces()
                .map { CompanySummary(id: $0.id, name: $0.name ?? "", memberCount: $0.memberCount) }
                .sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
            error = nil
        } catch {
            self.error = ErrorText.describe(error)
        }
    }

    /// Found a company. No audience is made here: that is the next screen's job.
    public func create(name: String) async -> CompanySummary? {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        isWorking = true
        defer { isWorking = false }
        do {
            let founded = try await backend.foundNamespace(name: trimmed)
            hostingNote = founded.haEnabled
                ? nil : (founded.haError ?? "This company is not hosted yet — nobody can be invited to it.")
            let company = CompanySummary(id: founded.namespaceId, name: trimmed, memberCount: 1)
            companies = (companies.filter { $0.id != company.id } + [company])
                .sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
            error = nil
            return company
        } catch {
            self.error = ErrorText.describe(error)
            return nil
        }
    }

    /// Redeem an invitation: join its company, then land in the audience it
    /// names, else on the company's audience list.
    public func join(_ invitation: UpdatesInvitation) async -> InvitationLanding? {
        isWorking = true
        defer { isWorking = false }
        do {
            _ = try await backend.joinNamespace(namespaceId: invitation.namespaceId, invitation: invitation.invitation)
            let company = CompanySummary(id: invitation.namespaceId, name: invitation.companyName ?? "")
            if !companies.contains(where: { $0.id == company.id }) { companies.append(company) }
            error = nil
            if let audienceId = invitation.audienceId, let contextId = invitation.contextId {
                return .audience(
                    AudienceSummary(
                        companyId: invitation.namespaceId, audienceId: audienceId, contextId: contextId,
                        name: invitation.audienceName ?? "", companyName: invitation.companyName ?? ""))
            }
            return .company(company)
        } catch {
            self.error = ErrorText.describe(error)
            return nil
        }
    }
}
