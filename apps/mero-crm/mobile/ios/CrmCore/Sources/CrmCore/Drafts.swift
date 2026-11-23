import Foundation

/// What the deal sheets edit. Value is kept as typed (`12k`) and parsed on save.
public struct DealDraft: Equatable, Sendable {
    public var title = ""
    public var value = ""
    public var organization = ""
    /// The linked person, or nil for none.
    public var contactId: String?
    /// A person to create with the deal (New deal only): name and email.
    public var newContactName = ""
    public var newContactEmail = ""
    public var creatingContact = false
    public var stageId = ""
    /// The owner as stored (an account), or nil for unassigned.
    public var owner: String?
    public var hasClose = false
    public var expectedClose = Date()
    public var source = ""

    public init() {}

    /// The fields of an existing deal.
    public init(_ deal: DealView) {
        title = deal.title
        value = String(deal.value)
        organization = deal.organization
        contactId = deal.contactId
        stageId = deal.stageId
        owner = (deal.owner ?? "").isEmpty ? nil : deal.owner
        hasClose = deal.expectedClose != nil
        expectedClose = deal.expectedClose.map(Days.date) ?? Date()
        source = deal.source
    }

    public var parsedValue: UInt64? { Money.parse(value) }

    public var isValid: Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && parsedValue != nil && !stageId.isEmpty
            && (!creatingContact || !newContactName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }

    /// The close date as the contract keeps it: the picked day at local noon.
    public func closeMs(_ calendar: Calendar) -> UInt64? {
        hasClose ? Days.ms(Days.noon(expectedClose, calendar)) : nil
    }
}

/// What the person sheet edits.
public struct ContactDraft: Equatable, Sendable {
    public var name = ""
    public var organization = ""
    public var jobTitle = ""
    public var email = ""
    public var phone = ""

    public init() {}

    public init(_ c: ContactView) {
        name = c.name
        organization = c.organization
        jobTitle = c.jobTitle
        email = c.email
        phone = c.phone
    }

    public var isValid: Bool { !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    func trimmed(_ s: String) -> String { s.trimmingCharacters(in: .whitespacesAndNewlines) }
}

/// What the schedule sheet edits.
public struct ActivityDraft: Equatable, Sendable {
    public var kind: ActivityKind = .call
    public var subject = ""
    public var due = Date()
    public var dealId: String?
    public var note = ""

    public init(due: Date = Date(), dealId: String? = nil) {
        self.due = due
        self.dealId = dealId
    }

    public var isValid: Bool { !subject.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
}

/// The one-tap lost reasons (the web's `LostReasonModal`), which keep the report countable.
public enum LostReasons {
    public static let common = ["Price", "Chose a competitor", "No budget", "No decision", "Timing", "Bad fit", "Went dark"]
}
