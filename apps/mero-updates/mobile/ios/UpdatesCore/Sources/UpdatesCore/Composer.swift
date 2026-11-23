import Foundation

/// The composer's working state: what a draft stores (as JSON, in the
/// contract's private storage) and what ``toInput()`` turns into the contract's
/// `UpdateInput` on publish. The JSON keys are the web app's
/// (`app/src/lib/templates.ts`), so a draft saved on the web opens here and the
/// other way round.
public struct ComposerState: Codable, Equatable, Sendable {
    public struct SectionDraft: Codable, Equatable, Sendable {
        public var kind: String
        public var title: String
        public var body: String
        public init(kind: String, title: String, body: String) {
            self.kind = kind
            self.title = title
            self.body = body
        }
    }

    public struct MetricDraft: Codable, Equatable, Sendable {
        public var name: String
        public var value: String
        public var unit: String
        public init(name: String, value: String, unit: String) {
            self.name = name
            self.value = value
            self.unit = unit
        }
    }

    public struct AskDraft: Codable, Equatable, Sendable {
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

        // `id` is written as `null`, not left out, as the web writes it.
        public func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(id, forKey: .id)
            try c.encode(kind, forKey: .kind)
            try c.encode(title, forKey: .title)
            try c.encode(detail, forKey: .detail)
        }
    }

    public var title: String
    public var summary: String
    public var categoryId: String
    public var sections: [SectionDraft]
    public var metrics: [MetricDraft]
    public var asks: [AskDraft]

    public init(
        title: String = "", summary: String = "", categoryId: String = "", sections: [SectionDraft] = [],
        metrics: [MetricDraft] = [], asks: [AskDraft] = []
    ) {
        self.title = title
        self.summary = summary
        self.categoryId = categoryId
        self.sections = sections
        self.metrics = metrics
        self.asks = asks
    }

    /// Lenient, like the web's `parseDraft`: a missing field is empty, not an error.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        title = (try? c.decode(String.self, forKey: .title)) ?? ""
        summary = (try? c.decode(String.self, forKey: .summary)) ?? ""
        categoryId = (try? c.decode(String.self, forKey: .categoryId)) ?? ""
        sections = (try? c.decode([SectionDraft].self, forKey: .sections)) ?? []
        metrics = (try? c.decode([MetricDraft].self, forKey: .metrics)) ?? []
        asks = (try? c.decode([AskDraft].self, forKey: .asks)) ?? []
    }

    /// The JSON a draft stores.
    public func payload() -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return (try? encoder.encode(self)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
    }

    /// A draft's payload back, or nil when it does not parse.
    public static func parse(_ payload: String) -> ComposerState? {
        guard let data = payload.data(using: .utf8),
            let root = try? JSONSerialization.jsonObject(with: data), root is [String: Any]
        else { return nil }
        return try? JSONDecoder().decode(ComposerState.self, from: data)
    }

    /// What `publish_update` gets: the draft with its blanks removed.
    public func toInput() -> UpdateInput {
        UpdateInput(
            title: title.trimmed,
            summary: summary.trimmed,
            categoryId: categoryId,
            sections: sections.filter { !$0.body.trimmed.isEmpty }
                .map { Section(kind: $0.kind, title: $0.title.trimmed, body: $0.body.trimmed) },
            metrics: metrics.filter { !$0.name.trimmed.isEmpty && !$0.value.trimmed.isEmpty }
                .map { Metric(name: $0.name.trimmed, value: $0.value.trimmed, unit: $0.unit.trimmed) },
            asks: asks.filter { !$0.title.trimmed.isEmpty }
                .map { AskInput(id: $0.id, kind: $0.kind, title: $0.title.trimmed, detail: $0.detail.trimmed) })
    }

    /// Why Publish is disabled, or nil when it is not.
    public var publishBlocker: String? {
        if title.trimmed.isEmpty { return "Give the update a title." }
        let input = toInput()
        if input.sections.isEmpty && input.metrics.isEmpty && input.summary.isEmpty {
            return "Write at least one section, KPI or summary."
        }
        return nil
    }
}

/// A starting shape for an update.
public struct UpdateTemplate: Hashable, Sendable, Identifiable {
    public struct SectionShape: Hashable, Sendable {
        public let kind: String
        public let title: String
        public let placeholder: String
    }

    public let id: String
    public let name: String
    public let description: String
    public let sections: [SectionShape]
    /// Pre-fill every KPI reported before, so nobody retypes last month's names.
    public let carryMetrics: Bool
    public let suggestedAsk: Bool

    public static let all: [UpdateTemplate] = [
        UpdateTemplate(
            id: "monthly", name: "Monthly update", description: "The classic: highlights, lowlights, KPIs and asks.",
            sections: [
                SectionShape(kind: "highlights", title: "Highlights", placeholder: "What went well this month?"),
                SectionShape(
                    kind: "lowlights", title: "Lowlights", placeholder: "What didn't — and what you're doing about it."),
                SectionShape(kind: "product", title: "Product", placeholder: "What shipped, what's next."),
                SectionShape(kind: "team", title: "Team", placeholder: "Hires, departures, open roles."),
            ], carryMetrics: true, suggestedAsk: true),
        UpdateTemplate(
            id: "quarterly", name: "Quarterly / board",
            description: "A fuller review: financials, goals vs actuals, next quarter.",
            sections: [
                SectionShape(kind: "summary", title: "Quarter in review", placeholder: "The three things that mattered."),
                SectionShape(kind: "financial", title: "Financials", placeholder: "Revenue, burn, runway, cash in bank."),
                SectionShape(
                    kind: "goals", title: "Goals vs actuals", placeholder: "What you said you'd do, and what happened."),
                SectionShape(kind: "next", title: "Next quarter", placeholder: "Goals and the plan to hit them."),
            ], carryMetrics: true, suggestedAsk: true),
        UpdateTemplate(
            id: "fundraising", name: "Fundraising", description: "Announce a round, share terms, ask for intros.",
            sections: [
                SectionShape(kind: "round", title: "The round", placeholder: "Amount, instrument, timing, who's leading."),
                SectionShape(kind: "why-now", title: "Why now", placeholder: "Traction and what the money unlocks."),
            ], carryMetrics: true, suggestedAsk: true),
        UpdateTemplate(
            id: "milestone", name: "Milestone", description: "One piece of news worth its own post.",
            sections: [SectionShape(kind: "text", title: "", placeholder: "What happened, and why it matters.")],
            carryMetrics: false, suggestedAsk: false),
        UpdateTemplate(
            id: "blank", name: "Blank", description: "Start from nothing.",
            sections: [SectionShape(kind: "text", title: "", placeholder: "Write your update…")],
            carryMetrics: false, suggestedAsk: false),
    ]

    public static func of(_ id: String?) -> UpdateTemplate { all.first { $0.id == id } ?? all[0] }

    /// The placeholder for a section of `kind`, from whichever template defines it.
    public static func placeholder(for kind: String) -> String {
        all.flatMap(\.sections).first { $0.kind == kind }?.placeholder ?? "Write…"
    }

    /// Sections the composer offers to add.
    public static let suggestions: [SectionShape] = [
        SectionShape(kind: "highlights", title: "Highlights", placeholder: ""),
        SectionShape(kind: "lowlights", title: "Lowlights", placeholder: ""),
        SectionShape(kind: "product", title: "Product", placeholder: ""),
        SectionShape(kind: "team", title: "Team", placeholder: ""),
        SectionShape(kind: "financial", title: "Financials", placeholder: ""),
        SectionShape(kind: "text", title: "", placeholder: ""),
    ]
}

/// The four ways into the composer, all landing in one ``ComposerState``.
public enum ComposerStart: Hashable, Sendable {
    case template(String)
    case reuseLatest
    case draft(String)
    case edit(String)
}

public enum Composer {
    /// A fresh composer from a template; carried KPIs come with their names and units, empty values.
    public static func fromTemplate(
        _ template: UpdateTemplate, metrics: [MetricSeries], categoryId: String = "", now: Date = Date(),
        calendar: Calendar = .current
    ) -> ComposerState {
        ComposerState(
            title: template.id == "monthly" ? Format.monthTitle(now: now, calendar: calendar) : "",
            summary: "",
            categoryId: categoryId,
            sections: template.sections.map { .init(kind: $0.kind, title: $0.title, body: "") },
            metrics: template.carryMetrics ? metrics.map { .init(name: $0.name, value: "", unit: $0.unit) } : [],
            asks: template.suggestedAsk ? [.init(id: nil, kind: "intro", title: "", detail: "")] : [])
    }

    /// "Reuse the last one": headings and KPI names carry over, the words and numbers do not.
    public static func fromPrevious(_ post: PostView, now: Date = Date(), calendar: Calendar = .current)
        -> ComposerState
    {
        ComposerState(
            title: Format.monthTitle(now: now, calendar: calendar),
            summary: "",
            categoryId: post.card.categoryId,
            sections: post.sections.map { .init(kind: $0.kind, title: $0.title, body: "") },
            metrics: post.metrics.map { .init(name: $0.name, value: "", unit: $0.unit) },
            asks: [])
    }

    /// A published update, loaded for editing in place.
    public static func fromPost(_ post: PostView) -> ComposerState {
        ComposerState(
            title: post.card.title,
            summary: post.card.summary,
            categoryId: post.card.categoryId,
            sections: post.sections.map { .init(kind: $0.kind, title: $0.title, body: $0.body) },
            metrics: post.metrics.map { .init(name: $0.name, value: $0.value, unit: $0.unit) },
            asks: post.asks.map { .init(id: $0.id, kind: $0.kind, title: $0.title, detail: $0.detail) })
    }

    /// One "Thank you" section naming everyone whose offer was accepted since the last update.
    public static func thanksSection(_ contributions: [ContributionView]) -> ComposerState.SectionDraft? {
        guard !contributions.isEmpty else { return nil }
        let lines = contributions.map { c -> String in
            let who = People.label(c.name, c.account) + (c.firm.isEmpty ? "" : " (\(c.firm))")
            return "• \(who) — \(AskKind.of(c.askKind).label.lowercased()): \(c.askTitle)"
        }
        return .init(kind: "thanks", title: "Thank you", body: lines.joined(separator: "\n"))
    }
}

extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}
