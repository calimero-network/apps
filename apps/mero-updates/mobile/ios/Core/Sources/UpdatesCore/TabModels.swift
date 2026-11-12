import Foundation
import MeroKit

/// The Asks tab: every ask across the updates, by status, and the ledger of
/// accepted offers.
@MainActor
public final class AsksModel: ObservableObject {
    @Published public private(set) var asks: [AskView] = []
    @Published public private(set) var contributions: [ContributionView] = []
    @Published public private(set) var hasLoaded = false
    @Published public var error: String?
    /// "open" or "resolved".
    @Published public var status = "open"

    public let audience: AudienceModel

    public init(audience: AudienceModel) { self.audience = audience }

    public func load() async {
        defer { hasLoaded = true }
        do {
            async let asks = audience.client.listAsks(status: status)
            async let contributions = audience.client.listContributions(since: 0)
            let (a, c) = try await (asks, contributions)
            self.asks = a
            self.contributions = c
            error = nil
        } catch {
            self.error = ErrorText.describe(error)
        }
    }

    public func show(status: String) async {
        guard status != self.status else { return }
        self.status = status
        asks = []
        await load()
    }
}

/// The Q&A tab: questions anyone in the audience can ask and read.
@MainActor
public final class QuestionsModel: ObservableObject {
    @Published public private(set) var questions: [PostCard] = []
    @Published public private(set) var hasLoaded = false
    @Published public private(set) var isPosting = false
    @Published public var error: String?
    /// Unanswered only.
    @Published public var openOnly = false

    public let audience: AudienceModel

    public init(audience: AudienceModel) { self.audience = audience }

    public var shown: [PostCard] { openOnly ? questions.filter { $0.status == "open" } : questions }

    public func load() async {
        defer { hasLoaded = true }
        do {
            questions = try await audience.client.listPosts(
                kind: "question", categoryId: nil, cursor: nil, limit: FeedModel.pageSize
            ).items
            error = nil
        } catch {
            self.error = ErrorText.describe(error)
        }
    }

    /// Post a question; returns its id to open it.
    public func ask(title: String, body: String) async -> String? {
        guard !title.trimmed.isEmpty else { return nil }
        isPosting = true
        defer { isPosting = false }
        do {
            let id = try await audience.askQuestion(title: title, body: body)
            error = nil
            await load()
            return id
        } catch {
            self.error = ErrorText.describe(error)
            return nil
        }
    }
}

/// The KPIs tab: one series per metric name across every update.
@MainActor
public final class MetricsModel: ObservableObject {
    @Published public private(set) var series: [MetricSeries] = []
    @Published public private(set) var hasLoaded = false
    @Published public var error: String?

    public let audience: AudienceModel

    public init(audience: AudienceModel) { self.audience = audience }

    public func load() async {
        defer { hasLoaded = true }
        do {
            series = try await audience.client.listMetrics().filter { !$0.points.isEmpty }
            error = nil
        } catch {
            self.error = ErrorText.describe(error)
        }
    }

    /// The latest value's change since the report before it.
    nonisolated public static func latestDelta(_ series: MetricSeries) -> String? {
        guard series.points.count >= 2 else { return nil }
        return Metrics.delta(series.points[series.points.count - 2].value, series.points[series.points.count - 1].value)
    }
}

/// The People tab: the team, the investors, your profile and what you follow;
/// for the team also engagement and "who read what".
@MainActor
public final class PeopleModel: ObservableObject {
    @Published public private(set) var people: [PersonView] = []
    @Published public private(set) var engagement: [EngagementRow] = []
    @Published public private(set) var hasLoaded = false
    /// The account a teammate change is in flight for.
    @Published public private(set) var pending: String?
    @Published public var error: String?

    public let audience: AudienceModel

    public init(audience: AudienceModel) { self.audience = audience }

    public var team: [PersonView] { people.filter(\.isTeam) }
    public var investors: [PersonView] { people.filter { !$0.isTeam } }

    public func load() async {
        defer { hasLoaded = true }
        do {
            people = try await audience.client.listPeople()
            engagement = audience.isTeam ? try await audience.client.getEngagement() : []
            error = nil
        } catch {
            self.error = ErrorText.describe(error)
        }
    }

    /// Admins make a member a teammate, or take them off the team.
    public func toggleTeam(_ person: PersonView) async {
        pending = person.account
        defer { pending = nil }
        do {
            try await audience.setTeammate(person.account, on: !person.isTeam)
            await load()
        } catch {
            self.error = ErrorText.describe(error)
        }
    }

    /// "Read 3/4 (75%) · last read 2d ago · 1 reply · 2 offers (1 accepted)".
    nonisolated public static func engagementLine(_ p: PersonView, now: Date = Date()) -> String {
        let pct = Format.percent(p.updatesRead, of: p.updatesTotal)
        var line =
            "Read \(p.updatesRead)/\(p.updatesTotal) (\(pct)%) · last read \(Format.timeAgo(p.lastReadAt, now: now)) · "
            + "\(Format.plural(p.comments, "reply", "replies")) · \(Format.plural(p.offers, "offer"))"
        if p.acceptedOffers > 0 { line += " (\(p.acceptedOffers) accepted)" }
        return line
    }
}

/// Settings (team only): how the company appears and how updates are filed.
@MainActor
public final class SettingsModel: ObservableObject {
    @Published public var companyName = ""
    @Published public var cadenceDays: UInt32 = 30
    @Published public private(set) var hasLoaded = false
    @Published public private(set) var isSaving = false
    @Published public private(set) var saved = false
    @Published public var error: String?

    public let audience: AudienceModel

    public init(audience: AudienceModel) { self.audience = audience }

    public func load() async {
        guard !hasLoaded else { return }
        do {
            let settings = try await audience.client.getSettings()
            companyName = settings.companyName
            // An audience never saved has cadence 0 and updated_at 0: offer monthly.
            cadenceDays = settings.updatedAt > 0 ? settings.cadenceDays : 30
            hasLoaded = true
            error = nil
        } catch {
            self.error = ErrorText.describe(error)
        }
    }

    public func save() async -> Bool {
        isSaving = true
        defer { isSaving = false }
        do {
            let name = companyName.trimmed
            let cadence = cadenceDays
            try await audience.act { try await $0.setSettings(companyName: name, cadenceDays: cadence) }
            saved = true
            error = nil
            return true
        } catch {
            self.error = ErrorText.describe(error)
            return false
        }
    }

    public func createCategory(name: String, emoji: String, color: String) async -> Bool {
        await run { try await $0.createCategory(name: name.trimmed, emoji: emoji.trimmed, color: color) }
    }

    public func editCategory(_ id: String, name: String, emoji: String, color: String) async -> Bool {
        await run { try await $0.editCategory(categoryId: id, name: name.trimmed, emoji: emoji.trimmed, color: color) }
    }

    public func archiveCategory(_ id: String) async -> Bool {
        await run { try await $0.archiveCategory(categoryId: id) }
    }

    /// Monthly, Fundraising, Product, Hiring, Board: the ones not there yet.
    public func addStarters() async -> Bool {
        let existing = Set(audience.categories.map { $0.name.lowercased() })
        let missing = Catalog.starterCategories.filter { !existing.contains($0.name.lowercased()) }
        return await run { client in
            for c in missing { _ = try await client.createCategory(name: c.name, emoji: c.emoji, color: c.color) }
        }
    }

    private func run(_ write: (UpdatesClient) async throws -> Void) async -> Bool {
        do {
            try await audience.act(write)
            error = nil
            return true
        } catch {
            self.error = ErrorText.describe(error)
            return false
        }
    }
}
