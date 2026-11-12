import Foundation
import MeroKit

/// The Updates tab. Same screen for both sides, weighted differently: the team
/// sees what is due, templates, drafts and the setup checklist; an investor
/// sees unread first and the category filter.
@MainActor
public final class FeedModel: ObservableObject {
    @Published public private(set) var posts: [PostCard] = []
    @Published public private(set) var drafts: [DraftView] = []
    @Published public private(set) var investorCount = 0
    @Published public private(set) var isLoading = false
    @Published public private(set) var hasLoaded = false
    @Published public var error: String?
    /// The category filter, nil for all.
    @Published public var category: String?

    public let audience: AudienceModel
    public static let pageSize: UInt32 = 100

    public init(audience: AudienceModel) {
        self.audience = audience
    }

    public func load() async {
        isLoading = true
        defer {
            isLoading = false
            hasLoaded = true
        }
        let client = audience.client
        do {
            posts = try await client.listPosts(kind: "update", categoryId: category, cursor: nil, limit: Self.pageSize)
                .items
            error = nil
        } catch {
            self.error = ErrorText.describe(error)
        }
        if audience.isTeam {
            // Drafts and the investor count only feed the team's panel: best effort.
            drafts = (try? await client.listDrafts()) ?? drafts
            if let people = try? await client.listPeople() { investorCount = people.filter { !$0.isTeam }.count }
        } else {
            drafts = []
        }
    }

    public func select(category id: String?) async {
        category = category == id ? nil : id
        await load()
    }

    public func discard(_ draft: DraftView) async {
        drafts.removeAll { $0.id == draft.id }
        do {
            try await audience.deleteDraft(draft.id)
        } catch {
            self.error = ErrorText.describe(error)
        }
    }

    /// One step of the team's "Getting started" list.
    public struct SetupStep: Identifiable, Hashable, Sendable {
        public enum Target: Hashable, Sendable { case settings, compose, invite }
        public let label: String
        public let done: Bool
        public let target: Target
        public var id: String { label }
    }

    public var setupSteps: [SetupStep] {
        [
            SetupStep(
                label: "Name your company and set a cadence",
                done: !(audience.overview?.companyName ?? "").isEmpty, target: .settings),
            SetupStep(
                label: "Add categories (Monthly, Fundraising, Product…)", done: !audience.categories.isEmpty,
                target: .settings),
            SetupStep(
                label: "Publish your first update", done: (audience.overview?.updatesTotal ?? 0) > 0, target: .compose),
            SetupStep(label: "Invite your investors", done: investorCount > 0, target: .invite),
        ]
    }

    public var setupDone: Bool { setupSteps.allSatisfy(\.done) }
}
