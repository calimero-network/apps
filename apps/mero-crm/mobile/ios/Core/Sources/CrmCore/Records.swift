import Foundation
import MeroKit

// The pipeline's answers, as Mero CRM's component ABI (`../../../../logic/res/abi.json`) declares
// them: v1's snake_case fields, every u64 a decimal string both ways. The calls are the generated
// `CrmClient` (`Sources/CrmGenerated`, `scripts/mobile-codegen.sh` at the repo root); until the
// logic derives `AbiType` the ABI names these types without their shape, so the client answers
// their JSON and they read it (`JSONValue.decoded(as:)`).

extension CrmClient {
    /// The contract's views, by ABI name.
    public static let views: Set<String> = [
        "getDeal", "getSettings", "listActivities", "listAutomations", "listContacts", "listDeals", "listStages",
    ]
    /// The contract's calls, by ABI name.
    public static let calls: Set<String> = [
        "addActivity", "addAutomation", "addNote", "addStage", "createContact", "createDeal",
        "deleteActivity", "deleteAutomation", "deleteContact", "deleteDeal", "deleteNote", "deleteStage",
        "markLost", "markWon", "moveDeal", "reopenDeal", "reorderStages", "rescheduleActivity",
        "setActivityDone", "setAutomationEnabled", "setCurrency", "setRottingDays", "updateContact",
        "updateDeal", "updateStage",
    ]
}

extension JSONValue {
    /// This answer as the app type `T` (one of the types below).
    public func decoded<T: Decodable>(as type: T.Type) throws -> T {
        try MeroJSON.decode(type, from: MeroJSON.encode(self))
    }
}

extension KeyedDecodingContainer {
    /// A u64 field: a decimal string on the wire (a number is taken too).
    func decodeU64(_ key: Key) throws -> UInt64 {
        if let text = try? decode(String.self, forKey: key) {
            guard let value = UInt64(text) else {
                throw DecodingError.dataCorruptedError(forKey: key, in: self, debugDescription: "not a u64: \(text)")
            }
            return value
        }
        return try decode(UInt64.self, forKey: key)
    }

    func decodeU64IfPresent(_ key: Key) throws -> UInt64? {
        guard contains(key), !(try decodeNil(forKey: key)) else { return nil }
        return try decodeU64(key)
    }
}

extension KeyedEncodingContainer {
    /// A u64 field as the wire carries it: a decimal string.
    mutating func encodeU64(_ value: UInt64, _ key: Key) throws { try encode(String(value), forKey: key) }

    mutating func encodeU64IfPresent(_ value: UInt64?, _ key: Key) throws {
        if let value { try encode(String(value), forKey: key) } else { try encodeNil(forKey: key) }
    }
}

// MARK: - Answers

public struct ActivityView: Codable, Sendable, Equatable {
    public var id: String
    public var dealId: String?
    /// The deal's title, resolved here so the to-do list needs no join.
    public var dealTitle: String?
    public var contactId: String?
    public var kind: String
    public var subject: String
    public var dueAt: UInt64
    public var done: Bool
    public var doneAt: UInt64?
    public var owner: String?
    public var note: String
    public var automationId: String?
    public var createdBy: String
    public var createdAt: UInt64

    public init(id: String, dealId: String? = nil, dealTitle: String? = nil, contactId: String? = nil, kind: String, subject: String, dueAt: UInt64, done: Bool, doneAt: UInt64? = nil, owner: String? = nil, note: String, automationId: String? = nil, createdBy: String, createdAt: UInt64) {
        self.id = id
        self.dealId = dealId
        self.dealTitle = dealTitle
        self.contactId = contactId
        self.kind = kind
        self.subject = subject
        self.dueAt = dueAt
        self.done = done
        self.doneAt = doneAt
        self.owner = owner
        self.note = note
        self.automationId = automationId
        self.createdBy = createdBy
        self.createdAt = createdAt
    }

    enum CodingKeys: String, CodingKey {
        case id
        case dealId = "deal_id"
        case dealTitle = "deal_title"
        case contactId = "contact_id"
        case kind
        case subject
        case dueAt = "due_at"
        case done
        case doneAt = "done_at"
        case owner
        case note
        case automationId = "automation_id"
        case createdBy = "created_by"
        case createdAt = "created_at"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        dealId = try c.decodeIfPresent(String.self, forKey: .dealId)
        dealTitle = try c.decodeIfPresent(String.self, forKey: .dealTitle)
        contactId = try c.decodeIfPresent(String.self, forKey: .contactId)
        kind = try c.decode(String.self, forKey: .kind)
        subject = try c.decode(String.self, forKey: .subject)
        dueAt = try c.decodeU64(.dueAt)
        done = try c.decode(Bool.self, forKey: .done)
        doneAt = try c.decodeU64IfPresent(.doneAt)
        owner = try c.decodeIfPresent(String.self, forKey: .owner)
        note = try c.decode(String.self, forKey: .note)
        automationId = try c.decodeIfPresent(String.self, forKey: .automationId)
        createdBy = try c.decode(String.self, forKey: .createdBy)
        createdAt = try c.decodeU64(.createdAt)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encodeIfPresent(dealId, forKey: .dealId)
        try c.encodeIfPresent(dealTitle, forKey: .dealTitle)
        try c.encodeIfPresent(contactId, forKey: .contactId)
        try c.encode(kind, forKey: .kind)
        try c.encode(subject, forKey: .subject)
        try c.encodeU64(dueAt, .dueAt)
        try c.encode(done, forKey: .done)
        try c.encodeU64IfPresent(doneAt, .doneAt)
        try c.encodeIfPresent(owner, forKey: .owner)
        try c.encode(note, forKey: .note)
        try c.encodeIfPresent(automationId, forKey: .automationId)
        try c.encode(createdBy, forKey: .createdBy)
        try c.encodeU64(createdAt, .createdAt)
    }
}

public struct AutomationView: Codable, Sendable, Equatable {
    public var id: String
    public var stageId: String
    public var kind: String
    public var subject: String
    public var dueInDays: UInt32
    public var enabled: Bool
    public var createdBy: String
    public var createdAt: UInt64

    public init(id: String, stageId: String, kind: String, subject: String, dueInDays: UInt32, enabled: Bool, createdBy: String, createdAt: UInt64) {
        self.id = id
        self.stageId = stageId
        self.kind = kind
        self.subject = subject
        self.dueInDays = dueInDays
        self.enabled = enabled
        self.createdBy = createdBy
        self.createdAt = createdAt
    }

    enum CodingKeys: String, CodingKey {
        case id
        case stageId = "stage_id"
        case kind
        case subject
        case dueInDays = "due_in_days"
        case enabled
        case createdBy = "created_by"
        case createdAt = "created_at"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        stageId = try c.decode(String.self, forKey: .stageId)
        kind = try c.decode(String.self, forKey: .kind)
        subject = try c.decode(String.self, forKey: .subject)
        dueInDays = try c.decode(UInt32.self, forKey: .dueInDays)
        enabled = try c.decode(Bool.self, forKey: .enabled)
        createdBy = try c.decode(String.self, forKey: .createdBy)
        createdAt = try c.decodeU64(.createdAt)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(stageId, forKey: .stageId)
        try c.encode(kind, forKey: .kind)
        try c.encode(subject, forKey: .subject)
        try c.encode(dueInDays, forKey: .dueInDays)
        try c.encode(enabled, forKey: .enabled)
        try c.encode(createdBy, forKey: .createdBy)
        try c.encodeU64(createdAt, .createdAt)
    }
}

public struct ContactView: Codable, Sendable, Equatable {
    public var id: String
    public var name: String
    public var email: String
    public var phone: String
    public var organization: String
    public var jobTitle: String
    public var openDeals: UInt32
    public var wonValue: UInt64
    public var createdBy: String
    public var createdAt: UInt64

    public init(id: String, name: String, email: String, phone: String, organization: String, jobTitle: String, openDeals: UInt32, wonValue: UInt64, createdBy: String, createdAt: UInt64) {
        self.id = id
        self.name = name
        self.email = email
        self.phone = phone
        self.organization = organization
        self.jobTitle = jobTitle
        self.openDeals = openDeals
        self.wonValue = wonValue
        self.createdBy = createdBy
        self.createdAt = createdAt
    }

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case email
        case phone
        case organization
        case jobTitle = "job_title"
        case openDeals = "open_deals"
        case wonValue = "won_value"
        case createdBy = "created_by"
        case createdAt = "created_at"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        email = try c.decode(String.self, forKey: .email)
        phone = try c.decode(String.self, forKey: .phone)
        organization = try c.decode(String.self, forKey: .organization)
        jobTitle = try c.decode(String.self, forKey: .jobTitle)
        openDeals = try c.decode(UInt32.self, forKey: .openDeals)
        wonValue = try c.decodeU64(.wonValue)
        createdBy = try c.decode(String.self, forKey: .createdBy)
        createdAt = try c.decodeU64(.createdAt)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(name, forKey: .name)
        try c.encode(email, forKey: .email)
        try c.encode(phone, forKey: .phone)
        try c.encode(organization, forKey: .organization)
        try c.encode(jobTitle, forKey: .jobTitle)
        try c.encode(openDeals, forKey: .openDeals)
        try c.encodeU64(wonValue, .wonValue)
        try c.encode(createdBy, forKey: .createdBy)
        try c.encodeU64(createdAt, .createdAt)
    }
}

/// A deal with everything the detail page shows (named struct, never a tuple).
public struct DealDetail: Codable, Sendable, Equatable {
    public var deal: DealView
    public var contact: ContactView?
    public var activities: [ActivityView]
    public var notes: [NoteView]

    public init(deal: DealView, contact: ContactView? = nil, activities: [ActivityView], notes: [NoteView]) {
        self.deal = deal
        self.contact = contact
        self.activities = activities
        self.notes = notes
    }
}

public struct DealView: Codable, Sendable, Equatable {
    public var id: String
    public var title: String
    public var value: UInt64
    public var organization: String
    public var contactId: String?
    /// The linked person's name, resolved here so the board needs no join.
    public var contactName: String?
    public var owner: String?
    public var stageId: String
    public var status: String
    public var lostReason: String
    public var expectedClose: UInt64?
    public var source: String
    /// Win probability: the stage's while open, 100 when won, 0 when lost.
    public var probability: UInt32
    public var stageEnteredAt: UInt64
    public var closedAt: UInt64?
    public var nextActivity: NextActivity?
    public var openActivities: UInt32
    /// The most recent completed activity or note, if any.
    public var lastTouchAt: UInt64?
    public var createdBy: String
    public var createdAt: UInt64

    public init(id: String, title: String, value: UInt64, organization: String, contactId: String? = nil, contactName: String? = nil, owner: String? = nil, stageId: String, status: String, lostReason: String, expectedClose: UInt64? = nil, source: String, probability: UInt32, stageEnteredAt: UInt64, closedAt: UInt64? = nil, nextActivity: NextActivity? = nil, openActivities: UInt32, lastTouchAt: UInt64? = nil, createdBy: String, createdAt: UInt64) {
        self.id = id
        self.title = title
        self.value = value
        self.organization = organization
        self.contactId = contactId
        self.contactName = contactName
        self.owner = owner
        self.stageId = stageId
        self.status = status
        self.lostReason = lostReason
        self.expectedClose = expectedClose
        self.source = source
        self.probability = probability
        self.stageEnteredAt = stageEnteredAt
        self.closedAt = closedAt
        self.nextActivity = nextActivity
        self.openActivities = openActivities
        self.lastTouchAt = lastTouchAt
        self.createdBy = createdBy
        self.createdAt = createdAt
    }

    enum CodingKeys: String, CodingKey {
        case id
        case title
        case value
        case organization
        case contactId = "contact_id"
        case contactName = "contact_name"
        case owner
        case stageId = "stage_id"
        case status
        case lostReason = "lost_reason"
        case expectedClose = "expected_close"
        case source
        case probability
        case stageEnteredAt = "stage_entered_at"
        case closedAt = "closed_at"
        case nextActivity = "next_activity"
        case openActivities = "open_activities"
        case lastTouchAt = "last_touch_at"
        case createdBy = "created_by"
        case createdAt = "created_at"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        title = try c.decode(String.self, forKey: .title)
        value = try c.decodeU64(.value)
        organization = try c.decode(String.self, forKey: .organization)
        contactId = try c.decodeIfPresent(String.self, forKey: .contactId)
        contactName = try c.decodeIfPresent(String.self, forKey: .contactName)
        owner = try c.decodeIfPresent(String.self, forKey: .owner)
        stageId = try c.decode(String.self, forKey: .stageId)
        status = try c.decode(String.self, forKey: .status)
        lostReason = try c.decode(String.self, forKey: .lostReason)
        expectedClose = try c.decodeU64IfPresent(.expectedClose)
        source = try c.decode(String.self, forKey: .source)
        probability = try c.decode(UInt32.self, forKey: .probability)
        stageEnteredAt = try c.decodeU64(.stageEnteredAt)
        closedAt = try c.decodeU64IfPresent(.closedAt)
        nextActivity = try c.decodeIfPresent(NextActivity.self, forKey: .nextActivity)
        openActivities = try c.decode(UInt32.self, forKey: .openActivities)
        lastTouchAt = try c.decodeU64IfPresent(.lastTouchAt)
        createdBy = try c.decode(String.self, forKey: .createdBy)
        createdAt = try c.decodeU64(.createdAt)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(title, forKey: .title)
        try c.encodeU64(value, .value)
        try c.encode(organization, forKey: .organization)
        try c.encodeIfPresent(contactId, forKey: .contactId)
        try c.encodeIfPresent(contactName, forKey: .contactName)
        try c.encodeIfPresent(owner, forKey: .owner)
        try c.encode(stageId, forKey: .stageId)
        try c.encode(status, forKey: .status)
        try c.encode(lostReason, forKey: .lostReason)
        try c.encodeU64IfPresent(expectedClose, .expectedClose)
        try c.encode(source, forKey: .source)
        try c.encode(probability, forKey: .probability)
        try c.encodeU64(stageEnteredAt, .stageEnteredAt)
        try c.encodeU64IfPresent(closedAt, .closedAt)
        try c.encodeIfPresent(nextActivity, forKey: .nextActivity)
        try c.encode(openActivities, forKey: .openActivities)
        try c.encodeU64IfPresent(lastTouchAt, .lastTouchAt)
        try c.encode(createdBy, forKey: .createdBy)
        try c.encodeU64(createdAt, .createdAt)
    }
}

/// The earliest open activity on a deal — the "next step" the board shows.
public struct NextActivity: Codable, Sendable, Equatable {
    public var id: String
    public var kind: String
    public var subject: String
    public var dueAt: UInt64

    public init(id: String, kind: String, subject: String, dueAt: UInt64) {
        self.id = id
        self.kind = kind
        self.subject = subject
        self.dueAt = dueAt
    }

    enum CodingKeys: String, CodingKey {
        case id
        case kind
        case subject
        case dueAt = "due_at"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        kind = try c.decode(String.self, forKey: .kind)
        subject = try c.decode(String.self, forKey: .subject)
        dueAt = try c.decodeU64(.dueAt)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(kind, forKey: .kind)
        try c.encode(subject, forKey: .subject)
        try c.encodeU64(dueAt, .dueAt)
    }
}

public struct NoteView: Codable, Sendable, Equatable {
    public var id: String
    public var dealId: String
    public var author: String
    public var body: String
    public var createdAt: UInt64

    public init(id: String, dealId: String, author: String, body: String, createdAt: UInt64) {
        self.id = id
        self.dealId = dealId
        self.author = author
        self.body = body
        self.createdAt = createdAt
    }

    enum CodingKeys: String, CodingKey {
        case id
        case dealId = "deal_id"
        case author
        case body
        case createdAt = "created_at"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        dealId = try c.decode(String.self, forKey: .dealId)
        author = try c.decode(String.self, forKey: .author)
        body = try c.decode(String.self, forKey: .body)
        createdAt = try c.decodeU64(.createdAt)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(dealId, forKey: .dealId)
        try c.encode(author, forKey: .author)
        try c.encode(body, forKey: .body)
        try c.encodeU64(createdAt, .createdAt)
    }
}

public struct Settings: Codable, Sendable, Equatable {
    public var currency: String
    public var rottingDays: UInt32

    public init(currency: String, rottingDays: UInt32) {
        self.currency = currency
        self.rottingDays = rottingDays
    }

    enum CodingKeys: String, CodingKey {
        case currency
        case rottingDays = "rotting_days"
    }
}

public struct StageView: Codable, Sendable, Equatable {
    public var id: String
    public var name: String
    public var probability: UInt32
    public var position: UInt32

    public init(id: String, name: String, probability: UInt32, position: UInt32) {
        self.id = id
        self.name = name
        self.probability = probability
        self.position = position
    }
}
