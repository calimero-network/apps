#if DEBUG
import Foundation
import IssueTrackerCore
import MeroKit

/// Mero Issue Tracker's demo: three team workspaces, their repositories, and
/// a few weeks of issues and comments, answered in the generated client's wire
/// shape (`list_issues`, `get_issue`, `get_repo_info`, ...). Writes change the
/// fixtures, so the tour can move, file and comment on issues.
enum IssuesDemo {
    static let meName = "Lena Ortiz"
    static let me = person(meName)
    static let applicationId = DemoIds.hex("app:mero-issue-tracker")

    static let platform = DemoIds.hex("workspace:Northwind Platform")
    static let fieldOps = DemoIds.hex("workspace:Field Ops")
    static let guild = DemoIds.hex("workspace:Open Source Guild")

    /// Repo name → GitHub URL, per workspace. The first repo of Northwind Platform opens first.
    static let repos: [(workspace: String, name: String, url: String)] = [
        (platform, "sync-engine", "https://github.com/northwind-labs/sync-engine"),
        (platform, "mobile-app", "https://github.com/northwind-labs/mobile-app"),
        (platform, "web-dashboard", "https://github.com/northwind-labs/web-dashboard"),
        (fieldOps, "route-planner", "https://github.com/northwind-labs/route-planner"),
        (guild, "crdt-playground", "https://github.com/northwind-oss/crdt-playground"),
    ]

    static func makeBackend() -> DemoBackend {
        // What WorkspaceModel reads from this device: names, the open workspace and repo.
        let store = DefaultsTrackerStore()
        for repo in repos { store.setRepoName(repo.name, for: context(repo.name)) }
        store.activeWorkspace = platform
        store.setActiveRepo(context("sync-engine"), in: platform)

        let state = Store(now: Date())
        func group(_ ns: String) -> AppSubgroup {
            AppSubgroup(groupId: ns, name: nil, contextIds: repos.filter { $0.workspace == ns }.map { context($0.name) })
        }
        return DemoBackend(
            account: me, applicationId: applicationId,
            namespaces: [
                AppNamespace(id: platform, name: "Northwind Platform", applicationId: applicationId, memberCount: 9),
                AppNamespace(id: fieldOps, name: "Field Ops", applicationId: applicationId, memberCount: 5),
                AppNamespace(id: guild, name: "Open Source Guild", applicationId: applicationId, memberCount: 23),
            ],
            subgroups: [platform: [group(platform)], fieldOps: [group(fieldOps)], guild: [group(guild)]],
            members: Set(repos.map { context($0.name) }),
            handler: { try state.handle($0) })
    }

    static func context(_ repo: String) -> String { DemoIds.hex("repo:\(repo)") }
    static func person(_ name: String) -> String { DemoIds.hex("person:\(name)") }

    /// Contract time here is Unix milliseconds.
    static func ms(ago seconds: TimeInterval, from now: Date) -> UInt64 {
        UInt64((now.timeIntervalSince1970 - seconds) * 1000)
    }

    // MARK: State

    struct Repo {
        var url: String
        var issues: [IssueView] = []
        var comments: [CommentView] = []
    }

    final class Store: @unchecked Sendable {
        private let lock = NSLock()
        private var repos: [String: Repo] = [:]
        private var next = 0

        init(now: Date) {
            for repo in IssuesDemo.repos {
                repos[IssuesDemo.context(repo.name)] = Seed.repo(repo.name, url: repo.url, now: now)
            }
        }

        func handle(_ call: DemoCall) throws -> Data {
            lock.lock()
            defer { lock.unlock() }
            var repo = repos[call.contextId] ?? Repo(url: "")
            defer { repos[call.contextId] = repo }
            let now = Date()

            func index(_ id: String?) throws -> Int {
                guard let id, let i = repo.issues.firstIndex(where: { $0.id == id }) else {
                    throw DemoContractError("Issue not found")
                }
                return i
            }
            func comment(_ id: String?) throws -> Int {
                guard let id, let i = repo.comments.firstIndex(where: { $0.id == id }) else {
                    throw DemoContractError("Comment not found")
                }
                guard repo.comments[i].author == IssuesDemo.me else {
                    throw DemoContractError("Only the comment's author can change it")
                }
                return i
            }

            switch call.method {
            case "list_issues":
                var list = repo.issues
                if let s = call.string("status") { list = list.filter { $0.status == s } }
                if let a = call.string("assignee") { list = list.filter { $0.assignee == a } }
                if let l = call.string("label") { list = list.filter { $0.labels.contains(l) } }
                return try DemoReply.json(list)
            case "get_issue":
                let issue = repo.issues[try index(call.string("issue_id"))]
                let thread = repo.comments.filter { $0.issueId == issue.id }.sorted { $0.createdAt < $1.createdAt }
                return try DemoReply.json(IssueDetail(issue: issue, comments: thread))
            case "get_repo_info":
                return try DemoReply.json(RepoInfo(repoUrl: repo.url))
            case "get_status_counts":
                return try DemoReply.json(Tracker.statuses.map { s in
                    StatusCount(status: s, count: UInt64(repo.issues.filter { $0.status == s }.count))
                })
            case "set_repo_url":
                repo.url = call.string("url") ?? ""
            case "create_issue":
                let id = mint("issue", now)
                repo.issues.append(
                    IssueView(
                        id: id, title: call.string("title") ?? "", summary: call.string("summary") ?? "",
                        impact: call.string("impact") ?? "", repro: call.string("repro") ?? "",
                        resolutionCriteria: call.string("resolution_criteria") ?? "", status: "Open",
                        priority: call.string("priority") ?? Tracker.defaultPriority, assignee: nil,
                        labels: Array(Set(call.strings("labels") ?? [])).sorted(), createdBy: IssuesDemo.me,
                        createdAt: IssuesDemo.ms(ago: 0, from: now)))
                return try DemoReply.json(id)
            case "delete_issue":
                let i = try index(call.string("issue_id"))
                let id = repo.issues[i].id
                repo.issues.remove(at: i)
                repo.comments.removeAll { $0.issueId == id }
            case "set_status":
                repo.issues[try index(call.string("issue_id"))].status = call.string("status") ?? "Open"
            case "set_priority":
                repo.issues[try index(call.string("issue_id"))].priority = call.string("priority") ?? "medium"
            case "set_assignee":
                let who = call.string("assignee")
                repo.issues[try index(call.string("issue_id"))].assignee = (who?.isEmpty ?? true) ? nil : who
            case "add_label":
                let i = try index(call.string("issue_id"))
                if let l = call.string("label"), !repo.issues[i].labels.contains(l) {
                    repo.issues[i].labels = (repo.issues[i].labels + [l]).sorted()
                }
            case "remove_label":
                let i = try index(call.string("issue_id"))
                repo.issues[i].labels.removeAll { $0 == call.string("label") }
            case "set_summary":
                repo.issues[try index(call.string("issue_id"))].summary = call.string("summary") ?? ""
            case "set_impact":
                repo.issues[try index(call.string("issue_id"))].impact = call.string("impact") ?? ""
            case "set_repro":
                repo.issues[try index(call.string("issue_id"))].repro = call.string("repro") ?? ""
            case "set_resolution_criteria":
                repo.issues[try index(call.string("issue_id"))].resolutionCriteria = call.string("resolution_criteria") ?? ""
            case "add_comment":
                let issue = repo.issues[try index(call.string("issue_id"))]
                let id = mint("comment", now)
                repo.comments.append(
                    CommentView(
                        id: id, issueId: issue.id, author: IssuesDemo.me, body: call.string("body") ?? "",
                        createdAt: IssuesDemo.ms(ago: 0, from: now)))
                return try DemoReply.json(id)
            case "edit_comment":
                let i = try comment(call.string("comment_id"))
                repo.comments[i].body = call.string("new_body") ?? repo.comments[i].body
                repo.comments[i].editedAt = IssuesDemo.ms(ago: 0, from: now)
            case "delete_comment":
                repo.comments.remove(at: try comment(call.string("comment_id")))
            default:
                break
            }
            return DemoReply.null
        }

        /// `issue-<ms>-<8 hex>`, the contract's id shape.
        private func mint(_ kind: String, _ now: Date) -> String {
            next += 1
            let ms = IssuesDemo.ms(ago: 0, from: now)
            return "\(kind)-\(ms)-\(DemoIds.hex("\(kind):new:\(next)").prefix(8))"
        }
    }

    // MARK: Seed

    enum Seed {
        static let ana = "Ana Petrović"
        static let marcus = "Marcus Webb"
        static let priya = "Priya Raman"
        static let tomas = "Tomás Silva"
        static let jonas = "Jonas Keller"
        static let yuki = "Yuki Tanaka"

        static let m: TimeInterval = 60
        static let h: TimeInterval = 3600
        static let d: TimeInterval = 86400

        struct Item {
            let ago: TimeInterval
            let title: String
            let status: String
            let priority: String
            let assignee: String?
            let labels: [String]
            let by: String
            let summary: String
            let impact: String
            let repro: String
            let resolution: String
            var comments: [(ago: TimeInterval, by: String, body: String)] = []
        }

        static func repo(_ name: String, url: String, now: Date) -> Repo {
            var repo = Repo(url: url)
            for item in items(name) {
                let id = "issue-\(IssuesDemo.ms(ago: item.ago, from: now))-\(DemoIds.hex("issue:\(name):\(item.title)").prefix(8))"
                repo.issues.append(
                    IssueView(
                        id: id, title: item.title, summary: item.summary, impact: item.impact, repro: item.repro,
                        resolutionCriteria: item.resolution, status: item.status, priority: item.priority,
                        assignee: item.assignee, labels: item.labels.sorted(), createdBy: IssuesDemo.person(item.by),
                        createdAt: IssuesDemo.ms(ago: item.ago, from: now)))
                for (n, c) in item.comments.enumerated() {
                    let at = IssuesDemo.ms(ago: c.ago, from: now)
                    repo.comments.append(
                        CommentView(
                            id: "comment-\(at)-\(DemoIds.hex("comment:\(id):\(n)").prefix(8))", issueId: id,
                            author: IssuesDemo.person(c.by), body: c.body, createdAt: at))
                }
            }
            return repo
        }

        static func items(_ repo: String) -> [Item] {
            switch repo {
            case "sync-engine": return syncEngine
            case "mobile-app": return mobileApp
            case "web-dashboard": return webDashboard
            case "route-planner": return routePlanner
            default: return playground
            }
        }

        static let me = IssuesDemo.meName

        static let syncEngine: [Item] = [
            Item(
                ago: 25 * m, title: "Offline edits lost when the app is killed mid-sync", status: "Open", priority: "urgent",
                assignee: marcus, labels: ["sync", "data-loss"], by: priya,
                summary: "If the app is force-quit while a sync round is uploading, the edits made offline before that round never reach the other devices. The local outbox is cleared before the relay acknowledges the batch.",
                impact: "Silent data loss. Two field teams reported missing inspection notes this week, and support cannot recover them because the outbox is already empty.",
                repro: "1. Turn on airplane mode\n2. Edit three notes\n3. Turn airplane mode off\n4. Force-quit within 2 s\n5. Reopen: notes show, but the second device never gets them",
                resolution: "The outbox is only trimmed after the relay ack. A kill at any point of a round loses nothing, proven by the kill-during-sync e2e test passing 50 runs in a row.",
                comments: [
                    (21 * m, marcus, "Reproduced on the first try on an iPhone 15. The outbox file is truncated in `flush()` before `await relay.send` returns."),
                    (18 * m, me, "That matches the logs from the Lisbon team. Can we keep the batch id in the outbox and only drop entries once the ack carries it?"),
                    (14 * m, marcus, "Yes, that's the plan. I'll also add a startup pass that replays anything still pending."),
                    (9 * m, priya, "Adding the e2e: kill the app at a random point of the round, 50 iterations, then diff both devices."),
                    (4 * m, jonas, "Heads up: the Android outbox shares that code path, so the fix covers both once it lands."),
                ]),
            Item(
                ago: 3 * h, title: "Conflict banner names the wrong author on merged edits", status: "Open", priority: "medium",
                assignee: nil, labels: ["ui", "crdt"], by: me,
                summary: "When two people edit the same paragraph, the \"edited by\" banner shows whoever synced last, not who wrote the surviving text.",
                impact: "People ping the wrong teammate about changes. Confusing, but no data is affected.",
                repro: "1. Ana and Tomás edit the same paragraph offline\n2. Both reconnect\n3. Banner credits Tomás for Ana's text",
                resolution: "The banner names the author of the winning operation, covered by a unit test on the merge result."),
            Item(
                ago: 26 * h, title: "Reconnect backoff never resets after a good connection", status: "Open", priority: "medium",
                assignee: tomas, labels: ["network"], by: tomas,
                summary: "After one flaky stretch, the client keeps waiting the maximum 60 s between reconnects for the rest of the session.",
                impact: "Devices look stale for up to a minute after every short drop, all day.",
                repro: "1. Drop the connection 6 times\n2. Stay online for 10 min\n3. Drop once: reconnect waits 60 s",
                resolution: "Backoff resets to 1 s after 30 s of healthy connection."),
            Item(
                ago: 2 * d, title: "Large attachments stall the upload queue", status: "Open", priority: "high",
                assignee: jonas, labels: ["attachments", "performance"], by: ana,
                summary: "A 200 MB video blocks every small edit queued behind it until the upload finishes.",
                impact: "Text edits arrive minutes late whenever someone attaches a video.",
                repro: "1. Attach a 200 MB video\n2. Edit a note\n3. The edit waits for the video",
                resolution: "Blobs upload on their own lane; text edits sync within 2 s while a large upload runs."),
            Item(
                ago: 5 * d, title: "Add metrics for delta size per sync round", status: "Open", priority: "low",
                assignee: nil, labels: ["observability"], by: jonas,
                summary: "We have no data on how large each round's delta is, so we cannot tell whether compaction pays off.",
                impact: "Guesswork when tuning compaction and batch sizes.",
                repro: "n/a: missing instrumentation",
                resolution: "A histogram of delta bytes per round in the dashboard, broken down by platform."),
            Item(
                ago: 6 * h, title: "Migrate snapshot storage to SQLite WAL mode", status: "In progress", priority: "high",
                assignee: me, labels: ["storage"], by: me,
                summary: "Snapshots are written with rollback journaling, so readers block during every compaction.",
                impact: "UI hitches of 300-800 ms on older phones each time a snapshot is written.",
                repro: "1. Open a workspace with 20k ops\n2. Trigger compaction\n3. Scroll: frames drop",
                resolution: "WAL enabled with a checkpoint policy; no frame over 32 ms during compaction on an iPhone XR.",
                comments: [(4 * h, marcus, "Remember the checkpoint on background: iOS kills us if the WAL grows too big.")]),
            Item(
                ago: 2 * d + 4 * h, title: "Flaky e2e: two-device merge test times out on CI", status: "In progress", priority: "urgent",
                assignee: ana, labels: ["ci", "flaky"], by: ana,
                summary: "`merge_two_devices` times out about one run in eight on CI, never locally.",
                impact: "Blocks merges to main several times a day.",
                repro: "Re-run the e2e job on main 10 times; expect 1-2 failures at the 90 s timeout.",
                resolution: "Ten consecutive green runs on CI, with the root cause written up in the PR."),
            Item(
                ago: 4 * d, title: "Hash mismatch after renaming a shared folder", status: "In progress", priority: "high",
                assignee: marcus, labels: ["crdt"], by: yuki,
                summary: "Renaming a folder while a teammate adds a file inside it leaves the two devices with different root hashes.",
                impact: "Devices stop converging and keep resyncing in a loop.",
                repro: "1. Device A renames /Reports\n2. Device B adds /Reports/q3.pdf offline\n3. Both reconnect: hashes differ",
                resolution: "Both devices reach the same root hash; property test with random renames passes 10k cases."),
            Item(
                ago: 3 * d, title: "iOS background sync stops after 30 seconds", status: "Blocked", priority: "high",
                assignee: yuki, labels: ["background", "ios"], by: yuki,
                summary: "Background refresh is cut off after 30 s, before larger rounds can finish.",
                impact: "Phones that stay locked overnight wake up hours behind.",
                repro: "1. Lock the phone with 500 pending ops\n2. Wait for a background refresh\n3. Only ~120 ops sent",
                resolution: "Rounds resume across background windows. Blocked on the background processing entitlement review."),
            Item(
                ago: 9 * d, title: "Upgrade to relay protocol v3", status: "Blocked", priority: "medium",
                assignee: tomas, labels: ["network", "protocol"], by: tomas,
                summary: "v3 adds resumable streams and compressed frames.",
                impact: "Roughly 40% less bandwidth on mobile data.",
                repro: "n/a: upgrade task",
                resolution: "Client speaks v3 with v2 fallback. Blocked until the relay team ships v3 to staging."),
            Item(
                ago: 30 * h, title: "Clock skew makes new comments sort above older ones", status: "Done", priority: "medium",
                assignee: priya, labels: ["crdt"], by: ana,
                summary: "A device with its clock 5 minutes ahead sorted its comments above newer replies.",
                impact: "Threads read out of order.",
                repro: "Set a device clock +5 min and reply in a thread.",
                resolution: "Ordering uses hybrid logical clocks; skew test passes."),
            Item(
                ago: 6 * d, title: "Memory spike when replaying a 50k-op log", status: "Done", priority: "high",
                assignee: jonas, labels: ["performance"], by: jonas,
                summary: "Cold start on a big workspace peaked at 900 MB while replaying the op log.",
                impact: "Jetsam kills on 3 GB devices.",
                repro: "Open the 50k-op fixture workspace on an iPhone 11.",
                resolution: "Replay streams in chunks; peak under 180 MB."),
            Item(
                ago: 10 * d, title: "Sync status pill stuck on \"Connecting\"", status: "Done", priority: "low",
                assignee: ana, labels: ["ui"], by: priya,
                summary: "The pill kept saying Connecting after the first successful round.",
                impact: "People thought sync was broken.",
                repro: "Launch offline, then go online.",
                resolution: "Pill reflects the session state; snapshot test added."),
            Item(
                ago: 16 * d, title: "Crash on launch with an empty keychain", status: "Done", priority: "urgent",
                assignee: yuki, labels: ["crash", "ios"], by: marcus,
                summary: "Fresh installs crashed when the keychain had no stored identity.",
                impact: "Every new user on 2.3.0.",
                repro: "Delete the app, reinstall, launch.",
                resolution: "Shipped in 2.3.1; crash-free sessions back to 99.9%."),
        ]

        static let mobileApp: [Item] = [
            Item(
                ago: 2 * h, title: "Dark mode: chart labels unreadable on the summary screen", status: "Open", priority: "medium",
                assignee: yuki, labels: ["ui"], by: ana,
                summary: "Axis labels stay dark grey in dark mode.", impact: "The weekly summary is hard to read at night.",
                repro: "Enable dark mode, open Summary.", resolution: "Labels use the semantic text color; snapshot tests in both modes."),
            Item(
                ago: 1 * d, title: "Push notification opens the wrong workspace", status: "In progress", priority: "high",
                assignee: tomas, labels: ["notifications"], by: priya,
                summary: "Tapping a mention notification opens the last used workspace instead of the one mentioned.",
                impact: "People miss the comment they were pinged about.",
                repro: "Be in workspace A, get mentioned in B, tap the notification.",
                resolution: "The notification payload carries the workspace id and the app switches to it."),
            Item(
                ago: 8 * d, title: "Haptics fire twice when moving a card", status: "Done", priority: "low",
                assignee: ana, labels: ["ui"], by: me,
                summary: "Moving a card plays two success haptics.", impact: "Feels glitchy.",
                repro: "Move any card on the board.", resolution: "One haptic per move."),
        ]

        static let webDashboard: [Item] = [
            Item(
                ago: 5 * h, title: "CSV export drops non-ASCII names", status: "Open", priority: "medium",
                assignee: jonas, labels: ["export"], by: tomas,
                summary: "Names like \"Tomás\" come out as question marks.", impact: "Payroll imports fail.",
                repro: "Export the team list with any accented name.", resolution: "UTF-8 with BOM; round-trips in Excel and Numbers."),
            Item(
                ago: 3 * d, title: "Session expires while a report is still loading", status: "Blocked", priority: "high",
                assignee: marcus, labels: ["auth"], by: marcus,
                summary: "Long reports outlive the 15 min token.", impact: "Finance reruns month-end reports.",
                repro: "Open the yearly report on a slow network.", resolution: "Silent token refresh. Blocked on the auth service change."),
        ]

        static let routePlanner: [Item] = [
            Item(
                ago: 4 * h, title: "Route ETA ignores loading-dock wait times", status: "Open", priority: "high",
                assignee: priya, labels: ["routing"], by: tomas,
                summary: "ETAs assume zero wait at docks.", impact: "Drivers arrive 20 min later than promised.",
                repro: "Plan the Tuesday north loop.", resolution: "Dock wait averages included; ETA error under 5 min."),
        ]

        static let playground: [Item] = [
            Item(
                ago: 7 * h, title: "Document the RGA tombstone compaction", status: "In progress", priority: "low",
                assignee: me, labels: ["docs"], by: me,
                summary: "Contributors keep asking how tombstones are collected.", impact: "Slower reviews.",
                repro: "n/a: docs", resolution: "A page with diagrams in the docs site."),
        ]
    }
}
#endif
