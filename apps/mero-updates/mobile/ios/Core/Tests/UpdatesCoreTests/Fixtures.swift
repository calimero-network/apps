import Foundation
import MeroKit
import MeroKitTestSupport

@testable import UpdatesCore

let me = String(repeating: "a1", count: 32)
let ana = String(repeating: "b2", count: 32)
let bo = String(repeating: "c3", count: 32)

/// A fixed "now" (Wed 2026-10-28, noon UTC) and a UTC calendar.
let utc: Calendar = {
    var c = Calendar(identifier: .gregorian)
    c.timeZone = TimeZone(identifier: "UTC")!
    c.locale = Locale(identifier: "en_US_POSIX")
    return c
}()
let fixedNow = utc.date(from: DateComponents(year: 2026, month: 10, day: 28, hour: 12))!
let nowMs = Format.ms(fixedNow)

/// `value` as the component contract answers it: camelCase keys, and every
/// `u64` field (``ComponentWire/u64Fields``) a decimal string.
func json<T: Encodable>(_ value: T) -> JSONValue {
    let data = try! JSONEncoder().encode(value)
    let wire = contractWire(try! JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]))
    return try! JSONDecoder().decode(
        JSONValue.self, from: try! JSONSerialization.data(withJSONObject: wire, options: [.fragmentsAllowed]))
}

private func contractWire(_ value: Any) -> Any {
    if let list = value as? [Any] { return list.map(contractWire) }
    guard let object = value as? [String: Any] else { return value }
    var out: [String: Any] = [:]
    for (key, v) in object {
        if ComponentWire.u64Fields.contains(key), let n = v as? NSNumber {
            out[ComponentWire.camel(key)] = n.stringValue
        } else {
            out[ComponentWire.camel(key)] = contractWire(v)
        }
    }
    return out
}

func card(
    _ id: String, title: String = "Update", kind: String = "update", author: String = me, category: String = "",
    status: String = "", readByMe: Bool = true, reactions: [ReactionCount] = []
) -> PostCard {
    PostCard(
        id: id, kind: kind, author: author, authorName: author == me ? "Me" : "Ana", authorIsTeam: author == me,
        title: title, summary: "", categoryId: category, status: status, createdAt: nowMs, editedAt: nowMs,
        commentCount: 0, askCount: 0, openAskCount: 0, metricCount: 0, readCount: 1, readByMe: readByMe,
        reactions: reactions)
}

func postView(_ card: PostCard, metrics: [Metric] = [], asks: [AskView] = [], sections: [Section] = []) -> PostView {
    PostView(card: card, sections: sections, metrics: metrics, asks: asks)
}

func person(_ account: String, name: String, team: Bool = false, admin: Bool = false) -> PersonView {
    PersonView(
        account: account, name: name, firm: "", isAdmin: admin, isTeam: team, joinedAt: 1, updatesRead: 1,
        updatesTotal: 2, lastReadAt: 1, comments: 0, offers: 0, acceptedOffers: 0)
}

/// A scripted audience: answers every view from these values, records every write.
final class FakeAudience: @unchecked Sendable {
    let backend = InMemoryAppBackend()
    var meView = MeView(account: me, name: "Me", firm: "", isAdmin: true, isTeam: true, muted: [])
    var overview = Overview(
        companyName: "Acme", cadenceDays: 30, lastUpdateAt: 0, nextDueAt: 0, updatesTotal: 0, unreadUpdates: 0,
        openAsks: 0, openQuestions: 0, people: 1, isTeam: true)
    var categories: [CategoryView] = []
    var posts: [PostCard] = []
    var questions: [PostCard] = []
    var postViews: [String: PostView] = [:]
    var comments: [CommentView] = []
    var drafts: [DraftView] = []
    var series: [MetricSeries] = []
    var people: [PersonView] = []
    var asks: [AskView] = []
    var contributions: [ContributionView] = []
    var settings = Settings(companyName: "Acme", cadenceDays: 14, updatedAt: 5)

    init() {
        backend.recording.setHandler { [weak self] call in self?.answer(call) ?? .null }
    }

    var recording: RecordingContextContract { backend.recording }

    func answer(_ call: RecordedContractCall) -> JSONValue? {
        switch call.method {
        case "getMe": return json(meView)
        case "getOverview": return json(overview)
        case "listCategories": return json(categories)
        case "listPosts":
            let kind = call.args["kind"]?.stringValue
            let category = call.args["categoryId"]?.stringValue
            var items = kind == "question" ? questions : posts
            if let category { items = items.filter { $0.categoryId == category } }
            if let limit = call.args["limit"]?.intValue { items = Array(items.prefix(limit)) }
            return json(PostPage(items: items, nextCursor: nil))
        case "getPost":
            return postViews[call.args["postId"]?.stringValue ?? ""].map(json) ?? .null
        case "listComments": return json(comments)
        case "listDrafts": return json(drafts)
        case "listMetrics": return json(series)
        case "listPeople": return json(people)
        case "getEngagement": return json([EngagementRow]())
        case "listAsks":
            let status = call.args["status"]?.stringValue
            return json(asks.filter { status == nil || $0.status == status })
        case "listContributions": return json(contributions)
        case "getSettings": return json(settings)
        case "saveDraft": return .string(call.args["draftId"]?.stringValue ?? "draft-1")
        case "publishUpdate": return "post-new"
        case "askQuestion": return "q-new"
        case "addComment": return "c-new"
        case "createCategory": return "cat-new"
        default: return .null
        }
    }

    @MainActor
    func audienceModel() async -> AudienceModel {
        let summary = AudienceSummary(
            companyId: "ns-1", audienceId: "grp-1", contextId: "ctx-1", name: "All investors", companyName: "Acme")
        let model = AudienceModel(audience: summary, contextId: "ctx-1", backend: backend)
        await model.load()
        return model
    }
}
