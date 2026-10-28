#if DEBUG
import DocsCore
import Foundation
import MeroKit
import UIKit

/// The demo account: three workspaces, a product team's folders and
/// documents, one long launch plan with comments on its blocks, and the
/// picture its image block shows. Answers the docs contract in the shapes the
/// generated client decodes (`DocDto`, `Block`, `CommentDto`, `DocSearchPage`).
enum DocsDemo {
    static let applicationId = DemoIds.hex("app:mero-docs")
    static let me = DemoIds.hex("person:me")

    static func person(_ name: String) -> String { DemoIds.hex("person:\(name)") }
    static func workspaceId(_ name: String) -> String { DemoIds.hex("workspace:\(name)") }
    static func folderId(_ name: String) -> String { DemoIds.hex("folder:\(name)") }
    static func contextId(_ name: String) -> String { DemoIds.hex("context:\(name)") }
    static func docId(_ title: String) -> String { DemoIds.hex("doc:\(title)") }

    static let main = "Atlas Product Team"
    static let syncImage = DemoIds.hex("blob:sync-path")

    static func makeBackend() -> any MeroAppBackend {
        let store = Store()
        var subgroups: [String: [AppSubgroup]] = [:]
        var members: Set<String> = []
        for space in Fixtures.spaces {
            for folder in space.folders {
                let parent = folder.parent.map(folderId) ?? workspaceId(space.name)
                subgroups[parent, default: []].append(
                    AppSubgroup(groupId: folderId(folder.name), name: folder.name, contextIds: [contextId(folder.name)]))
                members.insert(contextId(folder.name))
            }
        }
        let namespaces = Fixtures.spaces.map {
            AppNamespace(id: workspaceId($0.name), name: $0.name, applicationId: applicationId, memberCount: $0.members)
        }
        seedRecents()
        return DemoBackend(
            account: me, applicationId: applicationId, namespaces: namespaces, subgroups: subgroups, members: members,
            handler: { try store.handle($0) })
    }

    /// What "this phone" opened last in the main workspace, oldest first.
    private static func seedRecents() {
        let ws = workspaceId(main)
        UserDefaults.standard.removeObject(forKey: "mero-docs:recent:\(ws)")
        let recents = DefaultsRecentStore()
        let opened: [(String, String, TimeInterval)] = [
            ("Product", "User interview synthesis", 26 * 3600),
            ("Meeting notes", "Weekly sync notes", 5 * 3600),
            ("Product", "Q4 roadmap", 50 * 60),
        ]
        for (folder, title, ago) in opened {
            recents.touch(workspaceId: ws, folderId: folderId(folder), docId: docId(title), at: Date().addingTimeInterval(-ago))
        }
    }

    // MARK: Contract

    struct DemoDoc {
        let dto: DocDto
        let blocks: [Block]
        var plain: [String] { blocks.map { $0.spans.map(\.text).joined() } }
    }

    final class Store: @unchecked Sendable {
        private let lock = NSLock()
        private var docs: [String: [DemoDoc]] = [:]
        private var comments: [String: [CommentDto]] = [:]
        private var nextComment = 0

        init() {
            for space in Fixtures.spaces {
                for folder in space.folders {
                    docs[contextId(folder.name)] = folder.docs.map { $0.build(folder: folder.name, workspace: space.name) }
                }
            }
            for doc in docs.values.joined() {
                comments[doc.dto.id] = Fixtures.comments(on: doc)
            }
        }

        func handle(_ call: DemoCall) throws -> Data {
            lock.lock()
            defer { lock.unlock() }
            let here = docs[call.contextId] ?? []
            switch call.method {
            case "list_docs":
                return try DemoReply.json(here.map(\.dto))
            case "get_doc":
                return try DemoReply.json(try find(call.string("id"), in: here).dto)
            case "get_document":
                return try DemoReply.json(try find(call.string("doc"), in: here).blocks)
            case "list_comments":
                return try DemoReply.json(comments[call.string("doc_id") ?? ""] ?? [])
            case "comment_count":
                return try DemoReply.json(UInt64(comments.values.joined().count))
            case "add_comment":
                let doc = try find(call.string("doc_id"), in: here)
                nextComment += 1
                let id = DemoIds.hex("comment:new:\(nextComment)")
                comments[doc.dto.id, default: []].append(
                    CommentDto(
                        id: id, author: me, docId: doc.dto.id, body: call.string("body") ?? "",
                        createdAt: DemoIds.stamp(ago: 0)))
                return try DemoReply.json(id)
            case "search_docs":
                return try DemoReply.json(search(call.string("query") ?? "", in: here))
            default:
                return DemoReply.null
            }
        }

        private func find(_ id: String?, in list: [DemoDoc]) throws -> DemoDoc {
            guard let id, let doc = list.first(where: { $0.dto.id == id }) else {
                throw DemoContractError("Document not found")
            }
            return doc
        }

        private func search(_ query: String, in list: [DemoDoc]) -> DocSearchPage {
            let q = query.trimmingCharacters(in: .whitespaces).lowercased()
            guard !q.isEmpty else { return DocSearchPage(hits: [], total: 0) }
            var hits: [DocSearchHit] = []
            for doc in list {
                let inTitle = doc.dto.title.lowercased().contains(q)
                let body = doc.plain.filter { $0.lowercased().contains(q) }
                guard inTitle || !body.isEmpty else { continue }
                let snippet = body.first.map { Self.snippet($0, q) } ?? ""
                hits.append(
                    DocSearchHit(
                        id: doc.dto.id, title: doc.dto.title, snippet: snippet,
                        score: (inTitle ? 4 : 0) + Float(body.count), archived: false))
            }
            hits.sort { $0.score > $1.score }
            return DocSearchPage(hits: hits, total: UInt64(hits.count))
        }

        /// About 90 characters around the first match, the match in `<b>`.
        static func snippet(_ text: String, _ q: String) -> String {
            guard let r = text.range(of: q, options: .caseInsensitive) else { return text }
            let start = text.index(r.lowerBound, offsetBy: -40, limitedBy: text.startIndex) ?? text.startIndex
            let end = text.index(r.upperBound, offsetBy: 50, limitedBy: text.endIndex) ?? text.endIndex
            let lead = start == text.startIndex ? "" : "…"
            let tail = end == text.endIndex ? "" : "…"
            return lead + text[start..<r.lowerBound] + "<b>" + text[r] + "</b>" + text[r.upperBound..<end] + tail
        }
    }

    // MARK: Blobs

    /// The launch plan's diagram, drawn once.
    struct Blobs: BlobLoading {
        func blob(id: String, contextId: String) async throws -> Data {
            try await Task.sleep(nanoseconds: 350_000_000)
            guard id == DocsDemo.syncImage, let png = DocsDemo.diagram else { throw URLError(.resourceUnavailable) }
            return png
        }
    }

    static let diagram: Data? = {
        let size = CGSize(width: 1200, height: 660)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let renderer = UIGraphicsImageRenderer(size: size, format: format)
        let image = renderer.image { ctx in
            let cg = ctx.cgContext
            UIColor(red: 0.965, green: 0.965, blue: 0.955, alpha: 1).setFill()
            cg.fill(CGRect(origin: .zero, size: size))
            let ink = UIColor(red: 0.043, green: 0.043, blue: 0.047, alpha: 1)
            let muted = UIColor(red: 0.43, green: 0.44, blue: 0.46, alpha: 1)
            let lime = UIColor(red: 0.647, green: 1, blue: 0.067, alpha: 1)
            func draw(_ text: String, at point: CGPoint, size: CGFloat, weight: UIFont.Weight, color: UIColor, center: Bool = true) {
                let attrs: [NSAttributedString.Key: Any] = [
                    .font: UIFont.systemFont(ofSize: size, weight: weight), .foregroundColor: color,
                ]
                let s = NSAttributedString(string: text, attributes: attrs)
                let w = s.size().width
                s.draw(at: CGPoint(x: center ? point.x - w / 2 : point.x, y: point.y))
            }
            draw("Offline sync path", at: CGPoint(x: 70, y: 56), size: 40, weight: .bold, color: ink, center: false)
            draw("How an edit made in a dead zone reaches everyone in the folder", at: CGPoint(x: 70, y: 110),
                 size: 24, weight: .regular, color: muted, center: false)
            let boxes: [(String, String, String, UIColor)] = [
                ("Phone", "local replica", "pending ops queue", lime),
                ("Relay", "store and forward", "acks by (replica, counter)", UIColor.white),
                ("Folder", "docs context", "merged on every peer", UIColor(red: 0.87, green: 0.92, blue: 0.95, alpha: 1)),
            ]
            let w: CGFloat = 300, h: CGFloat = 230, top: CGFloat = 230, gap: CGFloat = 75
            for (i, box) in boxes.enumerated() {
                let x = 70 + CGFloat(i) * (w + gap)
                let rect = CGRect(x: x, y: top, width: w, height: h)
                let path = UIBezierPath(roundedRect: rect, cornerRadius: 28)
                cg.saveGState()
                cg.setShadow(offset: CGSize(width: 0, height: 8), blur: 24, color: UIColor.black.withAlphaComponent(0.08).cgColor)
                box.3.setFill()
                path.fill()
                cg.restoreGState()
                ink.withAlphaComponent(0.14).setStroke()
                path.lineWidth = 2
                path.stroke()
                draw(box.0, at: CGPoint(x: rect.midX, y: top + 48), size: 38, weight: .bold, color: ink)
                draw(box.1, at: CGPoint(x: rect.midX, y: top + 110), size: 24, weight: .medium, color: ink)
                draw(box.2, at: CGPoint(x: rect.midX, y: top + 150), size: 20, weight: .regular, color: muted)
                if i < boxes.count - 1 {
                    let y = top + h / 2
                    let from = CGPoint(x: rect.maxX + 12, y: y)
                    let to = CGPoint(x: rect.maxX + gap - 12, y: y)
                    let arrow = UIBezierPath()
                    arrow.move(to: from)
                    arrow.addLine(to: to)
                    arrow.move(to: CGPoint(x: to.x - 14, y: y - 12))
                    arrow.addLine(to: to)
                    arrow.addLine(to: CGPoint(x: to.x - 14, y: y + 12))
                    arrow.lineWidth = 5
                    arrow.lineCapStyle = .round
                    arrow.lineJoinStyle = .round
                    ink.setStroke()
                    arrow.stroke()
                }
            }
            let legend: [(String, UIColor)] = [("Typical catch-up after reconnecting: 4 to 9 s", ink)]
            for (i, item) in legend.enumerated() {
                let y = top + h + 70 + CGFloat(i) * 40
                lime.setFill()
                UIBezierPath(ovalIn: CGRect(x: 70, y: y + 6, width: 18, height: 18)).fill()
                draw(item.0, at: CGPoint(x: 102, y: y), size: 24, weight: .medium, color: item.1, center: false)
            }
        }
        return image.pngData()
    }()
}

// MARK: - Fixture content

private enum Fixtures {
    struct Space {
        let name: String
        let members: Int
        let folders: [FolderSeed]
    }

    struct FolderSeed {
        let name: String
        var parent: String? = nil
        let docs: [DocSeed]
    }

    struct DocSeed {
        let title: String
        /// Minutes since the last edit.
        let edited: Double
        let by: String
        let body: [String]
        var tags: [String] = []

        func build(folder: String, workspace: String) -> DocsDemo.DemoDoc {
            let id = DocsDemo.docId(title)
            let blocks = body.enumerated().map { i, line in
                Markup.block(line, id: String(DemoIds.hex("block:\(title):\(i)").prefix(24)), workspace: workspace)
            }
            let creator = DocsDemo.person(by == "me" ? "Maya Chen" : "Daniel Okafor")
            return DocsDemo.DemoDoc(
                dto: DocDto(
                    id: id, title: title, tags: tags, archived: false, createdAt: DemoIds.stamp(ago: edited * 60 + 9 * 86_400),
                    updatedAt: DemoIds.stamp(ago: edited * 60), createdBy: creator,
                    updatedBy: by == "me" ? DocsDemo.me : DocsDemo.person(by), canDelete: by == "me"),
                blocks: blocks)
        }
    }

    // MARK: Comments

    /// Threads on the launch plan's blocks, and one on a meeting note.
    static func comments(on doc: DocsDemo.DemoDoc) -> [CommentDto] {
        let seeds: [(on: String?, who: String, ago: Double, text: String, replies: [(String, Double, String)])]
        switch doc.dto.title {
        case "Offline sync launch plan":
            seeds = [
                ("Decision needed", "Daniel Okafor", 190,
                 "My vote: ship hints in v1. Without them people will think the merge ate their words.",
                 [("Maya Chen", 160, "Agree, as long as they can be dismissed. I'll mock the banner today."),
                  ("me", 95, "+1. Let's keep the copy under 60 characters so it fits on small phones.")]),
                ("Every edit made offline", "Lena Fischer", 140,
                 "30 s is tight on 3G. Can we promise \"within a minute\" publicly and keep 30 s as the internal target?",
                 [("Daniel Okafor", 120, "Works for me. Support will thank us.")]),
                ("for op in pending", "Arjun Mehta", 75,
                 "We should batch these. One request per op will hammer the relay after a long flight.",
                 [("Lena Fischer", 52, "Batches of 200 ops kept p95 under 2 s in the soak test.")]),
                ("Release notes", "Sofia Rossi", 38,
                 "Draft is in Marketing, \"Launch announcement draft\". It still needs a screenshot of the offline badge.",
                 []),
                (nil, "Tom Becker", 22,
                 "Great write-up. Can we add the rollback plan before Thursday's review?", []),
            ]
        case "Weekly sync notes":
            seeds = [
                (nil, "Lena Fischer", 240, "Added the soak test numbers under Engineering.", []),
            ]
        default:
            return []
        }
        var out: [CommentDto] = []
        for (n, seed) in seeds.enumerated() {
            let blockId = seed.on.flatMap { prefix in
                zip(doc.blocks, doc.plain).first { $0.1.hasPrefix(prefix) || $0.1.contains(prefix) }?.0.id
            }
            let rootId = DemoIds.hex("comment:\(doc.dto.title):\(n)")
            out.append(
                CommentDto(
                    id: rootId, author: author(seed.who), docId: doc.dto.id,
                    body: CommentBody.encode(seed.text, blockId: blockId), createdAt: DemoIds.stamp(ago: seed.ago * 60)))
            for (r, reply) in seed.replies.enumerated() {
                out.append(
                    CommentDto(
                        id: DemoIds.hex("comment:\(doc.dto.title):\(n):\(r)"), author: author(reply.0), docId: doc.dto.id,
                        body: CommentBody.encode(reply.2, replyTo: rootId), createdAt: DemoIds.stamp(ago: reply.1 * 60)))
            }
        }
        return out
    }

    private static func author(_ who: String) -> String { who == "me" ? DocsDemo.me : DocsDemo.person(who) }

    // MARK: Spaces

    static let spaces: [Space] = [
        Space(name: DocsDemo.main, members: 14, folders: [
            FolderSeed(name: "Design", docs: [
                DocSeed(title: "Mobile navigation refresh", edited: 3 * 60, by: "Sofia Rossi", body: [
                    "## Problem",
                    "Five tabs is one too many on small phones. In testing, 7 of 12 people missed **Search** entirely because it sat behind \"More\".",
                    "## Proposal",
                    "- Move Search into the workspace header, always visible",
                    "- Fold Activity into the Inbox tab",
                    "- Keep the bottom bar to four items",
                    "> Fewer destinations, but each one obvious.",
                ]),
                DocSeed(title: "Icon set guidelines", edited: 2 * 1440, by: "Sofia Rossi", body: [
                    "## Grid",
                    "Icons sit on a 24 pt grid with a 2 pt stroke. Corners round at 2 pt; never mix filled and outlined icons in one toolbar.",
                    "- Use the lime accent only for the active state",
                    "- Offline and sync states use the cloud family",
                ]),
                DocSeed(title: "Onboarding flow review", edited: 5 * 1440, by: "Maya Chen", body: [
                    "## Findings",
                    "Most drop-off happens on the workspace step, not sign-in. People don't know what a workspace is yet.",
                    "1. Pre-fill a workspace name from the email domain",
                    "2. Explain folders with one example, not three",
                ]),
            ]),
            FolderSeed(name: "Engineering", docs: [
                DocSeed(title: "Offline sync launch plan", edited: 12, by: "Maya Chen", body: launchPlan, tags: ["launch"]),
                DocSeed(title: "On-call handbook", edited: 9 * 60, by: "Arjun Mehta", body: [
                    "## First ten minutes",
                    "1. Acknowledge the page in the on-call channel",
                    "2. Check the relay dashboard for error rate and queue depth",
                    "3. If more than one region is affected, declare an incident",
                    "Phones reconnecting after an outage replay their offline edits in bursts. Expect a spike, not a failure.",
                ]),
                DocSeed(title: "API versioning policy", edited: 3 * 1440, by: "Lena Fischer", body: [
                    "## Rules",
                    "- Additive changes ship any time",
                    "- Renames and removals need a deprecation window of two releases",
                    "- Contract methods are never repurposed; add a new one instead",
                ]),
                DocSeed(title: "Postmortem: relay timeouts", edited: 6 * 1440, by: "Daniel Okafor", body: [
                    "## Summary",
                    "For 38 minutes, 6% of writes from phones timed out. A certificate rotation left one relay serving a stale chain.",
                    "## What went well",
                    "- Offline edits queued on the phone and none were lost",
                    "- Alerts fired within two minutes",
                    "## Follow-ups",
                    "[x] Automate certificate rotation",
                    "[ ] Add a chain check to the relay health probe",
                ]),
            ]),
            FolderSeed(name: "Runbooks", parent: "Engineering", docs: [
                DocSeed(title: "Rotate relay certificates", edited: 4 * 1440, by: "Arjun Mehta", body: [
                    "## Steps",
                    "1. Issue the new certificate with the staging CA first",
                    "2. Roll relays one region at a time, watching the handshake error rate",
                    "```bash\nmero relay rotate-cert --region eu-west --dry-run\n```",
                ]),
                DocSeed(title: "Restore a node from snapshot", edited: 11 * 1440, by: "Lena Fischer", body: [
                    "Snapshots are taken every six hours. Restoring one takes about 4 minutes for a 20 GB store.",
                    "- Stop the node",
                    "- Restore, then let peers catch it up",
                ]),
            ]),
            FolderSeed(name: "RFCs", parent: "Engineering", docs: [
                DocSeed(title: "RFC 018: Block-level comments", edited: 2 * 1440, by: "me", body: [
                    "## Motivation",
                    "Comments on a whole document get lost in long specs. Anchoring a comment to one block keeps the discussion next to the words it is about.",
                    "## Design",
                    "A comment body starts with `[[block:<id>]]`. Readers that don't know the prefix still show the words.",
                ]),
                DocSeed(title: "RFC 019: Search ranking", edited: 8 * 1440, by: "Arjun Mehta", body: [
                    "Titles weigh double. Exact phrase matches beat scattered terms, and recently edited documents get a small boost.",
                ]),
            ]),
            FolderSeed(name: "Marketing", docs: [
                DocSeed(title: "Launch announcement draft", edited: 40, by: "Sofia Rossi", body: [
                    "## Headline",
                    "Write anywhere. Mero Docs now works offline.",
                    "Field teams told us the same story again and again: a note started in a basement, lost in the elevator. Starting November 18, every edit you make offline syncs the moment you're back.",
                    "- Works on iOS and Android",
                    "- No settings to change",
                ]),
                DocSeed(title: "Customer story: Fieldwise", edited: 4 * 1440, by: "Tom Becker", body: [
                    "Fieldwise inspects 1,200 sites a month. Their inspectors write reports on site, often with no signal at all.",
                    "> We used to email photos to ourselves as a backup. Now we just write.",
                ]),
            ]),
            FolderSeed(name: "Meeting notes", docs: [
                DocSeed(title: "Weekly sync notes", edited: 5 * 60, by: "Tom Becker", body: [
                    "## Updates",
                    "- Offline sync is feature complete; soak test passed",
                    "- Navigation refresh moves to user testing next week",
                    "## Action items",
                    "[x] Maya to circulate the launch plan",
                    "[ ] Sofia to finish the announcement draft",
                    "[ ] Arjun to size relay capacity for launch week",
                ]),
                DocSeed(title: "Design critique: settings", edited: 3 * 1440, by: "Sofia Rossi", body: [
                    "Settings has grown to 31 rows. We agreed to group them under Account, Notifications and Storage.",
                ]),
                DocSeed(title: "Q4 kickoff", edited: 13 * 1440, by: "Maya Chen", body: [
                    "## Themes",
                    "1. Reliability: offline sync, faster cold start",
                    "2. Collaboration: block comments, mentions",
                    "3. Growth: templates and the customer stories program",
                ]),
            ]),
            FolderSeed(name: "Product", docs: [
                DocSeed(title: "Q4 roadmap", edited: 2 * 60, by: "Maya Chen", body: [
                    "## October",
                    "[x] Block comments on mobile",
                    "## November",
                    "[ ] Offline sync, general availability",
                    "[ ] Templates gallery",
                    "## December",
                    "[ ] Mentions and notifications",
                ]),
                DocSeed(title: "Pricing page brief", edited: 2 * 1440, by: "Tom Becker", body: [
                    "Three plans, one page. Lead with the team plan; offline and history are included in every plan.",
                ]),
                DocSeed(title: "User interview synthesis", edited: 6 * 1440, by: "Maya Chen", body: [
                    "## What we heard",
                    "- \"I need it to work in the field, without signal\" (9 of 14)",
                    "- \"Comments get lost in long docs\" (6 of 14)",
                    "- \"Search should find words inside docs, not just titles\" (5 of 14)",
                ]),
            ]),
        ]),
        Space(name: "Harbor Research", members: 6, folders: [
            FolderSeed(name: "Studies", docs: [
                DocSeed(title: "Coastal sensor study", edited: 2 * 1440, by: "Lena Fischer", body: [
                    "Twelve buoys, readings every ten minutes, synced when a boat passes within range.",
                ]),
            ]),
            FolderSeed(name: "Grants", docs: [
                DocSeed(title: "Marine data grant, 2027", edited: 9 * 1440, by: "Tom Becker", body: [
                    "Deadline January 15. Budget draft attached in the shared drive.",
                ]),
            ]),
        ]),
        Space(name: "Personal notes", members: 1, folders: [
            FolderSeed(name: "Journal", docs: [
                DocSeed(title: "Reading list", edited: 3 * 1440, by: "me", body: [
                    "- Designing Data-Intensive Applications",
                    "- The Mythical Man-Month",
                ]),
            ]),
        ]),
    ]

    /// The document the tour opens: every block kind the reader draws.
    static let launchPlan: [String] = [
        "Owner: **Maya Chen** · Target: **November 18** · Status: *In review*",
        "!callout yellow **Decision needed by Friday:** do we ship conflict hints in v1, or hold them for 1.1?",
        "## Why now",
        "Field teams lose about **40 minutes a week** re-typing notes after a dead zone. Since September, *31% of support tickets* mention lost edits, almost all of them from phones. The [pilot postmortem](doc:Engineering/Postmortem: relay timeouts) has the details.",
        "## Goals",
        "1. Every edit made offline reaches the folder within 30 seconds of reconnecting",
        "2. No silent overwrites: concurrent edits to one block merge, character by character",
        "3. Ship to iOS and Android in the same week",
        "## Scope",
        "- Documents, comments and titles all sync offline",
        "  - Images upload on Wi-Fi, or on cellular if the member allows it",
        "  - Pending edits survive an app restart",
        "- Out of scope: offline search in folders the phone never opened",
        "## Launch checklist",
        "[x] Sync engine merged behind the `offline_sync` flag",
        "[x] Soak test: 72 hours, 3 relays, 0 divergent replicas",
        "[x] Security review of the local store",
        "[ ] Release notes and help center article",
        "[ ] Support macros for \"my edit disappeared\"",
        "[ ] Turn the flag on for 10% of workspaces",
        "> \"I stopped thinking about signal. I write, and it's there when I get back to the truck.\" Priya, site inspector, pilot week 2",
        "## How it works",
        "Each block is a sequence CRDT. The phone keeps its own replica and replays queued ops to the relay when it reconnects:",
        "```swift\nfor op in pending.drain(max: 200) {\n    try await relay.send(op)   // idempotent: ids are (replica, counter)\n    queue.ack(op.id)\n}\n```",
        "!image Sync path: phone replica, relay, then every peer in the folder",
        "## Rollout",
        "**Week 1:** internal workspaces. **Week 2:** 10% of workspaces, watching divergence alerts and the ~~sync-bug~~ *edit-loss* support tag. **Week 3:** everyone.",
        "---",
        "### Open questions",
        "- Do we show a banner while offline, or only a small cloud icon in the toolbar?",
        "- How long do we keep pending edits if the member signs out?",
    ]
}

/// One line of fixture markup as a contract block: `## ` headings, `- ` and
/// `1. ` lists (two leading spaces per level), `[x] ` checks, `> ` quotes,
/// fenced code, `---`, `!image` and `!callout <colour>`; inline `**bold**`,
/// `*italic*`, `~~strike~~`, `` `code` `` and `[text](url)`.
private enum Markup {
    static func block(_ source: String, id: String, workspace: String) -> Block {
        var line = Substring(source)
        var depth: UInt32 = 0
        while line.hasPrefix("  ") {
            depth += 1
            line = line.dropFirst(2)
        }
        var kind = "paragraph"
        var attrs: [String: String] = [:]
        var text = String(line)
        var inline = true
        func strip(_ prefix: String) -> Bool {
            guard text.hasPrefix(prefix) else { return false }
            text = String(text.dropFirst(prefix.count))
            return true
        }
        if strip("### ") {
            kind = "heading"; attrs["level"] = "3"
        } else if strip("## ") {
            kind = "heading"; attrs["level"] = "2"
        } else if strip("# ") {
            kind = "heading"; attrs["level"] = "1"
        } else if strip("- ") {
            kind = "bulletListItem"
        } else if let dot = text.firstIndex(of: "."), text[..<dot].allSatisfy(\.isNumber), !text[..<dot].isEmpty,
            text[text.index(after: dot)...].hasPrefix(" ")
        {
            kind = "numberedListItem"
            text = String(text[text.index(dot, offsetBy: 2)...])
        } else if strip("[x] ") {
            kind = "checkListItem"; attrs["checked"] = "true"
        } else if strip("[ ] ") {
            kind = "checkListItem"
        } else if strip("> ") {
            kind = "quote"
        } else if text == "---" {
            kind = "divider"; text = ""
        } else if text.hasPrefix("```") {
            kind = "codeBlock"
            inline = false
            var lines = text.components(separatedBy: "\n")
            attrs["language"] = String(lines.removeFirst().dropFirst(3))
            if lines.last == "```" { lines.removeLast() }
            text = lines.joined(separator: "\n")
        } else if strip("!image ") {
            kind = "image"
            attrs["url"] = "blob:\(DocsDemo.syncImage)"
            attrs["caption"] = text
            attrs["name"] = "sync-path.png"
            text = ""
        } else if strip("!callout ") {
            let colour = text.prefix { $0 != " " }
            attrs["backgroundColor"] = String(colour)
            text = String(text.dropFirst(colour.count + 1))
        }
        let spans = inline ? Self.spans(text, workspace: workspace) : (text.isEmpty ? [] : [Span(text: text, attributes: [:])])
        let length = UInt32(spans.reduce(0) { $0 + $1.text.unicodeScalars.count })
        return Block(
            id: id, kind: kind, depth: depth, attrs: attrs, spans: spans,
            ids: length == 0 ? [] : [Run(replica: DocsDemo.me, counter: 1, len: length)])
    }

    /// Inline marks as spans.
    static func spans(_ text: String, workspace: String) -> [Span] {
        var out: [Span] = []
        var marks: [String: String] = [:]
        var buffer = ""
        var rest = Substring(text)
        func flush() {
            if !buffer.isEmpty { out.append(Span(text: buffer, attributes: marks)) }
            buffer = ""
        }
        func toggle(_ key: String) {
            flush()
            if marks[key] == nil { marks[key] = "true" } else { marks[key] = nil }
        }
        while let c = rest.first {
            if rest.hasPrefix("**") {
                toggle("bold"); rest = rest.dropFirst(2)
            } else if rest.hasPrefix("~~") {
                toggle("strike"); rest = rest.dropFirst(2)
            } else if c == "*" {
                toggle("italic"); rest = rest.dropFirst()
            } else if c == "`" {
                toggle("code"); rest = rest.dropFirst()
            } else if c == "[", let close = rest.range(of: "]("), let end = rest[close.upperBound...].firstIndex(of: ")") {
                flush()
                let label = String(rest[rest.index(after: rest.startIndex)..<close.lowerBound])
                let target = String(rest[close.upperBound..<end])
                out.append(Span(text: label, attributes: marks.merging(["link": link(target, workspace: workspace)]) { a, _ in a }))
                rest = rest[rest.index(after: end)...]
            } else {
                buffer.append(c)
                rest = rest.dropFirst()
            }
        }
        flush()
        return out
    }

    /// `doc:<folder>/<title>` is a link to another fixture document.
    static func link(_ target: String, workspace: String) -> String {
        guard target.hasPrefix("doc:") else { return target }
        let parts = target.dropFirst(4).split(separator: "/", maxSplits: 1).map(String.init)
        return DocsFormat.docLink(
            DocTarget(
                workspaceId: DocsDemo.workspaceId(workspace), folderId: DocsDemo.folderId(parts[0]),
                docId: DocsDemo.docId(parts[1])))
    }
}
#endif
