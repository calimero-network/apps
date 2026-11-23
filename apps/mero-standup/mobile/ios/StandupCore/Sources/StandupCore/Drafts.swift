import Foundation

/// What the update sheet edits.
public struct UpdateDraft: Equatable, Sendable {
    public var done: String
    public var next: String
    public var blockers: String

    public init(done: String = "", next: String = "", blockers: String = "") {
        self.done = done
        self.next = next
        self.blockers = blockers
    }

    public init(_ update: UpdateView) {
        self.init(done: update.done, next: update.next, blockers: update.blockers)
    }

    /// Nothing worth posting: the contract wants at least one field.
    public var isEmpty: Bool {
        [done, next, blockers].allSatisfy { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }

    /// Today's starting point from your last update (the web's `carryForward`):
    /// what was NEXT is most likely DONE now, and a blocker usually outlives a
    /// day. Nothing is posted until you press Post.
    public static func carryForward(_ last: UpdateView?) -> UpdateDraft {
        guard let last else { return UpdateDraft() }
        return UpdateDraft(done: last.next, next: "", blockers: last.blockers)
    }
}

/// What the decision sheet edits.
public struct DecisionDraft: Equatable, Sendable {
    public var title = ""
    public var decision = ""
    public var rationale = ""
    public var tagsInput = ""
    public var with: Set<String> = []
    /// The standup day it came out of.
    public var fromDay: String?
    /// The decision this one replaces.
    public var supersedes: DecisionView?

    public init(fromDay: String? = nil, supersedes: DecisionView? = nil) {
        self.fromDay = fromDay
        self.supersedes = supersedes
        if let supersedes {
            tagsInput = supersedes.tags.joined(separator: ", ")
            with = Set(supersedes.with.map(\.account))
        }
    }

    /// The tags as the contract will store them.
    public var tags: [String] { Tags.parse(tagsInput) }

    /// A title and a decision: what the contract requires.
    public var isReady: Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !decision.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

/// Tags the way the contract normalizes them (the web's `lib/tags.ts`):
/// "Infra, release process" -> ["infra", "release-process"].
public enum Tags {
    public static func parse(_ input: String) -> [String] {
        let out = input.split(separator: ",", omittingEmptySubsequences: false).map { part in
            part.split(whereSeparator: { $0.isWhitespace }).joined(separator: "-").lowercased()
        }.filter { !$0.isEmpty }
        return Array(Set(out)).sorted()
    }
}

/// Limits the contract enforces, mirrored so the sheets can say so first.
public enum Limits {
    public static let field = 2_000
    public static let title = 200
    public static let body = 5_000
    public static let name = 64
    public static let teamName = 80
    public static let help = 500
    public static let tags = 8
}
