import Foundation

/// The deal assistant: the web app's `utils/crm.ts` rules, one for one.
/// Deterministic and local: nothing leaves the phone.

public enum HealthLevel: String, Sendable {
    case healthy, atRisk, critical

    public var label: String {
        switch self {
        case .healthy: return "On track"
        case .atRisk: return "Needs attention"
        case .critical: return "At risk of slipping"
        }
    }
}

public struct DealHealth: Equatable, Sendable {
    /// 0...100
    public let score: Int
    public let level: HealthLevel
    /// Nothing has happened on the deal for longer than the pipeline allows.
    public let rotting: Bool
    /// Days since anything happened (done activity, note, stage move, creation).
    public let idleDays: Int
    public let reasons: [String]
    /// Stage probability, adjusted by health.
    public let winLikelihood: Int
}

public struct SuggestedActivity: Equatable, Sendable {
    public let kind: ActivityKind
    public let subject: String
    public let dueInDays: Int

    public init(kind: ActivityKind, subject: String, dueInDays: Int) {
        self.kind = kind
        self.subject = subject
        self.dueInDays = dueInDays
    }
}

public enum DealField: String, Sendable {
    case contact, expectedClose, owner
}

public struct NextAction: Identifiable, Equatable, Sendable {
    public let id: String
    public let title: String
    public let why: String
    /// When present, one tap schedules it.
    public let activity: SuggestedActivity?
    /// When present, the button opens the deal's editor instead.
    public let field: DealField?

    /// The button's words.
    public var buttonTitle: String {
        guard let activity else { return "Fix" }
        return activity.dueInDays == 0 ? "Schedule today" : "Schedule in \(activity.dueInDays)d"
    }
}

public struct EmailDraft: Equatable, Sendable {
    public let subject: String
    public let body: String
}

public enum Assistant {
    /// Most recent sign of life on a deal.
    public static func lastTouch(_ deal: DealView) -> UInt64 {
        max(deal.lastTouchAt ?? 0, deal.stageEnteredAt, deal.createdAt)
    }

    /// Score an open deal the way a sales manager reads the board. Closed deals are simply healthy.
    public static func health(_ deal: DealView, rottingDays: Int, now: Date, _ calendar: Calendar) -> DealHealth {
        guard deal.status == "open" else {
            return DealHealth(
                score: 100, level: .healthy, rotting: false, idleDays: 0, reasons: [],
                winLikelihood: Int(deal.probability))
        }
        var score = 100
        var reasons: [String] = []
        let today = calendar.startOfDay(for: now)
        let idle = max(0, Days.between(Days.date(lastTouch(deal)), now, calendar))
        let rotting = idle > rottingDays

        if let next = deal.nextActivity {
            if Days.date(next.dueAt) < today {
                let late = Days.between(Days.date(next.dueAt), now, calendar)
                score -= 25
                reasons.append("Next step overdue by \(late) day\(late == 1 ? "" : "s")")
            }
        } else {
            score -= 30
            reasons.append("No next step scheduled")
        }
        if rotting {
            score -= 30
            reasons.append("No activity in \(idle) days")
        } else if Double(idle) > Double(rottingDays) / 2 {
            score -= 10
            reasons.append("Quiet for \(idle) days")
        }
        let inStage = max(0, Days.between(Days.date(deal.stageEnteredAt), now, calendar))
        if inStage > rottingDays * 2 {
            score -= 10
            reasons.append("In this stage for \(inStage) days")
        }
        if let close = deal.expectedClose {
            if Days.date(close) < today {
                score -= 20
                reasons.append("Expected close date has passed")
            }
        } else {
            score -= 5
            reasons.append("No expected close date")
        }
        if deal.contactId == nil {
            score -= 10
            reasons.append("No contact person linked")
        }
        if (deal.owner ?? "").isEmpty {
            score -= 5
            reasons.append("Nobody owns this deal")
        }
        score = min(100, max(0, score))
        let level: HealthLevel = score >= 80 ? .healthy : score >= 45 ? .atRisk : .critical
        let win = Int((Double(deal.probability) * (0.5 + Double(score) / 200)).rounded())
        return DealHealth(
            score: score, level: level, rotting: rotting, idleDays: idle, reasons: reasons, winLikelihood: win)
    }

    /// The playbook step for where a deal sits in the pipeline (0 = first stage).
    public static func playbookStep(stageIndex: Int, stageCount: Int) -> SuggestedActivity {
        let phase = stageCount <= 1 ? 0 : Double(stageIndex) / Double(stageCount - 1)
        if phase < 0.2 {
            return SuggestedActivity(kind: .call, subject: "Discovery call: qualify need, budget and timeline", dueInDays: 1)
        }
        if phase < 0.45 { return SuggestedActivity(kind: .meeting, subject: "Book a demo with the decision maker", dueInDays: 3) }
        if phase < 0.7 { return SuggestedActivity(kind: .email, subject: "Send the proposal", dueInDays: 2) }
        if phase < 0.9 { return SuggestedActivity(kind: .call, subject: "Follow up on the proposal", dueInDays: 2) }
        return SuggestedActivity(kind: .meeting, subject: "Agree final terms and close", dueInDays: 2)
    }

    public static func nextActions(
        _ deal: DealView, stages: [StageView], rottingDays: Int, now: Date, _ calendar: Calendar
    ) -> [NextAction] {
        guard deal.status == "open" else { return [] }
        var out: [NextAction] = []
        let health = health(deal, rottingDays: rottingDays, now: now, calendar)
        let idx = max(0, stages.firstIndex { $0.id == deal.stageId } ?? 0)
        let today = calendar.startOfDay(for: now)

        if let next = deal.nextActivity, Days.date(next.dueAt) < today {
            out.append(
                NextAction(
                    id: "overdue", title: "Finish or reschedule “\(next.subject)”",
                    why: "An overdue step tells the buyer the deal is not a priority.", activity: nil, field: nil))
        }
        if health.rotting {
            out.append(
                NextAction(
                    id: "reengage", title: "Re-engage with a short check-in",
                    why:
                        "Nothing has happened in \(health.idleDays) days. Deals that go quiet rarely come back on their own.",
                    activity: SuggestedActivity(kind: .email, subject: "Check-in: keep the conversation moving", dueInDays: 0),
                    field: nil))
        }
        if deal.nextActivity == nil {
            let step = playbookStep(stageIndex: idx, stageCount: stages.count)
            let stageName = idx < stages.count ? stages[idx].name : "this stage"
            out.append(
                NextAction(
                    id: "playbook", title: step.subject,
                    why: "The usual next step at \(stageName). Every open deal should have one.", activity: step,
                    field: nil))
        }
        if deal.contactId == nil {
            out.append(
                NextAction(
                    id: "contact", title: "Link the person you are talking to",
                    why: "A deal without a contact is a deal nobody can follow up on.", activity: nil, field: .contact))
        }
        if deal.expectedClose.map({ Days.date($0) < today }) ?? true {
            out.append(
                NextAction(
                    id: "close-date",
                    title: deal.expectedClose == nil ? "Set an expected close date" : "Update the slipped close date",
                    why: "The forecast is only as honest as its close dates.", activity: nil, field: .expectedClose))
        }
        if (deal.owner ?? "").isEmpty {
            out.append(
                NextAction(
                    id: "owner", title: "Give the deal an owner", why: "Shared ownership is no ownership.",
                    activity: nil, field: .owner))
        }
        let late = stages.count > 1 && idx >= Int((Double(stages.count - 1) * 0.6).rounded(.down))
        if late, deal.nextActivity != nil, out.isEmpty {
            out.append(
                NextAction(
                    id: "decision-maker", title: "Confirm the decision maker and sign-off process",
                    why: "Late-stage deals slip on procurement, not on interest.",
                    activity: SuggestedActivity(kind: .call, subject: "Confirm decision process and sign-off", dueInDays: 3),
                    field: nil))
        }
        return out
    }

    private static func firstName(_ name: String?) -> String {
        let first = (name ?? "").trimmingCharacters(in: .whitespacesAndNewlines).split(separator: " ").first
        return first.map(String.init) ?? "there"
    }

    /// A short, stage-appropriate follow-up email the person can copy and edit.
    public static func followUpEmail(
        _ deal: DealView, stages: [StageView], contact: ContactView?, sender: String
    ) -> EmailDraft {
        let idx = max(0, stages.firstIndex { $0.id == deal.stageId } ?? 0)
        let phase = stages.count <= 1 ? 0 : Double(idx) / Double(stages.count - 1)
        let org =
            !deal.organization.isEmpty ? deal.organization : (contact?.organization).flatMap { $0.isEmpty ? nil : $0 } ?? "your team"
        let hi = "Hi \(firstName(contact?.name ?? deal.contactName)),"
        let sign = "\n\nBest,\n\(sender.isEmpty ? "Me" : sender)"
        let subject: String
        let middle: String
        if phase < 0.2 {
            subject = "Quick question about \(org)"
            middle =
                "I'd love to learn a little more about what \(org) is trying to solve, and whether we're a fit. Would you have 20 minutes this week for a quick call?"
        } else if phase < 0.45 {
            subject = "Next step: a short demo for \(org)"
            middle =
                "Thanks for the conversation so far. The natural next step is a 30-minute walkthrough with whoever else should weigh in. Could you suggest a couple of times that work?"
        } else if phase < 0.7 {
            subject = "Proposal for \(org)"
            middle =
                "As promised, here is the proposal we discussed for \"\(deal.title)\". I've kept it to what we agreed matters most. Happy to walk through it together."
        } else if phase < 0.9 {
            subject = "Following up on the proposal"
            middle =
                "I wanted to check whether you've had a chance to review the proposal, and whether there are any questions or changes I can help with before you decide."
        } else {
            subject = "Finalising \(deal.title)"
            middle =
                "We're nearly there. Is there anything left on your side, contract, sign-off or timing, that I can help unblock so we can get started?"
        }
        return EmailDraft(subject: subject, body: "\(hi)\n\n\(middle)\(sign)")
    }

    private static func longDate(_ ms: UInt64, _ calendar: Calendar) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = calendar.timeZone
        f.dateFormat = "EEE MMM dd yyyy"
        return f.string(from: Days.date(ms))
    }

    /// Everything an AI assistant needs to coach this deal, in one paste. No ids, no keys.
    public static func coachingPrompt(
        _ detail: DealDetail, stages: [StageView], currency: String, rottingDays: Int, now: Date, _ calendar: Calendar
    ) -> String {
        let deal = detail.deal
        let health = health(deal, rottingDays: rottingDays, now: now, calendar)
        let stage = stages.first { $0.id == deal.stageId }
        var lines: [String] = [
            "You are an experienced B2B sales coach. Help me move this deal forward.",
            "",
            "## Deal",
            "- Title: \(deal.title)",
            "- Value: \(Money.format(deal.value, currency: currency))",
            "- Organization: \(deal.organization.isEmpty ? "(unknown)" : deal.organization)",
            "- Stage: \(stage?.name ?? "(unknown)") (\(deal.probability)% stage probability) of \(stages.map(\.name).joined(separator: " → "))",
            "- Status: \(deal.status)\(deal.lostReason.isEmpty ? "" : " (lost: \(deal.lostReason))")",
            "- Expected close: \(deal.expectedClose.map { longDate($0, calendar) } ?? "(not set)")",
            "- Source: \(deal.source.isEmpty ? "(unknown)" : deal.source)",
            "- Health: \(health.score)/100 (\(healthWord(health.level)))\(health.reasons.isEmpty ? "" : " — " + health.reasons.joined(separator: "; "))",
        ]
        if let c = detail.contact {
            let title = c.jobTitle.isEmpty ? "" : ", \(c.jobTitle)"
            let org = c.organization.isEmpty ? "" : " at \(c.organization)"
            lines += ["", "## Contact", "- \(c.name)\(title)\(org)"]
        }
        if !detail.activities.isEmpty {
            lines += ["", "## Activities"]
            for a in detail.activities.suffix(15) {
                let note = a.note.isEmpty ? "" : " — \(a.note)"
                lines.append(
                    "- [\(a.done ? "done" : "open")] \(ActivityKind.label(a.kind)): \(a.subject) (due \(longDate(a.dueAt, calendar)))\(note)")
            }
        }
        if !detail.notes.isEmpty {
            lines += ["", "## Notes (newest first)"]
            for n in detail.notes.prefix(10) {
                let body = n.body.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
                lines.append("- \(longDate(n.createdAt, calendar)): \(body)")
            }
        }
        lines += [
            "",
            "## What I need",
            "1. The two or three biggest risks to closing this deal, and how to address each.",
            "2. The single best next step, with a date.",
            "3. A short, specific follow-up email I can send today.",
        ]
        return lines.joined(separator: "\n")
    }

    private static func healthWord(_ level: HealthLevel) -> String {
        switch level {
        case .healthy: return "healthy"
        case .atRisk: return "at-risk"
        case .critical: return "critical"
        }
    }
}
