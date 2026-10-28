#if DEBUG
import Foundation
import MeroKit
import StandupCore

/// Mero Standup's demo: three teams, the open one with six people, two weeks
/// of standups, a couple of live blockers with offers of help, and a decision
/// log reaching back two months. The contract answers `get_day`, `get_week`,
/// `current_blockers`, `list_decisions`, ... from them in the generated
/// client's wire shape, and writes change the fixtures, so the tour can post
/// an update and log a decision and see both.
enum StandupDemo {
    static let meName = "Sofia Marin"
    static let me = person(meName)
    static let applicationId = DemoIds.hex("app:mero-standup")

    static func makeBackend() -> DemoBackend {
        let store = Store(now: Date())
        let teams = ["Core Platform", "Design Systems", "Mobile Guild"]
        let sizes = [6, 9, 5]
        var namespaces: [AppNamespace] = []
        var subgroups: [String: [AppSubgroup]] = [:]
        for (name, size) in zip(teams, sizes) {
            let ns = namespace(name)
            namespaces.append(AppNamespace(id: ns, name: name, applicationId: applicationId, memberCount: size))
            // Teams live directly in their namespace: the context list is keyed by the namespace id.
            subgroups[ns] = [AppSubgroup(groupId: ns, name: name, contextIds: [context(name)])]
        }
        return DemoBackend(
            account: me, applicationId: applicationId, namespaces: namespaces, subgroups: subgroups,
            members: Set(teams.map(context)), handler: { try store.handle($0) })
    }

    static func namespace(_ team: String) -> String { DemoIds.hex("namespace:\(team)") }
    static func context(_ team: String) -> String { DemoIds.hex("context:\(team)") }
    static func person(_ name: String) -> String { DemoIds.hex("person:\(name)") }

    // MARK: State

    struct Entry {
        var done: String
        var next: String
        var blockers: String
        var createdAt: UInt64
        var editedAt: UInt64
        var cleared = false
    }

    struct Offer {
        var helper: String
        var note: String
        var at: UInt64
    }

    struct Logged {
        var id: String
        var author: String
        var title: String
        var decision: String
        var rationale: String
        var supersedes: String
        var createdAt: UInt64
        var tags: [String]
        var with: [String]
        var fromDay: String
    }

    struct Team {
        var name: String
        /// day -> author -> update
        var updates: [String: [String: Entry]] = [:]
        /// "day|author" -> offers, oldest first
        var helps: [String: [Offer]] = [:]
        var decisions: [Logged] = []
        var names: [String: String] = [:]
    }

    final class Store: @unchecked Sendable {
        private let lock = NSLock()
        private var teams: [String: Team] = [:]
        private var next = 0

        init(now: Date) {
            teams = Seed.teams(now: now)
        }

        func handle(_ call: DemoCall) throws -> Data {
            lock.lock()
            defer { lock.unlock() }
            var team = teams[call.contextId] ?? Team(name: "")
            defer { teams[call.contextId] = team }
            let me = StandupDemo.me
            let now = DemoIds.stamp(ago: 0)

            switch call.method {
            case "whoami":
                return try DemoReply.json(me)
            case "get_name":
                return try DemoReply.json(team.names[call.string("account") ?? ""] ?? "")
            case "team_name":
                return try DemoReply.json(team.name)
            case "set_name":
                team.names[me] = call.string("name") ?? ""
            case "set_team_name":
                team.name = call.string("name") ?? ""
            case "members":
                return try DemoReply.json(members(team))
            case "get_day":
                return try DemoReply.json(day(call.string("day") ?? "", team))
            case "get_week":
                let start = call.string("start") ?? ""
                return try DemoReply.json((0..<7).map { day(Days.shift(start, by: $0), team) })
            case "list_days":
                let before = call.string("before")
                let limit = call.int("limit") ?? 30
                let all = team.updates.keys.sorted(by: >).filter { before == nil || $0 < before! }
                    .map { d -> DaySummary in
                        let live = day(d, team).updates
                        return DaySummary(
                            day: d, updates: UInt32(live.count), blocked: UInt32(live.filter { !$0.blockers.isEmpty }.count))
                    }
                    .filter { $0.updates > 0 }
                let page = Array(all.prefix(limit))
                return try DemoReply.json(DayPage(days: page, nextCursor: all.count > limit ? page.last?.day : nil))
            case "current_blockers":
                return try DemoReply.json(blockers(team))
            case "post_update":
                let d = call.string("day") ?? Days.today()
                let old = team.updates[d]?[me]
                team.updates[d, default: [:]][me] = Entry(
                    done: call.string("done") ?? "", next: call.string("next") ?? "", blockers: call.string("blockers") ?? "",
                    createdAt: old.map { $0.cleared ? now : $0.createdAt } ?? now, editedAt: now)
            case "clear_update":
                team.updates[call.string("day") ?? ""]?[me]?.cleared = true
            case "offer_help":
                let key = "\(call.string("day") ?? "")|\(call.string("author") ?? "")"
                var offers = team.helps[key] ?? []
                offers.removeAll { $0.helper == me }
                offers.append(Offer(helper: me, note: call.string("note") ?? "", at: now))
                team.helps[key] = offers
            case "withdraw_help":
                team.helps["\(call.string("day") ?? "")|\(call.string("author") ?? "")"]?.removeAll { $0.helper == me }
            case "list_decisions":
                var items = team.decisions.sorted { $0.createdAt > $1.createdAt }
                if let search = call.string("search")?.lowercased(), !search.isEmpty {
                    items = items.filter {
                        ([$0.title, $0.decision, $0.rationale] + $0.tags).contains { $0.lowercased().contains(search) }
                    }
                }
                if let tag = call.string("tag") { items = items.filter { $0.tags.contains(tag) } }
                if let from = call.string("from_day") { items = items.filter { $0.fromDay == from } }
                if (call.args["standing_only"] as? Bool) == true {
                    items = items.filter { supersededBy($0, team).isEmpty }
                }
                let limit = call.int("limit") ?? 25
                let page = Array(items.prefix(limit))
                return try DemoReply.json(
                    DecisionPage(items: page.map { view($0, team) }, nextCursor: items.count > limit ? page.last?.id : nil))
            case "get_decision":
                guard let found = team.decisions.first(where: { $0.id == call.string("id") }) else {
                    throw DemoContractError("no such decision")
                }
                return try DemoReply.json(view(found, team))
            case "tags":
                var counts: [String: Int] = [:]
                for d in team.decisions { for t in d.tags { counts[t, default: 0] += 1 } }
                let out = counts.sorted { ($0.value, $1.key) > ($1.value, $0.key) }
                    .map { TagCount(tag: $0.key, count: UInt32($0.value)) }
                return try DemoReply.json(out)
            case "log_decision":
                next += 1
                let id = DemoIds.hex("decision:new:\(next)")
                team.decisions.append(
                    Logged(
                        id: id, author: me, title: call.string("title") ?? "", decision: call.string("decision") ?? "",
                        rationale: call.string("rationale") ?? "", supersedes: call.string("supersedes") ?? "", createdAt: now,
                        tags: call.strings("tags") ?? [], with: call.strings("with") ?? [], fromDay: call.string("from_day") ?? ""))
                return try DemoReply.json(id)
            default:
                break
            }
            return DemoReply.null
        }

        private func members(_ team: Team) -> [MemberView] {
            var accounts = Set(team.names.keys)
            for byAuthor in team.updates.values { accounts.formUnion(byAuthor.keys) }
            return accounts.map { account in
                let last = team.updates.filter { $0.value[account].map { !$0.cleared } ?? false }.keys.max() ?? ""
                return MemberView(account: account, name: team.names[account] ?? "", lastDay: last)
            }
            .sorted { $0.account < $1.account }
        }

        private func day(_ d: String, _ team: Team) -> DayView {
            let updates = (team.updates[d] ?? [:]).filter { !$0.value.cleared }.sorted { $0.key < $1.key }
                .map { update(d, $0.key, $0.value, team) }
            return DayView(day: d, updates: updates)
        }

        private func update(_ d: String, _ author: String, _ e: Entry, _ team: Team) -> UpdateView {
            let helpers =
                e.blockers.isEmpty
                ? []
                : (team.helps["\(d)|\(author)"] ?? []).map {
                    HelpView(account: $0.helper, name: team.names[$0.helper] ?? "", note: $0.note, at: $0.at)
                }
            return UpdateView(
                day: d, author: author, authorName: team.names[author] ?? "", done: e.done, next: e.next, blockers: e.blockers,
                createdAt: e.createdAt, editedAt: e.editedAt, helpers: helpers)
        }

        private func blockers(_ team: Team) -> [UpdateView] {
            var latest: [String: (String, Entry)] = [:]
            for (d, byAuthor) in team.updates {
                for (author, e) in byAuthor where !e.cleared {
                    if let have = latest[author], have.0 >= d { continue }
                    latest[author] = (d, e)
                }
            }
            return latest.filter { !$0.value.1.blockers.isEmpty }
                .sorted { ($0.value.0, $0.key) > ($1.value.0, $1.key) }
                .map { update($0.value.0, $0.key, $0.value.1, team) }
        }

        private func supersededBy(_ d: Logged, _ team: Team) -> String {
            team.decisions.first { $0.supersedes == d.id && $0.createdAt > d.createdAt }?.id ?? ""
        }

        private func view(_ d: Logged, _ team: Team) -> DecisionView {
            let replaced = team.decisions.first { $0.id == d.supersedes && $0.createdAt < d.createdAt }
            return DecisionView(
                id: d.id, author: d.author, authorName: team.names[d.author] ?? "", title: d.title, decision: d.decision,
                rationale: d.rationale, supersedes: replaced?.id ?? "", supersededBy: supersededBy(d, team),
                createdAt: d.createdAt, tags: d.tags,
                with: d.with.map { PersonView(account: $0, name: team.names[$0] ?? "") }, fromDay: d.fromDay)
        }
    }
}

// MARK: Fixtures

private enum Seed {
    static let daniel = "Daniel Okafor"
    static let priya = "Priya Raman"
    static let ines = "Ines Duarte"
    static let lukas = "Lukas Weber"
    static let tomas = "Tomás Ruiz"
    static let me = StandupDemo.meName
    static let people = [me, daniel, priya, ines, lukas, tomas]

    private static func p(_ name: String) -> String { StandupDemo.person(name) }

    static func teams(now: Date) -> [String: StandupDemo.Team] {
        var core = StandupDemo.Team(name: "Core Platform")
        for name in people { core.names[p(name)] = name }

        let today = Days.today(now)
        // The nine days before today, newest first. Every day, so "yesterday"
        // has a full board whichever weekday the demo runs on.
        let past = (1...9).map { Days.shift(today, by: -$0) }

        // Morning on `day`, never later than an hour before now.
        func stamp(_ day: String, minutes: Int) -> UInt64 {
            let noon = Days.parse(day) ?? now
            let at = min(noon.addingTimeInterval(TimeInterval(-3 * 3600 + minutes * 60)), now.addingTimeInterval(-3600))
            return UInt64(at.timeIntervalSince1970 * 1_000_000_000)
        }
        func ago(_ seconds: TimeInterval) -> UInt64 { DemoIds.stamp(ago: seconds, from: now) }

        // Today: four teammates in, Lukas and you not yet.
        core.updates[today] = [
            p(daniel): .init(
                done: "Cursor pagination for `list_decisions` is up for review (#412)\n- same cursor shape as `list_days`\n- old clients keep working, they just get one page",
                next: "Load test it against the 50k-decision fixture before we merge",
                blockers: "", createdAt: ago(2 * 3600 + 40 * 60), editedAt: ago(2 * 3600 + 40 * 60)),
            p(priya): .init(
                done: "Moved the preview environments to the new node pool, ~30% cheaper at the same p95",
                next: "Renew the staging certificate and put cert-manager in charge of it",
                blockers: "Staging TLS cert expired overnight. Renewing it needs the DNS account, and only Lukas has admin on it.",
                createdAt: ago(1 * 3600 + 55 * 60), editedAt: ago(1 * 3600 + 20 * 60)),
            p(ines): .init(
                done: "Shipped the offline banner on iOS and Android\n- reconnects within 2s after a Wi-Fi handover\n- no more spinner stuck on the board",
                next: "Fix the keyboard jump in the update sheet on iPad",
                blockers: "", createdAt: ago(58 * 60), editedAt: ago(58 * 60)),
            p(tomas): .init(
                done: "Wrote up the onboarding interviews (6 teams). Top ask: a weekly digest they can paste into Slack",
                next: "Draft the decision-log empty state copy with Ines",
                blockers: "", createdAt: ago(34 * 60), editedAt: ago(34 * 60)),
        ]
        core.helps["\(today)|\(p(priya))"] = [
            .init(helper: p(daniel), note: "I have read access to DNS, can pair at 2pm", at: ago(50 * 60))
        ]

        // Past days, newest first: (done, next, blockers) per person.
        let history: [String: [(String, String, String)]] = [
            me: [
                ("Landed the retry budget for relay uploads\n- capped at 3 attempts with jitter\n- metrics for dropped batches",
                 "Wire the retry metrics into the Grafana board and review Daniel's pagination PR", ""),
                ("Reproduced the duplicate-post bug: two nodes replaying the same delta after a reconnect",
                 "Retry budget for relay uploads so a flaky network can't double-send", ""),
                ("Reviewed Ines's offline banner PR, left notes on the reconnect timing",
                 "Chase the duplicate-post report from the Mobile Guild", ""),
                ("Snapshot sync is 40% faster on cold start after batching the blob fetches",
                 "Write up the numbers for Friday's digest", ""),
                ("Profiled cold-start sync on a 2k-update team", "Batch the blob fetches", ""),
                ("On-call handover, quiet week: two pages, both the staging disk alert",
                 "Raise the staging disk alert threshold", ""),
                ("Paired with Daniel on the cursor format", "Profile cold-start sync", ""),
            ],
            daniel: [
                ("Cursor format agreed with Sofia: opaque, base64 of the last id",
                 "Cursor pagination for `list_decisions`", ""),
                ("Fixed the decision search being case-sensitive on tags", "Agree the cursor format with Sofia", ""),
                ("API docs for the v2 contract methods are live", "Fix tag search", ""),
                ("Removed the last v1-only code path from the client", "API docs for v2", ""),
                ("Reviewed Priya's node pool change", "Remove the v1 code path", ""),
                ("Tagged 0.3.2 and wrote the release notes", "Review Priya's node pool PR", ""),
            ],
            priya: [
                ("Preview environments now spin down after 2h idle", "Move previews to the new node pool", ""),
                ("Terraform for the new node pool reviewed and planned", "Idle shutdown for previews", ""),
                ("Postgres minor upgrade on staging, zero downtime", "Terraform the new node pool",
                 ""),
                ("Cost report for October: previews are 22% of the bill", "Postgres upgrade on staging", ""),
                ("Rotated the CI deploy keys", "October cost report", ""),
                ("Cleaned up 41 orphaned volumes", "Rotate CI deploy keys", ""),
            ],
            ines: [
                ("Offline banner behind a flag on both platforms", "Ship it to everyone", ""),
                ("Week strip dots now show who was blocked", "Offline banner",
                 "TestFlight build stuck in processing for 3h. Retried, waiting on Apple."),
                ("Android: carry-forward of yesterday's Next into today's Done", "Week strip blocker dots", ""),
                ("iOS: carry-forward, same behaviour as the web", "Port it to Android", ""),
                ("Fixed the avatar colour changing after a rename", "Carry-forward on iOS", ""),
                ("Dark mode pass on the decision sheet", "Avatar colour bug", ""),
            ],
            lukas: [
                ("Pen test findings triaged: 0 high, 2 medium, both fixed",
                 "Turn on the EU region once the paperwork is done",
                 "Waiting on legal to sign the data processing addendum before the EU region can go live."),
                ("Fixed the two medium pen test findings (cookie flags, verbose 500s)", "Triage the rest of the report", ""),
                ("Pen test kickoff with the external team", "Fix whatever they find first", ""),
                ("SSO for the admin dashboard is live", "Pen test kickoff", ""),
                ("Audit log export to the SIEM", "SSO for the admin dashboard", ""),
            ],
            tomas: [
                ("Six onboarding interviews done", "Write them up", ""),
                ("Decision-log timeline mockups reviewed with the team", "Onboarding interviews", ""),
                ("Weekly digest: moved to Friday 4pm, everyone's in", "Decision-log timeline mockups", ""),
                ("Synthesised the standup survey: 82% prefer async", "Propose moving the digest to Friday", ""),
                ("Survey closed with 37 answers", "Synthesise it", ""),
            ],
        ]
        // Which past days each person skipped (by index into `past`).
        let skips: [String: Set<Int>] = [daniel: [2], priya: [4], ines: [5], lukas: [1, 3, 6, 7], tomas: [1, 4, 6, 8]]
        for (name, entries) in history {
            var i = 0
            for (index, day) in past.enumerated() where i < entries.count {
                if skips[name]?.contains(index) == true { continue }
                let (done, next, blockers) = entries[i]
                let at = stamp(day, minutes: (people.firstIndex(of: name) ?? 0) * 9 + i * 3)
                core.updates[day, default: [:]][p(name)] = .init(
                    done: done, next: next, blockers: blockers, createdAt: at, editedAt: at)
                i += 1
            }
        }
        core.helps["\(past[0])|\(p(lukas))"] = [
            .init(helper: p(me), note: "I can nudge legal, I'm on their thread already", at: stamp(past[0], minutes: 140))
        ]

        // The decision log, newest first.
        let day: TimeInterval = 86400
        func d(_ seed: String, _ author: String, _ secondsAgo: TimeInterval, _ title: String, _ decision: String,
               _ rationale: String, _ tags: [String], _ with: [String], fromDay: String = "", supersedes: String = "")
            -> StandupDemo.Logged
        {
            StandupDemo.Logged(
                id: DemoIds.hex("decision:\(seed)"), author: p(author), title: title, decision: decision, rationale: rationale,
                supersedes: supersedes.isEmpty ? "" : DemoIds.hex("decision:\(supersedes)"), createdAt: ago(secondsAgo),
                tags: tags, with: with.map(p), fromDay: fromDay)
        }
        core.decisions = [
            d("api-freeze", daniel, 2 * 3600, "Freeze the v2 contract API until 0.4 ships",
              "No new methods or argument changes to the standup contract until 0.4 is out. Bug fixes only.",
              "Ines and Daniel are both mid-migration on the mobile clients; a moving API doubles their work.",
              ["api", "release"], [ines, me], fromDay: today),
            d("cert-manager", priya, 1 * day + 3 * 3600, "Staging certificates are issued by cert-manager",
              "Staging and preview certificates come from cert-manager with a 30-day renewal window. No more manual renewals.",
              "Manual renewals lapsed twice this quarter. cert-manager already runs in production, so it costs nothing new.",
              ["infra", "security"], [lukas], fromDay: past[0]),
            d("cursors", me, 4 * day, "Cursor pagination for every list method",
              "Every list method takes an opaque `cursor` and returns `next_cursor`. Offsets are gone.",
              "Offsets skip or repeat items when teammates' updates sync in mid-scroll. Cursors don't.",
              ["api"], [daniel]),
            d("same-day", ines, 9 * day, "iOS and Android ship on the same day",
              "Both apps release together from the same tag. A platform that isn't ready holds the other.",
              "Teams use both. Half a team on a new contract version and half on the old one is the worst case.",
              ["mobile", "release"], [tomas]),
            d("digest-friday", tomas, 16 * day, "The weekly digest goes out Friday at 4pm",
              "The Week tab digest is shared in #platform every Friday at 4pm, by whoever is on call.",
              "Monday's digest was read by nobody: people were catching up on the weekend. Friday afternoon gets replies.",
              ["process"], [me, daniel, priya], supersedes: "digest-monday"),
            d("oncall", lukas, 23 * day, "On-call rotates weekly, Monday 10:00",
              "One person per week, handover at Monday standup. Pages go to the secondary after 15 minutes.",
              "Daily rotation meant nobody owned a problem for longer than a shift.", ["oncall", "process"], [priya]),
            d("release-cadence", daniel, 34 * day, "Release every two weeks, on Tuesdays",
              "Cut a release every other Tuesday morning. Hotfixes go out any day.",
              "Monday releases collided with on-call handover; Friday ones broke weekends.",
              ["release", "process"], [ines, me]),
            d("digest-monday", tomas, 41 * day, "The weekly digest goes out Monday morning",
              "Share the week's digest every Monday at 9am.", "A fresh start to the week.", ["process"], []),
            d("postgres", priya, 55 * day, "Postgres stays; no move to a managed key-value store",
              "We keep Postgres for the relay index. Revisit at 10x current load.",
              "The migration is a quarter of work for a problem we don't have yet.", ["infra"], [daniel, lukas]),
            d("async", me, 68 * day, "Standups are async; the daily call is cancelled",
              "Everyone posts in Mero Standup by 11:00 their time. Blockers get a thread, not a meeting.",
              "Three time zones. The call cost 6 people 15 minutes a day and half of them were muted.",
              ["process"], [tomas, daniel, priya, ines, lukas]),
        ]

        var design = StandupDemo.Team(name: "Design Systems")
        var mobile = StandupDemo.Team(name: "Mobile Guild")
        design.names[p(me)] = me
        mobile.names[p(me)] = me
        return [
            StandupDemo.context("Core Platform"): core,
            StandupDemo.context("Design Systems"): design,
            StandupDemo.context("Mobile Guild"): mobile,
        ]
    }
}
#endif
