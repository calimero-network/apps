import Foundation
import MeroKit

// The audience's types, as the v1 client typed them (snake_case fields, u64s as numbers). The calls
// are the generated `UpdatesClient` (`Generated/`, `scripts/mobile-codegen.sh` at the repo root),
// which speaks the component ABI and takes and answers its own typed records; `ComponentWire`
// converts between them and these types through their JSON (`decoded(as:)`, `JSONValue.wire(_:)`,
// `converted()`).

extension Encodable {
    /// This answer as the app type `T` (one of the types below), read through
    /// ``ComponentWire/incoming(_:)``.
    public func decoded<T: Decodable>(as type: T.Type) throws -> T {
        try JSONDecoder().decode(type, from: try ComponentWire.incoming(MeroJSON.encode(self)))
    }

    /// This value as the generated client's type `T` (an argument), through its JSON.
    public func converted<T: Decodable>() throws -> T {
        try MeroJSON.decode(T.self, from: MeroJSON.encode(self))
    }
}

extension JSONValue {
    /// `value` (one of the types below) as the contract takes it: camelCase keys.
    public static func wire<T: Encodable>(_ value: T) throws -> JSONValue {
        let object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(value), options: [.fragmentsAllowed])
        let data = try JSONSerialization.data(withJSONObject: ComponentWire.toWire(object), options: [.fragmentsAllowed])
        return try JSONDecoder().decode(JSONValue.self, from: data)
    }
}

// MARK: - Types

/// A structured request inside an update. Same three axes as `Post`.
public struct Ask: Codable, Sendable, Equatable {
    public var id: String
    /// An update's asks are one seek, not a scan of every ask.
    public var postId: String
    public var content: AskContent
    public var editedAt: UInt64
    public var createdAt: UInt64
    public var status: String
    public var statusAt: UInt64
    public var deleted: Bool

    public init(id: String, postId: String, content: AskContent, editedAt: UInt64, createdAt: UInt64, status: String, statusAt: UInt64, deleted: Bool) {
        self.id = id
        self.postId = postId
        self.content = content
        self.editedAt = editedAt
        self.createdAt = createdAt
        self.status = status
        self.statusAt = statusAt
        self.deleted = deleted
    }

    enum CodingKeys: String, CodingKey {
        case id
        case postId = "post_id"
        case content
        case editedAt = "edited_at"
        case createdAt = "created_at"
        case status
        case statusAt = "status_at"
        case deleted
    }
}

public struct AskContent: Codable, Sendable, Equatable {
    public var kind: String
    public var title: String
    public var detail: String

    public init(kind: String, title: String, detail: String) {
        self.kind = kind
        self.title = title
        self.detail = detail
    }
}

public struct AskInput: Codable, Sendable, Equatable {
    /// Set to edit an existing ask of this update; `None` creates one.
    public var id: String?
    public var kind: String
    public var title: String
    public var detail: String

    public init(id: String? = nil, kind: String, title: String, detail: String) {
        self.id = id
        self.kind = kind
        self.title = title
        self.detail = detail
    }
}

public struct AskView: Codable, Sendable, Equatable {
    public var id: String
    public var postId: String
    public var postTitle: String
    public var kind: String
    public var title: String
    public var detail: String
    public var status: String
    public var createdAt: UInt64
    public var offerCount: UInt64
    /// Every offer — for the TEAM only; empty for readers. A presentation
    /// filter, not confidentiality (see the module docs).
    public var offers: [OfferView]
    /// The caller's own offer, if any.
    public var myOffer: OfferView?

    public init(id: String, postId: String, postTitle: String, kind: String, title: String, detail: String, status: String, createdAt: UInt64, offerCount: UInt64, offers: [OfferView], myOffer: OfferView? = nil) {
        self.id = id
        self.postId = postId
        self.postTitle = postTitle
        self.kind = kind
        self.title = title
        self.detail = detail
        self.status = status
        self.createdAt = createdAt
        self.offerCount = offerCount
        self.offers = offers
        self.myOffer = myOffer
    }

    enum CodingKeys: String, CodingKey {
        case id
        case postId = "post_id"
        case postTitle = "post_title"
        case kind
        case title
        case detail
        case status
        case createdAt = "created_at"
        case offerCount = "offer_count"
        case offers
        case myOffer = "my_offer"
    }
}

public struct Category: Codable, Sendable, Equatable {
    public var id: String
    public var name: String
    public var emoji: String
    /// A CSS colour token or hex. Presentation only.
    public var color: String
    public var createdAt: UInt64
    public var editedAt: UInt64
    public var archived: Bool

    public init(id: String, name: String, emoji: String, color: String, createdAt: UInt64, editedAt: UInt64, archived: Bool) {
        self.id = id
        self.name = name
        self.emoji = emoji
        self.color = color
        self.createdAt = createdAt
        self.editedAt = editedAt
        self.archived = archived
    }

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case emoji
        case color
        case createdAt = "created_at"
        case editedAt = "edited_at"
        case archived
    }
}

public struct CategoryView: Codable, Sendable, Equatable {
    public var id: String
    public var name: String
    public var emoji: String
    public var color: String
    public var updateCount: UInt64
    public var unreadCount: UInt64
    public var muted: Bool

    public init(id: String, name: String, emoji: String, color: String, updateCount: UInt64, unreadCount: UInt64, muted: Bool) {
        self.id = id
        self.name = name
        self.emoji = emoji
        self.color = color
        self.updateCount = updateCount
        self.unreadCount = unreadCount
        self.muted = muted
    }

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case emoji
        case color
        case updateCount = "update_count"
        case unreadCount = "unread_count"
        case muted
    }
}

/// A reply on a post. One level of nesting via `parent_id` ("" for top level).
///
/// No author field: the author is the entry's owner stamp. Deleting removes the
/// entry — its owner, or a moderator, may.
public struct Comment: Codable, Sendable, Equatable {
    public var id: String
    public var postId: String
    public var parentId: String
    public var body: String
    public var createdAt: UInt64
    public var editedAt: UInt64

    public init(id: String, postId: String, parentId: String, body: String, createdAt: UInt64, editedAt: UInt64) {
        self.id = id
        self.postId = postId
        self.parentId = parentId
        self.body = body
        self.createdAt = createdAt
        self.editedAt = editedAt
    }

    enum CodingKeys: String, CodingKey {
        case id
        case postId = "post_id"
        case parentId = "parent_id"
        case body
        case createdAt = "created_at"
        case editedAt = "edited_at"
    }
}

public struct CommentView: Codable, Sendable, Equatable {
    public var id: String
    public var postId: String
    public var parentId: String
    public var author: String
    public var authorName: String
    public var authorIsTeam: Bool
    public var body: String
    public var createdAt: UInt64
    public var editedAt: UInt64

    public init(id: String, postId: String, parentId: String, author: String, authorName: String, authorIsTeam: Bool, body: String, createdAt: UInt64, editedAt: UInt64) {
        self.id = id
        self.postId = postId
        self.parentId = parentId
        self.author = author
        self.authorName = authorName
        self.authorIsTeam = authorIsTeam
        self.body = body
        self.createdAt = createdAt
        self.editedAt = editedAt
    }

    enum CodingKeys: String, CodingKey {
        case id
        case postId = "post_id"
        case parentId = "parent_id"
        case author
        case authorName = "author_name"
        case authorIsTeam = "author_is_team"
        case body
        case createdAt = "created_at"
        case editedAt = "edited_at"
    }
}

public struct ContributionView: Codable, Sendable, Equatable {
    public var askId: String
    public var askTitle: String
    public var askKind: String
    public var account: String
    public var name: String
    public var firm: String
    public var note: String
    public var acceptedAt: UInt64

    public init(askId: String, askTitle: String, askKind: String, account: String, name: String, firm: String, note: String, acceptedAt: UInt64) {
        self.askId = askId
        self.askTitle = askTitle
        self.askKind = askKind
        self.account = account
        self.name = name
        self.firm = firm
        self.note = note
        self.acceptedAt = acceptedAt
    }

    enum CodingKeys: String, CodingKey {
        case askId = "ask_id"
        case askTitle = "ask_title"
        case askKind = "ask_kind"
        case account
        case name
        case firm
        case note
        case acceptedAt = "accepted_at"
    }
}

public struct DraftView: Codable, Sendable, Equatable {
    public var id: String
    public var title: String
    public var payload: String
    public var updatedAt: UInt64

    public init(id: String, title: String, payload: String, updatedAt: UInt64) {
        self.id = id
        self.title = title
        self.payload = payload
        self.updatedAt = updatedAt
    }

    enum CodingKeys: String, CodingKey {
        case id
        case title
        case payload
        case updatedAt = "updated_at"
    }
}

public struct EngagementRow: Codable, Sendable, Equatable {
    public var postId: String
    public var title: String
    public var categoryId: String
    public var publishedAt: UInt64
    public var readers: [ReaderView]
    /// Non-team members with a profile who have not opened it: the follow-up
    /// list.
    public var notRead: [ReaderView]
    public var reactions: UInt64
    public var comments: UInt64
    public var offers: UInt64

    public init(postId: String, title: String, categoryId: String, publishedAt: UInt64, readers: [ReaderView], notRead: [ReaderView], reactions: UInt64, comments: UInt64, offers: UInt64) {
        self.postId = postId
        self.title = title
        self.categoryId = categoryId
        self.publishedAt = publishedAt
        self.readers = readers
        self.notRead = notRead
        self.reactions = reactions
        self.comments = comments
        self.offers = offers
    }

    enum CodingKeys: String, CodingKey {
        case postId = "post_id"
        case title
        case categoryId = "category_id"
        case publishedAt = "published_at"
        case readers
        case notRead = "not_read"
        case reactions
        case comments
        case offers
    }
}

public struct Event_AskChanged: Codable, Sendable, Equatable {
    public var postId: String
    public var askId: String

    public init(postId: String, askId: String) {
        self.postId = postId
        self.askId = askId
    }

    enum CodingKeys: String, CodingKey {
        case postId = "post_id"
        case askId = "ask_id"
    }
}

public struct Event_CategoryChanged: Codable, Sendable, Equatable {
    public var id: String

    public init(id: String) {
        self.id = id
    }
}

public struct Event_Commented: Codable, Sendable, Equatable {
    public var postId: String
    public var id: String

    public init(postId: String, id: String) {
        self.postId = postId
        self.id = id
    }

    enum CodingKeys: String, CodingKey {
        case postId = "post_id"
        case id
    }
}

public struct Event_OfferChanged: Codable, Sendable, Equatable {
    public var postId: String
    public var askId: String

    public init(postId: String, askId: String) {
        self.postId = postId
        self.askId = askId
    }

    enum CodingKeys: String, CodingKey {
        case postId = "post_id"
        case askId = "ask_id"
    }
}

public struct Event_PostDeleted: Codable, Sendable, Equatable {
    public var id: String

    public init(id: String) {
        self.id = id
    }
}

public struct Event_PostEdited: Codable, Sendable, Equatable {
    public var id: String

    public init(id: String) {
        self.id = id
    }
}

public struct Event_ProfileSet: Codable, Sendable, Equatable {
    public var account: String

    public init(account: String) {
        self.account = account
    }
}

public struct Event_QuestionAsked: Codable, Sendable, Equatable {
    public var id: String

    public init(id: String) {
        self.id = id
    }
}

public struct Event_Reacted: Codable, Sendable, Equatable {
    public var postId: String

    public init(postId: String) {
        self.postId = postId
    }

    enum CodingKeys: String, CodingKey {
        case postId = "post_id"
    }
}

public struct Event_Read: Codable, Sendable, Equatable {
    public var postId: String

    public init(postId: String) {
        self.postId = postId
    }

    enum CodingKeys: String, CodingKey {
        case postId = "post_id"
    }
}

public struct Event_StatusChanged: Codable, Sendable, Equatable {
    public var postId: String

    public init(postId: String) {
        self.postId = postId
    }

    enum CodingKeys: String, CodingKey {
        case postId = "post_id"
    }
}

public struct Event_TeamChanged: Codable, Sendable, Equatable {
    public var account: String

    public init(account: String) {
        self.account = account
    }
}

public struct Event_UpdatePublished: Codable, Sendable, Equatable {
    public var id: String

    public init(id: String) {
        self.id = id
    }
}

public struct MeView: Codable, Sendable, Equatable {
    public var account: String
    public var name: String
    public var firm: String
    public var isAdmin: Bool
    public var isTeam: Bool
    public var muted: [String]

    public init(account: String, name: String, firm: String, isAdmin: Bool, isTeam: Bool, muted: [String]) {
        self.account = account
        self.name = name
        self.firm = firm
        self.isAdmin = isAdmin
        self.isTeam = isTeam
        self.muted = muted
    }

    enum CodingKeys: String, CodingKey {
        case account
        case name
        case firm
        case isAdmin = "is_admin"
        case isTeam = "is_team"
        case muted
    }
}

public struct MeroUpdates: Codable, Sendable, Equatable {
    /// Admin tier = the signed writer set; `team` grants are verified at merge.
    public var roles: [String: Bool]
    public var settings: [String: Settings]
    public var categories: [String: Category]
    /// Flat maps keyed by id, carrying their parent's id — never a nested
    /// collection per parent, which would need deterministic re-keying to
    /// converge when two nodes create it independently.
    public var updates: [String: Post]
    public var asks: [String: Ask]
    /// The team's status for a question, keyed by the question's id.
    public var questionStatus: [String: Triage]
    /// The team's status for an offer, keyed like the offer.
    public var offerStatus: [String: Triage]
    public var questions: [String: Post]
    public var comments: [String: Comment]
    public var offers: [String: Offer]
    public var reactions: [String: Reaction]
    public var reads: [String: Read]
    public var profiles: [String: Profile]
    /// Which categories each reader has muted. Its own slot, not a profile
    /// field, so renaming yourself on one device and muting on another both
    /// survive: a `UserStorage` slot resolves last-writer-wins as a whole.
    public var mutes: [String: [String]]

    public init(roles: [String: Bool], settings: [String: Settings], categories: [String: Category], updates: [String: Post], asks: [String: Ask], questionStatus: [String: Triage], offerStatus: [String: Triage], questions: [String: Post], comments: [String: Comment], offers: [String: Offer], reactions: [String: Reaction], reads: [String: Read], profiles: [String: Profile], mutes: [String: [String]]) {
        self.roles = roles
        self.settings = settings
        self.categories = categories
        self.updates = updates
        self.asks = asks
        self.questionStatus = questionStatus
        self.offerStatus = offerStatus
        self.questions = questions
        self.comments = comments
        self.offers = offers
        self.reactions = reactions
        self.reads = reads
        self.profiles = profiles
        self.mutes = mutes
    }

    enum CodingKeys: String, CodingKey {
        case roles
        case settings
        case categories
        case updates
        case asks
        case questionStatus = "question_status"
        case offerStatus = "offer_status"
        case questions
        case comments
        case offers
        case reactions
        case reads
        case profiles
        case mutes
    }
}

/// One KPI as reported in one update.
///
/// `value` is a STRING on purpose: founders write "$1.2M", "38%", "12.5k", and
/// the number they meant is the frontend's to parse. The contract keeps what
/// was reported, exactly as reported.
public struct Metric: Codable, Sendable, Equatable {
    public var name: String
    public var value: String
    public var unit: String

    public init(name: String, value: String, unit: String) {
        self.name = name
        self.value = value
        self.unit = unit
    }
}

public struct MetricPoint: Codable, Sendable, Equatable {
    public var postId: String
    public var postTitle: String
    public var at: UInt64
    public var value: String

    public init(postId: String, postTitle: String, at: UInt64, value: String) {
        self.postId = postId
        self.postTitle = postTitle
        self.at = at
        self.value = value
    }

    enum CodingKeys: String, CodingKey {
        case postId = "post_id"
        case postTitle = "post_title"
        case at
        case value
    }
}

public struct MetricSeries: Codable, Sendable, Equatable {
    public var name: String
    public var unit: String
    /// Oldest first, one point per update that reported this metric.
    public var points: [MetricPoint]

    public init(name: String, unit: String, points: [MetricPoint]) {
        self.name = name
        self.unit = unit
        self.points = points
    }
}

/// One reader's offer to help with one ask. Keyed `"<ask_id>|<account>"`, and
/// owned by that account.
///
/// Two writers, so two records: the HELPER owns this one (`note`/`withdrawn`,
/// by `updated_at`), the TEAM owns its [`Triage`] under the same key. Accepting
/// an offer must not be undone by the helper fixing a typo in their note, and a
/// helper must not be able to accept their own.
public struct Offer: Codable, Sendable, Equatable {
    public var askId: String
    public var account: String
    public var helper: OfferByHelper
    public var updatedAt: UInt64
    public var createdAt: UInt64

    public init(askId: String, account: String, helper: OfferByHelper, updatedAt: UInt64, createdAt: UInt64) {
        self.askId = askId
        self.account = account
        self.helper = helper
        self.updatedAt = updatedAt
        self.createdAt = createdAt
    }

    enum CodingKeys: String, CodingKey {
        case askId = "ask_id"
        case account
        case helper
        case updatedAt = "updated_at"
        case createdAt = "created_at"
    }
}

public struct OfferByHelper: Codable, Sendable, Equatable {
    public var note: String
    public var withdrawn: Bool

    public init(note: String, withdrawn: Bool) {
        self.note = note
        self.withdrawn = withdrawn
    }
}

public struct OfferView: Codable, Sendable, Equatable {
    public var askId: String
    public var account: String
    public var name: String
    public var firm: String
    public var note: String
    public var status: String
    public var createdAt: UInt64
    public var updatedAt: UInt64

    public init(askId: String, account: String, name: String, firm: String, note: String, status: String, createdAt: UInt64, updatedAt: UInt64) {
        self.askId = askId
        self.account = account
        self.name = name
        self.firm = firm
        self.note = note
        self.status = status
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    enum CodingKeys: String, CodingKey {
        case askId = "ask_id"
        case account
        case name
        case firm
        case note
        case status
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

public struct Overview: Codable, Sendable, Equatable {
    public var companyName: String
    public var cadenceDays: UInt32
    /// When the latest update went out, 0 if none has.
    public var lastUpdateAt: UInt64
    /// `last_update_at + cadence`, 0 when there is no cadence or no update yet.
    public var nextDueAt: UInt64
    public var updatesTotal: UInt64
    /// Unread updates in categories the caller has NOT muted.
    public var unreadUpdates: UInt64
    public var openAsks: UInt64
    public var openQuestions: UInt64
    public var people: UInt64
    public var isTeam: Bool

    public init(companyName: String, cadenceDays: UInt32, lastUpdateAt: UInt64, nextDueAt: UInt64, updatesTotal: UInt64, unreadUpdates: UInt64, openAsks: UInt64, openQuestions: UInt64, people: UInt64, isTeam: Bool) {
        self.companyName = companyName
        self.cadenceDays = cadenceDays
        self.lastUpdateAt = lastUpdateAt
        self.nextDueAt = nextDueAt
        self.updatesTotal = updatesTotal
        self.unreadUpdates = unreadUpdates
        self.openAsks = openAsks
        self.openQuestions = openQuestions
        self.people = people
        self.isTeam = isTeam
    }

    enum CodingKeys: String, CodingKey {
        case companyName = "company_name"
        case cadenceDays = "cadence_days"
        case lastUpdateAt = "last_update_at"
        case nextDueAt = "next_due_at"
        case updatesTotal = "updates_total"
        case unreadUpdates = "unread_updates"
        case openAsks = "open_asks"
        case openQuestions = "open_questions"
        case people
        case isTeam = "is_team"
    }
}

public struct PersonView: Codable, Sendable, Equatable {
    public var account: String
    public var name: String
    public var firm: String
    public var isAdmin: Bool
    public var isTeam: Bool
    public var joinedAt: UInt64
    /// Updates this person has opened, out of `updates_total`.
    public var updatesRead: UInt64
    public var updatesTotal: UInt64
    public var lastReadAt: UInt64
    public var comments: UInt64
    public var offers: UInt64
    public var acceptedOffers: UInt64

    public init(account: String, name: String, firm: String, isAdmin: Bool, isTeam: Bool, joinedAt: UInt64, updatesRead: UInt64, updatesTotal: UInt64, lastReadAt: UInt64, comments: UInt64, offers: UInt64, acceptedOffers: UInt64) {
        self.account = account
        self.name = name
        self.firm = firm
        self.isAdmin = isAdmin
        self.isTeam = isTeam
        self.joinedAt = joinedAt
        self.updatesRead = updatesRead
        self.updatesTotal = updatesTotal
        self.lastReadAt = lastReadAt
        self.comments = comments
        self.offers = offers
        self.acceptedOffers = acceptedOffers
    }

    enum CodingKeys: String, CodingKey {
        case account
        case name
        case firm
        case isAdmin = "is_admin"
        case isTeam = "is_team"
        case joinedAt = "joined_at"
        case updatesRead = "updates_read"
        case updatesTotal = "updates_total"
        case lastReadAt = "last_read_at"
        case comments
        case offers
        case acceptedOffers = "accepted_offers"
    }
}

/// An update or a question.
///
/// Three independent merge axes: CONTENT (the author's edits, by `edited_at`),
/// STATUS (the team's triage of a question, by `status_at`) and the tombstone
/// (OR). Folding status into content would let an author's typo fix silently
/// undo "answered", or the reverse.
public struct Post: Codable, Sendable, Equatable {
    public var id: String
    public var kind: String
    public var author: String
    public var content: PostContent
    public var editedAt: UInt64
    public var createdAt: UInt64
    public var status: String
    public var statusAt: UInt64
    public var deleted: Bool

    public init(id: String, kind: String, author: String, content: PostContent, editedAt: UInt64, createdAt: UInt64, status: String, statusAt: UInt64, deleted: Bool) {
        self.id = id
        self.kind = kind
        self.author = author
        self.content = content
        self.editedAt = editedAt
        self.createdAt = createdAt
        self.status = status
        self.statusAt = statusAt
        self.deleted = deleted
    }

    enum CodingKeys: String, CodingKey {
        case id
        case kind
        case author
        case content
        case editedAt = "edited_at"
        case createdAt = "created_at"
        case status
        case statusAt = "status_at"
        case deleted
    }
}

public struct PostCard: Codable, Sendable, Equatable {
    public var id: String
    public var kind: String
    public var author: String
    public var authorName: String
    public var authorIsTeam: Bool
    public var title: String
    public var summary: String
    public var categoryId: String
    public var status: String
    public var createdAt: UInt64
    public var editedAt: UInt64
    public var commentCount: UInt64
    public var askCount: UInt64
    public var openAskCount: UInt64
    public var metricCount: UInt64
    public var readCount: UInt64
    public var readByMe: Bool
    public var reactions: [ReactionCount]

    public init(id: String, kind: String, author: String, authorName: String, authorIsTeam: Bool, title: String, summary: String, categoryId: String, status: String, createdAt: UInt64, editedAt: UInt64, commentCount: UInt64, askCount: UInt64, openAskCount: UInt64, metricCount: UInt64, readCount: UInt64, readByMe: Bool, reactions: [ReactionCount]) {
        self.id = id
        self.kind = kind
        self.author = author
        self.authorName = authorName
        self.authorIsTeam = authorIsTeam
        self.title = title
        self.summary = summary
        self.categoryId = categoryId
        self.status = status
        self.createdAt = createdAt
        self.editedAt = editedAt
        self.commentCount = commentCount
        self.askCount = askCount
        self.openAskCount = openAskCount
        self.metricCount = metricCount
        self.readCount = readCount
        self.readByMe = readByMe
        self.reactions = reactions
    }

    enum CodingKeys: String, CodingKey {
        case id
        case kind
        case author
        case authorName = "author_name"
        case authorIsTeam = "author_is_team"
        case title
        case summary
        case categoryId = "category_id"
        case status
        case createdAt = "created_at"
        case editedAt = "edited_at"
        case commentCount = "comment_count"
        case askCount = "ask_count"
        case openAskCount = "open_ask_count"
        case metricCount = "metric_count"
        case readCount = "read_count"
        case readByMe = "read_by_me"
        case reactions
    }
}

public struct PostContent: Codable, Sendable, Equatable {
    public var title: String
    public var summary: String
    public var categoryId: String
    public var sections: [Section]
    public var metrics: [Metric]

    public init(title: String, summary: String, categoryId: String, sections: [Section], metrics: [Metric]) {
        self.title = title
        self.summary = summary
        self.categoryId = categoryId
        self.sections = sections
        self.metrics = metrics
    }

    enum CodingKeys: String, CodingKey {
        case title
        case summary
        case categoryId = "category_id"
        case sections
        case metrics
    }
}

public struct PostPage: Codable, Sendable, Equatable {
    public var items: [PostCard]
    public var nextCursor: String?

    public init(items: [PostCard], nextCursor: String? = nil) {
        self.items = items
        self.nextCursor = nextCursor
    }

    enum CodingKeys: String, CodingKey {
        case items
        case nextCursor = "next_cursor"
    }
}

public struct PostView: Codable, Sendable, Equatable {
    public var card: PostCard
    public var sections: [Section]
    public var metrics: [Metric]
    public var asks: [AskView]

    public init(card: PostCard, sections: [Section], metrics: [Metric], asks: [AskView]) {
        self.card = card
        self.sections = sections
        self.metrics = metrics
        self.asks = asks
    }
}

/// Who a member says they are. A claim, not an identity: the account id is
/// the only thing that authorises anything.
public struct Profile: Codable, Sendable, Equatable {
    public var account: String
    public var name: String
    /// Fund, firm or company — "Seed Capital", "Angel".
    public var firm: String
    public var joinedAt: UInt64
    public var updatedAt: UInt64

    public init(account: String, name: String, firm: String, joinedAt: UInt64, updatedAt: UInt64) {
        self.account = account
        self.name = name
        self.firm = firm
        self.joinedAt = joinedAt
        self.updatedAt = updatedAt
    }

    enum CodingKeys: String, CodingKey {
        case account
        case name
        case firm
        case joinedAt = "joined_at"
        case updatedAt = "updated_at"
    }
}

/// One account's one emoji on one post. Keyed `"<post_id>|<account>|<emoji>"`,
/// so reacting twice cannot count twice and a second device is the same person.
public struct Reaction: Codable, Sendable, Equatable {
    public var postId: String
    public var account: String
    public var emoji: String
    public var on: Bool
    public var updatedAt: UInt64

    public init(postId: String, account: String, emoji: String, on: Bool, updatedAt: UInt64) {
        self.postId = postId
        self.account = account
        self.emoji = emoji
        self.on = on
        self.updatedAt = updatedAt
    }

    enum CodingKeys: String, CodingKey {
        case postId = "post_id"
        case account
        case emoji
        case on
        case updatedAt = "updated_at"
    }
}

public struct ReactionCount: Codable, Sendable, Equatable {
    public var emoji: String
    public var count: UInt64
    public var mine: Bool

    public init(emoji: String, count: UInt64, mine: Bool) {
        self.emoji = emoji
        self.count = count
        self.mine = mine
    }
}

/// A read receipt. Keyed `"<post_id>|<account>"`. Both ends are monotone
/// (first read = min, latest = max), so this merges without any clock
/// tie-break at all.
public struct Read: Codable, Sendable, Equatable {
    public var postId: String
    public var account: String
    public var firstAt: UInt64
    public var lastAt: UInt64

    public init(postId: String, account: String, firstAt: UInt64, lastAt: UInt64) {
        self.postId = postId
        self.account = account
        self.firstAt = firstAt
        self.lastAt = lastAt
    }

    enum CodingKeys: String, CodingKey {
        case postId = "post_id"
        case account
        case firstAt = "first_at"
        case lastAt = "last_at"
    }
}

public struct ReaderView: Codable, Sendable, Equatable {
    public var account: String
    public var name: String
    public var firm: String
    public var firstAt: UInt64

    public init(account: String, name: String, firm: String, firstAt: UInt64) {
        self.account = account
        self.name = name
        self.firm = firm
        self.firstAt = firstAt
    }

    enum CodingKeys: String, CodingKey {
        case account
        case name
        case firm
        case firstAt = "first_at"
    }
}

/// One block of an update: "Highlights", "Lowlights", "Product", "Thanks"…
public struct Section: Codable, Sendable, Equatable {
    /// A template hint ("highlights", "lowlights", "product", "team", "text"…).
    /// Free text so templates can evolve without a contract release.
    public var kind: String
    public var title: String
    public var body: String

    public init(kind: String, title: String, body: String) {
        self.kind = kind
        self.title = title
        self.body = body
    }
}

/// Audience-wide settings, stored under the single key `"main"`.
public struct Settings: Codable, Sendable, Equatable {
    public var companyName: String
    /// How often the team means to write, in days. 0 = no cadence. Drives the
    /// "next update due" nudge — Visible's recurring-update reminder, without a
    /// server to send it.
    public var cadenceDays: UInt32
    public var updatedAt: UInt64

    public init(companyName: String, cadenceDays: UInt32, updatedAt: UInt64) {
        self.companyName = companyName
        self.cadenceDays = cadenceDays
        self.updatedAt = updatedAt
    }

    enum CodingKeys: String, CodingKey {
        case companyName = "company_name"
        case cadenceDays = "cadence_days"
        case updatedAt = "updated_at"
    }
}

/// The team's decision on something a reader wrote: a question's status, an
/// offer's. Kept apart from the reader's record, in team-written storage.
public struct Triage: Codable, Sendable, Equatable {
    public var status: String
    public var statusAt: UInt64

    public init(status: String, statusAt: UInt64) {
        self.status = status
        self.statusAt = statusAt
    }

    enum CodingKeys: String, CodingKey {
        case status
        case statusAt = "status_at"
    }
}

public struct UpdateInput: Codable, Sendable, Equatable {
    public var title: String
    public var summary: String
    public var categoryId: String
    public var sections: [Section]
    public var metrics: [Metric]
    public var asks: [AskInput]

    public init(title: String, summary: String, categoryId: String, sections: [Section], metrics: [Metric], asks: [AskInput]) {
        self.title = title
        self.summary = summary
        self.categoryId = categoryId
        self.sections = sections
        self.metrics = metrics
        self.asks = asks
    }

    enum CodingKeys: String, CodingKey {
        case title
        case summary
        case categoryId = "category_id"
        case sections
        case metrics
        case asks
    }
}
