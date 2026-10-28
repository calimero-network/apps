#if DEBUG
import CrmCore
import Foundation
import MeroKit

/// Mero CRM's demo: two workspaces, a "New business" pipeline full of deals in
/// every stage, the people and companies behind them, a to-do list, notes,
/// automations and a closed history for the insights. The contract answers
/// `list_deals`, `get_deal`, ... in the generated client's wire shape, and
/// writes change the fixtures, so the tour can move a deal, schedule a step
/// and tick off a to-do.
enum CrmDemo {
    static let me = person("Elena Novak")
    static let daniel = person("Daniel Okafor")
    static let sofia = person("Sofia Lindqvist")
    static let applicationId = DemoIds.hex("app:mero-crm")

    static let halden = DemoIds.hex("workspace:Halden Analytics")
    static let emea = DemoIds.hex("workspace:Halden EMEA")

    static func makeBackend() -> DemoBackend {
        let pipelines: [(String, String, String)] = [
            (halden, "New business", "ctx:new-business"),
            (halden, "Renewals", "ctx:renewals"),
            (halden, "Partnerships", "ctx:partnerships"),
            (emea, "Enterprise EMEA", "ctx:enterprise-emea"),
        ]
        // Pipeline names are device-local labels (LocalNames); the demo sets them.
        let names = LocalNames()
        for (_, name, seed) in pipelines { names.setPipeline(DemoIds.hex(seed), name) }
        // Start on the workspace list every launch.
        UserDefaults.standard.removeObject(forKey: "openPipeline")

        let store = Store(now: Date())
        func contexts(_ ns: String) -> [String] { pipelines.filter { $0.0 == ns }.map { DemoIds.hex($0.2) } }
        return DemoBackend(
            account: me, applicationId: applicationId,
            namespaces: [
                AppNamespace(id: halden, name: "Halden Analytics", applicationId: applicationId, memberCount: 6),
                AppNamespace(id: emea, name: "Halden EMEA", applicationId: applicationId, memberCount: 3),
            ],
            // WorkspacesModel lists a workspace's pipelines with `listContexts(groupId: namespaceId)`.
            subgroups: [
                halden: [AppSubgroup(groupId: halden, name: "Halden Analytics", contextIds: contexts(halden))],
                emea: [AppSubgroup(groupId: emea, name: "Halden EMEA", contextIds: contexts(emea))],
            ],
            members: Set(pipelines.map { DemoIds.hex($0.2) }),
            handler: { try store.handle($0) })
    }

    static func person(_ name: String) -> String { DemoIds.hex("person:\(name)") }

    // MARK: State

    struct DealRecord {
        var id: String
        var title: String
        var value: UInt64
        var organization: String
        var contactId: String?
        var owner: String?
        var stageId: String
        var status: String
        var lostReason: String
        var expectedClose: UInt64?
        var source: String
        var stageEnteredAt: UInt64
        var closedAt: UInt64?
        var createdBy: String
        var createdAt: UInt64
    }

    struct ContactRecord {
        var id: String
        var name: String
        var email: String
        var phone: String
        var organization: String
        var jobTitle: String
        var createdBy: String
        var createdAt: UInt64
    }

    struct Pipeline {
        var stages: [StageView] = []
        var deals: [DealRecord] = []
        var contacts: [ContactRecord] = []
        var activities: [ActivityView] = []
        var notes: [NoteView] = []
        var automations: [AutomationView] = []
        var settings = Settings(currency: "USD", rottingDays: 14)
    }

    final class Store: @unchecked Sendable {
        private let lock = NSLock()
        private let now: Date
        private var pipelines: [String: Pipeline] = [:]
        private var next = 0

        init(now: Date) { self.now = now }

        func handle(_ call: DemoCall) throws -> Data {
            lock.lock()
            defer { lock.unlock() }
            var p = pipelines[call.contextId] ?? Seed.pipeline(now: now)
            defer { pipelines[call.contextId] = p }
            let nowMs = Days.ms(Date())

            switch call.method {
            // Reads
            case "list_stages":
                return try DemoReply.json(p.stages.sorted { $0.position < $1.position })
            case "list_deals":
                let status = call.string("status")
                let stage = call.string("stage_id")
                let owner = call.string("owner")
                let rows = p.deals
                    .filter { status == nil || $0.status == status }
                    .filter { stage == nil || $0.stageId == stage }
                    .filter { owner == nil || $0.owner == owner }
                return try DemoReply.json(rows.map { view($0, p) })
            case "list_contacts":
                return try DemoReply.json(p.contacts.map { view($0, p) })
            case "list_activities":
                let dealId = call.string("deal_id")
                let done = call.args["done"] as? Bool
                let rows = p.activities
                    .filter { dealId == nil || $0.dealId == dealId }
                    .filter { done == nil || $0.done == done }
                return try DemoReply.json(rows.map { activityView($0, p) })
            case "list_automations":
                return try DemoReply.json(p.automations)
            case "get_settings":
                return try DemoReply.json(p.settings)
            case "get_deal":
                guard let id = call.string("deal_id"), let d = p.deals.first(where: { $0.id == id }) else {
                    throw DemoContractError("Deal not found")
                }
                let detail = DealDetail(
                    deal: view(d, p), contact: d.contactId.flatMap { cid in p.contacts.first { $0.id == cid } }.map { view($0, p) },
                    activities: p.activities.filter { $0.dealId == id }.sorted { $0.dueAt < $1.dueAt }.map { activityView($0, p) },
                    notes: p.notes.filter { $0.dealId == id }.sorted { $0.createdAt > $1.createdAt })
                return try DemoReply.json(detail)

            // Deals
            case "create_deal":
                let id = mint("deal")
                let stageId = call.string("stage_id") ?? p.stages.first?.id ?? ""
                p.deals.append(
                    DealRecord(
                        id: id, title: call.string("title") ?? "", value: u64(call, "value") ?? 0,
                        organization: call.string("organization") ?? "", contactId: call.string("contact_id"),
                        owner: call.string("owner") ?? CrmDemo.me, stageId: stageId, status: "open", lostReason: "",
                        expectedClose: u64(call, "expected_close"), source: call.string("source") ?? "",
                        stageEnteredAt: nowMs, closedAt: nil, createdBy: CrmDemo.me, createdAt: nowMs))
                fireAutomations(&p, dealId: id, stageId: stageId, nowMs: nowMs)
                return try DemoReply.json(id)
            case "update_deal":
                if let id = call.string("deal_id"), let i = p.deals.firstIndex(where: { $0.id == id }) {
                    p.deals[i].title = call.string("title") ?? p.deals[i].title
                    p.deals[i].value = u64(call, "value") ?? p.deals[i].value
                    p.deals[i].organization = call.string("organization") ?? p.deals[i].organization
                    p.deals[i].contactId = call.string("contact_id")
                    p.deals[i].owner = call.string("owner")
                    p.deals[i].expectedClose = u64(call, "expected_close")
                    p.deals[i].source = call.string("source") ?? p.deals[i].source
                }
            case "move_deal":
                if let id = call.string("deal_id"), let stageId = call.string("stage_id"),
                    let i = p.deals.firstIndex(where: { $0.id == id }), p.deals[i].stageId != stageId
                {
                    p.deals[i].stageId = stageId
                    p.deals[i].stageEnteredAt = nowMs
                    fireAutomations(&p, dealId: id, stageId: stageId, nowMs: nowMs)
                }
            case "mark_won", "mark_lost", "reopen_deal":
                if let id = call.string("deal_id"), let i = p.deals.firstIndex(where: { $0.id == id }) {
                    switch call.method {
                    case "mark_won":
                        p.deals[i].status = "won"
                        p.deals[i].closedAt = nowMs
                    case "mark_lost":
                        p.deals[i].status = "lost"
                        p.deals[i].lostReason = call.string("reason") ?? ""
                        p.deals[i].closedAt = nowMs
                    default:
                        p.deals[i].status = "open"
                        p.deals[i].lostReason = ""
                        p.deals[i].closedAt = nil
                    }
                }
            case "delete_deal":
                let id = call.string("deal_id")
                p.deals.removeAll { $0.id == id }
                p.activities.removeAll { $0.dealId == id }
                p.notes.removeAll { $0.dealId == id }

            // Activities and notes
            case "add_activity":
                let id = mint("activity")
                p.activities.append(
                    ActivityView(
                        id: id, dealId: call.string("deal_id"), contactId: call.string("contact_id"),
                        kind: call.string("kind") ?? "task", subject: call.string("subject") ?? "",
                        dueAt: u64(call, "due_at") ?? nowMs, done: false, owner: call.string("owner") ?? CrmDemo.me,
                        note: call.string("note") ?? "", createdBy: CrmDemo.me, createdAt: nowMs))
                return try DemoReply.json(id)
            case "set_activity_done":
                if let id = call.string("activity_id"), let i = p.activities.firstIndex(where: { $0.id == id }) {
                    let done = call.args["done"] as? Bool ?? true
                    p.activities[i].done = done
                    p.activities[i].doneAt = done ? nowMs : nil
                }
            case "reschedule_activity":
                if let id = call.string("activity_id"), let i = p.activities.firstIndex(where: { $0.id == id }),
                    let due = u64(call, "due_at")
                {
                    p.activities[i].dueAt = due
                }
            case "delete_activity":
                let id = call.string("activity_id")
                p.activities.removeAll { $0.id == id }
            case "add_note":
                let id = mint("note")
                p.notes.append(
                    NoteView(
                        id: id, dealId: call.string("deal_id") ?? "", author: CrmDemo.me, body: call.string("body") ?? "",
                        createdAt: nowMs))
                return try DemoReply.json(id)
            case "delete_note":
                let id = call.string("note_id")
                p.notes.removeAll { $0.id == id }

            // People
            case "create_contact":
                let id = mint("contact")
                p.contacts.append(
                    ContactRecord(
                        id: id, name: call.string("name") ?? "", email: call.string("email") ?? "",
                        phone: call.string("phone") ?? "", organization: call.string("organization") ?? "",
                        jobTitle: call.string("job_title") ?? "", createdBy: CrmDemo.me, createdAt: nowMs))
                return try DemoReply.json(id)
            case "update_contact":
                if let id = call.string("contact_id"), let i = p.contacts.firstIndex(where: { $0.id == id }) {
                    p.contacts[i].name = call.string("name") ?? p.contacts[i].name
                    p.contacts[i].email = call.string("email") ?? p.contacts[i].email
                    p.contacts[i].phone = call.string("phone") ?? p.contacts[i].phone
                    p.contacts[i].organization = call.string("organization") ?? p.contacts[i].organization
                    p.contacts[i].jobTitle = call.string("job_title") ?? p.contacts[i].jobTitle
                }
            case "delete_contact":
                let id = call.string("contact_id")
                p.contacts.removeAll { $0.id == id }
                for i in p.deals.indices where p.deals[i].contactId == id { p.deals[i].contactId = nil }

            // Pipeline setup
            case "add_stage":
                let id = mint("stage")
                let position = UInt32((p.stages.map(\.position).max() ?? 0) + 1)
                p.stages.append(
                    StageView(id: id, name: call.string("name") ?? "", probability: u32(call, "probability"), position: position))
                return try DemoReply.json(id)
            case "update_stage":
                if let id = call.string("stage_id"), let i = p.stages.firstIndex(where: { $0.id == id }) {
                    p.stages[i].name = call.string("name") ?? p.stages[i].name
                    p.stages[i].probability = u32(call, "probability")
                }
            case "delete_stage":
                let id = call.string("stage_id")
                if p.deals.contains(where: { $0.stageId == id && $0.status == "open" }) {
                    throw DemoContractError("Move this stage's open deals first")
                }
                p.stages.removeAll { $0.id == id }
            case "reorder_stages":
                for (n, id) in (call.strings("stage_ids") ?? []).enumerated() {
                    if let i = p.stages.firstIndex(where: { $0.id == id }) { p.stages[i].position = UInt32(n) }
                }
            case "set_currency":
                p.settings.currency = call.string("currency") ?? p.settings.currency
            case "set_rotting_days":
                p.settings.rottingDays = u32(call, "days")
            case "add_automation":
                let id = mint("automation")
                p.automations.append(
                    AutomationView(
                        id: id, stageId: call.string("stage_id") ?? "", kind: call.string("kind") ?? "task",
                        subject: call.string("subject") ?? "", dueInDays: u32(call, "due_in_days"), enabled: true,
                        createdBy: CrmDemo.me, createdAt: nowMs))
                return try DemoReply.json(id)
            case "set_automation_enabled":
                if let id = call.string("automation_id"), let i = p.automations.firstIndex(where: { $0.id == id }) {
                    p.automations[i].enabled = call.args["enabled"] as? Bool ?? true
                }
            case "delete_automation":
                let id = call.string("automation_id")
                p.automations.removeAll { $0.id == id }
            default:
                break
            }
            return DemoReply.null
        }

        // MARK: Derived views

        private func view(_ d: DealRecord, _ p: Pipeline) -> DealView {
            let open = p.activities.filter { $0.dealId == d.id && !$0.done }.sorted { $0.dueAt < $1.dueAt }
            let touches =
                p.activities.filter { $0.dealId == d.id && $0.done }.compactMap(\.doneAt)
                + p.notes.filter { $0.dealId == d.id }.map(\.createdAt)
            let probability: UInt32 =
                d.status == "won" ? 100 : d.status == "lost" ? 0 : (p.stages.first { $0.id == d.stageId }?.probability ?? 0)
            return DealView(
                id: d.id, title: d.title, value: d.value, organization: d.organization, contactId: d.contactId,
                contactName: d.contactId.flatMap { id in p.contacts.first { $0.id == id }?.name }, owner: d.owner,
                stageId: d.stageId, status: d.status, lostReason: d.lostReason, expectedClose: d.expectedClose,
                source: d.source, probability: probability, stageEnteredAt: d.stageEnteredAt, closedAt: d.closedAt,
                nextActivity: open.first.map { NextActivity(id: $0.id, kind: $0.kind, subject: $0.subject, dueAt: $0.dueAt) },
                openActivities: UInt32(open.count), lastTouchAt: touches.max(), createdBy: d.createdBy, createdAt: d.createdAt)
        }

        private func view(_ c: ContactRecord, _ p: Pipeline) -> ContactView {
            let deals = p.deals.filter { $0.contactId == c.id }
            return ContactView(
                id: c.id, name: c.name, email: c.email, phone: c.phone, organization: c.organization, jobTitle: c.jobTitle,
                openDeals: UInt32(deals.filter { $0.status == "open" }.count),
                wonValue: deals.filter { $0.status == "won" }.reduce(0) { $0 + $1.value }, createdBy: c.createdBy,
                createdAt: c.createdAt)
        }

        private func activityView(_ a: ActivityView, _ p: Pipeline) -> ActivityView {
            var out = a
            out.dealTitle = a.dealId.flatMap { id in p.deals.first { $0.id == id }?.title }
            return out
        }

        /// A deal entering a stage schedules what that stage's enabled rules say.
        private func fireAutomations(_ p: inout Pipeline, dealId: String, stageId: String, nowMs: UInt64) {
            let owner = p.deals.first { $0.id == dealId }?.owner ?? CrmDemo.me
            let contactId = p.deals.first { $0.id == dealId }?.contactId
            for rule in p.automations where rule.stageId == stageId && rule.enabled {
                let due = Days.ms(Days.dueIn(Int(rule.dueInDays), now: Date(), .current))
                p.activities.append(
                    ActivityView(
                        id: mint("activity"), dealId: dealId, contactId: contactId, kind: rule.kind, subject: rule.subject,
                        dueAt: due, done: false, owner: owner, note: "", automationId: rule.id, createdBy: CrmDemo.me,
                        createdAt: nowMs))
            }
        }

        private func mint(_ kind: String) -> String {
            next += 1
            return DemoIds.hex("\(kind):new:\(next)")
        }

        private func u64(_ call: DemoCall, _ key: String) -> UInt64? { (call.args[key] as? NSNumber)?.uint64Value }
        private func u32(_ call: DemoCall, _ key: String) -> UInt32 { (call.args[key] as? NSNumber)?.uint32Value ?? 0 }
    }

    // MARK: Seed

    /// The "New business" pipeline of a small analytics company, three people
    /// selling: a week of real work in every column.
    enum Seed {
        static func pipeline(now: Date) -> Pipeline {
            let cal = Calendar.current
            func ms(_ days: Double) -> UInt64 { Days.ms(now.addingTimeInterval(days * 86_400)) }
            /// A due time `days` from today at `hour`:00, as people schedule them.
            func due(_ days: Int, _ hour: Int = 10) -> UInt64 {
                let day = cal.date(byAdding: .day, value: days, to: cal.startOfDay(for: now)) ?? now
                return Days.ms(cal.date(bySettingHour: hour, minute: 0, second: 0, of: day) ?? day)
            }
            func id(_ s: String) -> String { DemoIds.hex(s) }

            var p = Pipeline()
            let stageNames: [(String, UInt32)] = [
                ("Lead in", 10), ("Qualified", 25), ("Demo", 40), ("Proposal", 60), ("Negotiation", 80),
            ]
            p.stages = stageNames.enumerated().map { i, s in
                StageView(id: id("stage:\(s.0)"), name: s.0, probability: s.1, position: UInt32(i))
            }
            let stage = Dictionary(uniqueKeysWithValues: stageNames.map { ($0.0, id("stage:\($0.0)")) })

            // People
            let people: [(String, String, String, String, String, Double)] = [
                ("Maya Chen", "VP Operations", "Brightline Logistics", "maya.chen@brightline-logistics.com", "+1 415 555 0142", -90),
                ("Tomás Herrera", "Head of Data", "Brightline Logistics", "tomas.herrera@brightline-logistics.com", "+1 415 555 0187", -60),
                ("Rachel Adeyemi", "CFO", "Northpeak Health", "r.adeyemi@northpeakhealth.org", "+1 617 555 0119", -120),
                ("Hannah Kim", "Data Platform Lead", "Northpeak Health", "hannah.kim@northpeakhealth.org", "+1 617 555 0164", -45),
                ("Jonas Weber", "IT Director", "Kessler Manufacturing", "j.weber@kessler-mfg.de", "+49 711 555 2030", -100),
                ("Aiko Tanaka", "Procurement Lead", "Sora Retail Group", "aiko.tanaka@soraretail.jp", "+81 3 5550 1840", -70),
                ("David Morales", "COO", "Harbor & Vine Hospitality", "david@harborandvine.com", "+1 305 555 0176", -75),
                ("Lena Fischer", "Head of Analytics", "Alpenrose Insurance", "lena.fischer@alpenrose.ch", "+41 44 555 7712", -150),
                ("Owen Blake", "Founder", "Fieldstone Coffee Co.", "owen@fieldstonecoffee.com", "+1 503 555 0133", -6),
                ("Priya Nair", "Director of Finance", "Cobalt Freight", "priya.nair@cobaltfreight.com", "+1 312 555 0158", -14),
                ("Samuel Okonkwo", "CTO", "Lumen Energy", "samuel@lumen-energy.io", "+1 720 555 0191", -80),
                ("Grace Whitfield", "VP Sales", "Tidewater Media", "grace.whitfield@tidewatermedia.com", "+1 646 555 0127", -40),
                ("Marco Rossi", "Operations Manager", "Verde Foods", "marco.rossi@verdefoods.it", "+39 02 5550 3391", -95),
                ("Clara Jensen", "Head of Risk", "Meridian Bank", "clara.jensen@meridianbank.com", "+1 212 555 0108", -65),
            ]
            p.contacts = people.enumerated().map { i, c in
                ContactRecord(
                    id: id("contact:\(c.0)"), name: c.0, email: c.3, phone: c.4, organization: c.2, jobTitle: c.1,
                    createdBy: [me, daniel, sofia][i % 3], createdAt: ms(c.5))
            }
            func contact(_ name: String) -> String { id("contact:\(name)") }

            // Deals: (title, value, org, contact, owner, stage/status, created, in stage since, close, source, closedAt, reason)
            struct D {
                let title: String, value: UInt64, org: String, contact: String, owner: String
                let stage: String, status: String, created: Double, entered: Double, close: Double?
                let source: String, closed: Double?, reason: String
            }
            let deals: [D] = [
                // Lead in
                D(title: "Fieldstone Coffee — 12-store dashboards", value: 9_600, org: "Fieldstone Coffee Co.", contact: "Owen Blake",
                  owner: me, stage: "Lead in", status: "open", created: -5, entered: -5, close: 45, source: "Website", closed: nil, reason: ""),
                D(title: "Verde Foods — supply chain pilot", value: 18_000, org: "Verde Foods", contact: "Marco Rossi",
                  owner: daniel, stage: "Lead in", status: "open", created: -7, entered: -7, close: 60, source: "Existing customer", closed: nil, reason: ""),
                D(title: "Tidewater Media — audience analytics", value: 24_000, org: "Tidewater Media", contact: "Grace Whitfield",
                  owner: me, stage: "Lead in", status: "open", created: -9, entered: -9, close: 50, source: "Conference", closed: nil, reason: ""),
                // Qualified
                D(title: "Cobalt Freight — route cost analytics", value: 42_000, org: "Cobalt Freight", contact: "Priya Nair",
                  owner: me, stage: "Qualified", status: "open", created: -14, entered: -6, close: 38, source: "Referral", closed: nil, reason: ""),
                D(title: "Sora Retail — 40-store rollout", value: 56_000, org: "Sora Retail Group", contact: "Aiko Tanaka",
                  owner: sofia, stage: "Qualified", status: "open", created: -18, entered: -8, close: 52, source: "Outbound", closed: nil, reason: ""),
                D(title: "Lumen Energy — grid telemetry", value: 31_500, org: "Lumen Energy", contact: "Samuel Okonkwo",
                  owner: daniel, stage: "Qualified", status: "open", created: -34, entered: -24, close: 20, source: "Partner", closed: nil, reason: ""),
                // Demo
                D(title: "Brightline Logistics — fleet analytics", value: 64_000, org: "Brightline Logistics", contact: "Maya Chen",
                  owner: me, stage: "Demo", status: "open", created: -3, entered: -1, close: 34, source: "Existing customer", closed: nil, reason: ""),
                D(title: "Alpenrose Insurance — claims analytics", value: 88_000, org: "Alpenrose Insurance", contact: "Lena Fischer",
                  owner: sofia, stage: "Demo", status: "open", created: -30, entered: -9, close: 64, source: "Existing customer", closed: nil, reason: ""),
                // Proposal
                D(title: "Northpeak Health — 3-clinic analytics", value: 120_000, org: "Northpeak Health", contact: "Rachel Adeyemi",
                  owner: me, stage: "Proposal", status: "open", created: -40, entered: -5, close: 18, source: "Existing customer", closed: nil, reason: ""),
                D(title: "Kessler Manufacturing — plant floor dashboards", value: 76_000, org: "Kessler Manufacturing", contact: "Jonas Weber",
                  owner: daniel, stage: "Proposal", status: "open", created: -36, entered: -11, close: 25, source: "Existing customer", closed: nil, reason: ""),
                // Negotiation
                D(title: "Harbor & Vine — group-wide license", value: 145_000, org: "Harbor & Vine Hospitality", contact: "David Morales",
                  owner: me, stage: "Negotiation", status: "open", created: -55, entered: -4, close: 6, source: "Referral", closed: nil, reason: ""),
                D(title: "Meridian Bank — risk reporting", value: 210_000, org: "Meridian Bank", contact: "Clara Jensen",
                  owner: sofia, stage: "Negotiation", status: "open", created: -62, entered: -12, close: -3, source: "Conference", closed: nil, reason: ""),
                // Won
                D(title: "Brightline Logistics — warehouse pilot", value: 22_000, org: "Brightline Logistics", contact: "Maya Chen",
                  owner: me, stage: "Negotiation", status: "won", created: -88, entered: -50, close: -42, source: "Outbound", closed: -40, reason: ""),
                D(title: "Northpeak Health — reporting starter", value: 15_000, org: "Northpeak Health", contact: "Hannah Kim",
                  owner: me, stage: "Negotiation", status: "won", created: -46, entered: -16, close: -12, source: "Website", closed: -12, reason: ""),
                D(title: "Verde Foods — demand forecasting", value: 38_000, org: "Verde Foods", contact: "Marco Rossi",
                  owner: daniel, stage: "Negotiation", status: "won", created: -64, entered: -10, close: -5, source: "Referral", closed: -5, reason: ""),
                D(title: "Alpenrose Insurance — broker portal", value: 54_000, org: "Alpenrose Insurance", contact: "Lena Fischer",
                  owner: sofia, stage: "Negotiation", status: "won", created: -140, entered: -80, close: -70, source: "Conference", closed: -70, reason: ""),
                D(title: "Kessler Manufacturing — quality pilot", value: 12_500, org: "Kessler Manufacturing", contact: "Jonas Weber",
                  owner: daniel, stage: "Negotiation", status: "won", created: -75, entered: -25, close: -20, source: "Partner", closed: -20, reason: ""),
                // Lost
                D(title: "Tidewater Media — ad spend tracker", value: 28_000, org: "Tidewater Media", contact: "Grace Whitfield",
                  owner: me, stage: "Proposal", status: "lost", created: -60, entered: -25, close: -15, source: "Outbound", closed: -15, reason: "Chose a competitor"),
                D(title: "Lumen Energy — field ops dashboards", value: 19_000, org: "Lumen Energy", contact: "Samuel Okonkwo",
                  owner: daniel, stage: "Demo", status: "lost", created: -90, entered: -45, close: -33, source: "Website", closed: -33, reason: "No budget"),
                D(title: "Sora Retail — pricing tool", value: 9_000, org: "Sora Retail Group", contact: "Aiko Tanaka",
                  owner: sofia, stage: "Qualified", status: "lost", created: -80, entered: -60, close: -50, source: "Outbound", closed: -50, reason: "Timing"),
            ]
            p.deals = deals.map { d in
                DealRecord(
                    id: id("deal:\(d.title)"), title: d.title, value: d.value, organization: d.org,
                    contactId: contact(d.contact), owner: d.owner, stageId: stage[d.stage] ?? "", status: d.status,
                    lostReason: d.reason, expectedClose: d.close.map { Days.ms(cal.startOfDay(for: now.addingTimeInterval($0 * 86_400)).addingTimeInterval(12 * 3600)) },
                    source: d.source, stageEnteredAt: ms(d.entered), closedAt: d.closed.map(ms), createdBy: d.owner,
                    createdAt: ms(d.created))
            }
            func deal(_ title: String) -> String { id("deal:\(title)") }

            // Activities: (deal, kind, subject, due day, hour, done days ago, owner, note)
            var n = 0
            func act(
                _ dealTitle: String?, _ kind: String, _ subject: String, due day: Int, hour: Int = 10, doneAgo: Double? = nil,
                owner: String = me, note: String = "", auto: String? = nil
            ) {
                n += 1
                let dealId = dealTitle.map(deal)
                let contactId = dealId.flatMap { did in p.deals.first { $0.id == did }?.contactId }
                p.activities.append(
                    ActivityView(
                        id: id("activity:\(n)"), dealId: dealId, contactId: contactId, kind: kind, subject: subject,
                        dueAt: due(day, hour), done: doneAgo != nil, doneAt: doneAgo.map { ms(-$0) }, owner: owner,
                        note: note, automationId: auto, createdBy: owner, createdAt: ms(Double(min(day, 0)) - 3)))
            }
            let fieldstone = "Fieldstone Coffee — 12-store dashboards"
            let verde = "Verde Foods — supply chain pilot"
            let tidewater = "Tidewater Media — audience analytics"
            let cobalt = "Cobalt Freight — route cost analytics"
            let sora = "Sora Retail — 40-store rollout"
            let brightline = "Brightline Logistics — fleet analytics"
            let alpenrose = "Alpenrose Insurance — claims analytics"
            let northpeak = "Northpeak Health — 3-clinic analytics"
            let kessler = "Kessler Manufacturing — plant floor dashboards"
            let harbor = "Harbor & Vine — group-wide license"
            let meridian = "Meridian Bank — risk reporting"
            let lumen = "Lumen Energy — grid telemetry"

            // Overdue
            act(tidewater, "call", "Intro call with Grace", due: -1, hour: 15)
            act(kessler, "email", "Send revised statement of work", due: -2, owner: daniel)
            act(meridian, "deadline", "Security questionnaire due", due: -1, hour: 17, owner: sofia)
            // Today
            act(sora, "call", "Pricing call with Aiko", due: 0, hour: 16, owner: sofia)
            act(northpeak, "call", "Walk Rachel through the pricing tiers", due: 0, hour: 14,
                note: "She wants the per-clinic breakdown and the multi-year discount.")
            act(nil, "task", "Prep Q4 forecast for Monday's pipeline review", due: 0, hour: 17)
            // Upcoming
            act(fieldstone, "call", "Discovery call with Owen", due: 1, hour: 11,
                note: "12 stores, POS is Square. Wants weekly sales per store and staff scheduling.")
            act(cobalt, "meeting", "Data walkthrough with Priya's team", due: 2, hour: 13,
                note: "Bring the lane-cost sample built from their Q2 export.")
            act(harbor, "meeting", "Final terms with David and legal", due: 2, hour: 15,
                note: "Open points: SSO add-on price, 30-day termination clause.")
            act(verde, "email", "Send pilot scope and timeline", due: 3, owner: daniel)
            act(alpenrose, "meeting", "Technical deep-dive with Lena's team", due: 5, hour: 9, owner: sofia)
            act(northpeak, "email", "Proposal recap and next steps", due: 6, auto: id("automation:proposal"))
            act(harbor, "deadline", "Signature target", due: 6, hour: 17)
            act(nil, "meeting", "Team pipeline review", due: 4, hour: 9)
            // Done
            act(brightline, "call", "Discovery call with Maya and Tomás", due: -3, hour: 15, doneAgo: 2.9,
                note: "Fleet of 340 trucks, telematics from Samsara. Pain: fuel cost per route is a monthly spreadsheet.")
            act(brightline, "meeting", "Live demo: route cost dashboard", due: -1, hour: 11, doneAgo: 0.9,
                note: "Maya loved the idle-time view. Tomás asked about the Snowflake connector.")
            act(northpeak, "email", "Send proposal v2", due: -5, doneAgo: 5)
            act(harbor, "call", "Redlines review with David", due: -4, hour: 16, doneAgo: 4)
            act(cobalt, "call", "Qualification call with Priya", due: -6, hour: 14, doneAgo: 6)
            act(sora, "email", "Send store-rollout case study", due: -8, doneAgo: 8, owner: sofia)
            act(alpenrose, "meeting", "Claims data review", due: -9, doneAgo: 9, owner: sofia)
            act(lumen, "call", "Check in with Samuel", due: -17, doneAgo: 17, owner: daniel)
            act(meridian, "meeting", "Commercial terms workshop", due: -12, doneAgo: 12, owner: sofia)
            act(kessler, "call", "Proposal walkthrough with Jonas", due: -11, doneAgo: 11, owner: daniel)
            act(fieldstone, "email", "Reply to website enquiry", due: -5, doneAgo: 5)
            act(verde, "call", "Expansion intro with Marco", due: -7, doneAgo: 7, owner: daniel)
            act(tidewater, "email", "Conference follow-up", due: -8, doneAgo: 8)

            // Notes
            let notes: [(String, String, String, Double)] = [
                (brightline, me,
                 "Demo landed. Maya wants fuel cost per route and idle time by depot in the first release. Budget is approved for this fiscal year; Tomás owns the data side.", -0.8),
                (brightline, daniel,
                 "Their warehouse pilot renewed without a hitch, so expansion should be an easy yes if the Snowflake connector works.", -2.5),
                (northpeak, me, "Rachel needs board sign-off above $100k. Board meets on the 12th.", -5),
                (harbor, me, "Legal is fine with everything except the termination clause. David will push internally.", -4),
                (meridian, sofia, "Close slipped: their security review added two weeks. Clara is still championing us.", -2),
                (cobalt, me, "Priya's team runs 1,200 lanes. Biggest win is spotting empty backhauls.", -6),
            ]
            p.notes = notes.enumerated().map { i, note in
                NoteView(id: id("note:\(i)"), dealId: deal(note.0), author: note.1, body: note.2, createdAt: ms(note.3))
            }

            p.automations = [
                AutomationView(
                    id: id("automation:proposal"), stageId: stage["Proposal"] ?? "", kind: "email",
                    subject: "Send proposal recap", dueInDays: 1, enabled: true, createdBy: me, createdAt: ms(-60)),
                AutomationView(
                    id: id("automation:qualified"), stageId: stage["Qualified"] ?? "", kind: "call",
                    subject: "Qualification call: budget, timeline, decision maker", dueInDays: 2, enabled: true,
                    createdBy: me, createdAt: ms(-60)),
                AutomationView(
                    id: id("automation:negotiation"), stageId: stage["Negotiation"] ?? "", kind: "task",
                    subject: "Loop in legal for contract review", dueInDays: 1, enabled: false, createdBy: sofia,
                    createdAt: ms(-30)),
            ]
            return p
        }
    }
}
#endif
