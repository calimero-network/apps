#if DEBUG
import CalendarCore
import Foundation
import MeroKit

/// Mero Calendar's demo: three teams, their calendars and members, and a
/// design studio's real-looking month of meetings, client work and time off,
/// placed around today. The contract answers `get_events`, `get_members`,
/// `create_event`, ... from them in the wire shape the generated client
/// decodes (owner and peers as 64-hex `UserId`s, times as the web app's
/// `Date.toString()`). Writes change the fixtures, so the tour can add events.
enum CalendarDemo {
    static let meName = "Sofia Marino"
    static let me = person(meName)
    static let applicationId = DemoIds.hex("app:mero-calendar")

    static let atlas = "Atlas Design Studio"
    static let runners = "Harbor Street Runners"
    static let family = "Marino Family"

    static let teams: [(name: String, members: Int, calendars: [String], people: [String])] = [
        (
            atlas, 6, ["Studio schedule", "Client launches", "Out of office", "Hiring loop"],
            [meName, "Daniel Okafor", "Priya Raman", "Lucas Ferreira", "Hannah Becker", "Kenji Watanabe"]
        ),
        (runners, 4, ["Group runs", "Races"], [meName, "Tom Gallagher", "Aisha Bello", "Marta Nowak"]),
        (family, 4, ["Family"], [meName, "Marco Marino", "Elena Marino", "Luca Marino"]),
    ]

    static func team(_ name: String) -> String { DemoIds.hex("team:\(name)") }
    static func context(_ team: String, _ calendar: String) -> String { DemoIds.hex("context:\(team)/\(calendar)") }
    static func person(_ name: String) -> String { DemoIds.hex("person:\(name)") }

    static func makeBackend() -> DemoBackend {
        let now = Date()
        let names = NameBook(store: DefaultsStore())
        var namespaces: [AppNamespace] = []
        var subgroups: [String: [AppSubgroup]] = [:]
        var members = Set<String>()
        for team in teams {
            let teamId = self.team(team.name)
            namespaces.append(
                AppNamespace(id: teamId, name: team.name, applicationId: applicationId, memberCount: team.members))
            subgroups[teamId] = team.calendars.map { calendar in
                let id = context(team.name, calendar)
                // The name this account goes by in each calendar, so no name prompt.
                names.setUsername(meName, context: id)
                // "Hiring loop" is one the demo account has not opened yet (opening joins it).
                if calendar != "Hiring loop" { members.insert(id) }
                return AppSubgroup(groupId: DemoIds.hex("group:\(team.name)/\(calendar)"), name: calendar, contextIds: [id])
            }
        }
        seedPrivateEvents(now: now)
        let store = Store(now: now)
        return DemoBackend(
            account: me, applicationId: applicationId, namespaces: namespaces, subgroups: subgroups,
            members: members, handler: { try store.handle($0) })
    }

    /// The studio calendar's private (device-only) events, reset on every launch.
    private static func seedPrivateEvents(now: Date) {
        let defaults = DefaultsStore()
        let privateStore = PrivateEventStore(store: defaults)
        for team in teams {
            defaults.set(nil, for: PrivateEventStore.key(account: me, namespaceId: self.team(team.name)))
        }
        let key = PrivateEventStore.key(account: me, namespaceId: team(atlas))
        let studio = context(atlas, "Studio schedule")
        for (day, time, minutes, title, color) in [
            (2, "08:00", 45, "Physio appointment", 8), (7, "18:30", 60, "Pick up Luca from football", 5),
        ] {
            let start = at(day, time, now)
            privateStore.add(
                key: key, contextId: studio,
                event: CalendarItem(
                    id: "", title: title, owner: me, start: start, end: start.addingTimeInterval(Double(minutes) * 60),
                    color: CalendarConstants.palette[color], isPrivate: true))
        }
    }

    /// `days` from today at `time` ("HH:mm"), local time.
    static func at(_ days: Int, _ time: String, _ now: Date) -> Date {
        let cal = Calendar.current
        let parts = time.split(separator: ":").compactMap { Int($0) }
        let day = cal.date(byAdding: .day, value: days, to: cal.startOfDay(for: now)) ?? now
        return cal.date(bySettingHour: parts[0], minute: parts[1], second: 0, of: day) ?? day
    }

    // MARK: Wire shapes

    /// `get_events`' row as the contract sends it: `owner` and `peers` are
    /// 64-hex `UserId`s (`HexIdTransport` turns them into the generated
    /// `CalendarEvent`'s byte arrays). Keys are `CalendarEvent`'s.
    struct WireEvent: Codable {
        var id: String
        var title: String
        var description: String
        var owner: String
        var start: String
        var end: String
        var eventType: String
        var color: String
        var peers: [String]
        var `private`: Bool

        enum CodingKeys: String, CodingKey {
            case id, title, description, owner, start, end, color, peers, `private`
            case eventType = "event_type"
        }
    }

    // MARK: State

    final class Store: @unchecked Sendable {
        private let lock = NSLock()
        private var events: [String: [WireEvent]] = [:]
        private var members: [String: [Member]] = [:]
        private var next = 0

        init(now: Date) {
            for team in CalendarDemo.teams {
                for calendar in team.calendars {
                    let id = CalendarDemo.context(team.name, calendar)
                    members[id] = team.people.enumerated().map { index, name in
                        let joined = UInt64(now.addingTimeInterval(-Double(index + 3) * 86_400 * 9).timeIntervalSince1970 * 1000)
                        return Member(id: CalendarDemo.person(name), username: name, joinedAt: joined, usernameUpdatedAt: joined)
                    }
                    events[id] = Seed.events(team: team.name, calendar: calendar, now: now)
                }
            }
        }

        func handle(_ call: DemoCall) throws -> Data {
            lock.lock()
            defer { lock.unlock() }
            let context = call.contextId
            switch call.method {
            case "get_events":
                return try DemoReply.json(events[context] ?? [])
            case "get_private_events":
                return try DemoReply.json([WireEvent]())
            case "get_members":
                return try DemoReply.json(members[context] ?? [])
            case "create_event", "create_private_event":
                let data = call.args["event_data"] as? [String: Any] ?? [:]
                next += 1
                let id = DemoIds.hex("event:created:\(next):\(Date().timeIntervalSince1970)")
                events[context, default: []].append(
                    WireEvent(
                        id: id, title: data["title"] as? String ?? "", description: data["description"] as? String ?? "",
                        owner: CalendarDemo.me, start: data["start"] as? String ?? "", end: data["end"] as? String ?? "",
                        eventType: data["event_type"] as? String ?? CalendarConstants.timedType,
                        color: data["color"] as? String ?? CalendarConstants.defaultColor,
                        peers: data["peers"] as? [String] ?? [], private: call.method == "create_private_event"))
                return try DemoReply.json(id)
            case "update_event", "update_private_event":
                let id = call.string("event_id") ?? ""
                let data = call.args["event_data"] as? [String: Any] ?? [:]
                guard let i = events[context]?.firstIndex(where: { $0.id == id }) else {
                    throw DemoContractError("Event not found")
                }
                var event = events[context]![i]
                if let v = data["title"] as? String { event.title = v }
                if let v = data["description"] as? String { event.description = v }
                if let v = data["start"] as? String { event.start = v }
                if let v = data["end"] as? String { event.end = v }
                if let v = data["event_type"] as? String { event.eventType = v }
                if let v = data["color"] as? String { event.color = v }
                if let v = data["peers"] as? [String] { event.peers = v }
                events[context]![i] = event
                return try DemoReply.json(id)
            case "delete_event", "delete_private_event":
                let id = call.string("event_id") ?? ""
                events[context]?.removeAll { $0.id == id }
                return try DemoReply.json(id)
            case "set_username":
                let name = call.string("username") ?? ""
                let stamp = nowMillis()
                if let i = members[context]?.firstIndex(where: { $0.id == CalendarDemo.me }) {
                    members[context]![i].username = name
                    members[context]![i].usernameUpdatedAt = stamp
                } else {
                    members[context, default: []].append(
                        Member(id: CalendarDemo.me, username: name, joinedAt: stamp, usernameUpdatedAt: stamp))
                }
            default:
                break
            }
            return DemoReply.null
        }
    }

    // MARK: Seed

    enum Seed {
        /// One fixture event: `day` from today, start "HH:mm" (ignored for all-day),
        /// length in minutes (days for all-day), owner and invitees by first name.
        struct Row {
            var day: Int
            var time: String
            var length: Int
            var title: String
            var owner: String
            var color: Int
            var peers: [String] = []
            var note: String = ""
            var allDay = false
        }

        static func row(
            _ day: Int, _ time: String, _ length: Int, _ title: String, _ owner: String, _ color: Int,
            _ peers: [String] = [], _ note: String = ""
        ) -> Row {
            Row(day: day, time: time, length: length, title: title, owner: owner, color: color, peers: peers, note: note)
        }

        static func allDay(_ day: Int, _ days: Int, _ title: String, _ owner: String, _ color: Int, _ peers: [String] = [], _ note: String = "") -> Row {
            Row(day: day, time: "00:00", length: days, title: title, owner: owner, color: color, peers: peers, note: note, allDay: true)
        }

        static func events(team: String, calendar: String, now: Date) -> [WireEvent] {
            let people = CalendarDemo.teams.first { $0.name == team }?.people ?? []
            func full(_ first: String) -> String {
                first == "me" ? CalendarDemo.meName : people.first { $0.hasPrefix(first + " ") } ?? first
            }
            let rows: [Row]
            switch (team, calendar) {
            case (CalendarDemo.atlas, "Studio schedule"): rows = studio(now: now)
            case (CalendarDemo.atlas, "Client launches"): rows = launches
            case (CalendarDemo.atlas, "Out of office"): rows = outOfOffice
            case (CalendarDemo.atlas, "Hiring loop"): rows = hiring
            case (CalendarDemo.runners, "Group runs"): rows = runs(now: now)
            case (CalendarDemo.runners, "Races"): rows = races
            default: rows = familyRows
            }
            return rows.enumerated().map { index, row in
                let start = row.allDay ? CalendarDemo.at(row.day, "00:00", now) : CalendarDemo.at(row.day, row.time, now)
                let end =
                    row.allDay
                    ? CalendarDemo.at(row.day + row.length - 1, "23:59", now)
                    : start.addingTimeInterval(Double(row.length) * 60)
                let others = row.peers == ["all"] ? people.filter { $0 != full(row.owner) } : row.peers.map(full)
                return WireEvent(
                    id: DemoIds.hex("event:\(team)/\(calendar)/\(index)/\(row.title)"), title: row.title,
                    description: row.note, owner: CalendarDemo.person(full(row.owner)), start: EventTime.format(start),
                    end: EventTime.format(end),
                    eventType: row.allDay ? CalendarConstants.allDayType : CalendarConstants.timedType,
                    color: CalendarConstants.palette[row.color % CalendarConstants.palette.count],
                    peers: others.filter { $0 != full(row.owner) }.map(CalendarDemo.person), private: false)
            }
        }

        // Palette: 0 blue, 1 green, 2 red, 3 purple, 4 teal, 5 orange, 6 pink, 7 indigo, 8 gray, 9 green.

        static func studio(now: Date) -> [Row] {
            var rows: [Row] = [
                allDay(-18, 2, "Q4 roadmap offsite", "Daniel", 3, ["all"], "Quinta da Regaleira, Sintra. Bus leaves the studio at 8:15."),
                row(-14, "10:00", 90, "Halden Bikes kickoff", "Daniel", 0, ["me", "Lucas", "Priya"]),
                row(-11, "13:00", 180, "Portfolio shoot", "Lucas", 5, ["me", "Kenji"], "Studio B, bring the printed packaging samples."),
                row(-9, "14:00", 60, "Accessibility audit readout", "Priya", 4, ["all"]),
                row(-7, "11:00", 60, "Nordlicht Coffee: packaging round 1", "Daniel", 2, ["me", "Priya"]),
                row(-5, "12:30", 90, "Team lunch at Taberna", "Hannah", 1, ["all"]),
                row(-3, "16:00", 45, "Retro: sprint 41", "Hannah", 7, ["all"]),
                row(-2, "15:00", 60, "Type specimen review", "Kenji", 6, ["me", "Lucas"]),
                row(-1, "10:30", 60, "Client demo: Halden Bikes", "Daniel", 0, ["me", "Lucas"]),
                // Today.
                row(0, "11:00", 60, "Design critique: checkout flow", "Priya", 4, ["me", "Lucas", "Kenji"],
                    "Walk through the new one-page checkout. Figma link in #design-crit. Bring two things you'd cut."),
                row(0, "12:30", 60, "Lunch with Lucas", "me", 1, ["Lucas"]),
                row(0, "15:00", 45, "Nordlicht Coffee: label review", "Daniel", 2, ["me", "Priya"],
                    "Final pass on the single-origin labels before they go to print."),
                row(0, "16:30", 60, "Prep slides for sprint planning", "me", 5),
                // Tomorrow: the busy day.
                allDay(1, 3, "Kenji at Config conference", "Kenji", 6),
                row(1, "10:00", 90, "Sprint 42 planning", "Hannah", 3, ["all"]),
                row(1, "13:00", 120, "Brand workshop: Halden Bikes", "Daniel", 0, ["me", "Lucas", "Priya"],
                    "Half-day workshop with their marketing team. Moodboards on the wall by 12:45."),
                row(1, "14:00", 30, "1:1 Sofia / Daniel", "Daniel", 7, ["me"]),
                row(1, "16:30", 30, "Ship v2.3 to TestFlight", "me", 9, ["Kenji", "Lucas"]),
                row(2, "10:00", 180, "Usability sessions (3)", "Priya", 4, ["me", "Hannah"], "Participants booked through Respondent. Observer room is the library."),
                row(2, "14:30", 45, "Onboarding v2: copy pass", "Hannah", 8, ["me"]),
                row(3, "11:30", 30, "Invoice check-in", "Hannah", 8, ["Daniel"]),
                row(3, "18:00", 120, "Studio drinks", "Lucas", 5, ["all"], "Rooftop if it's dry, otherwise the back room at Musa."),
                allDay(5, 1, "Nordlicht Coffee: final artwork due", "Daniel", 2, ["me", "Priya"]),
                row(6, "10:00", 60, "Onboarding v2 kickoff", "me", 0, ["Priya", "Kenji", "Hannah"]),
                row(8, "14:00", 60, "Halden Bikes: website review", "Daniel", 0, ["me", "Lucas"]),
                row(10, "16:00", 60, "Quarterly all-hands", "Daniel", 3, ["all"]),
                allDay(13, 1, "Portfolio site launch", "Lucas", 1, ["all"]),
                row(15, "15:00", 60, "Design system office hours", "Kenji", 6, ["all"]),
                row(19, "15:00", 60, "Sprint 42 demo", "Hannah", 3, ["all"]),
                allDay(22, 3, "Lisbon client trip", "Daniel", 5, ["me"], "Flights TP1347 / TP1350. Hotel: Lumiares."),
                row(27, "11:00", 60, "Annual review: Sofia", "Daniel", 8, ["me"]),
                row(33, "19:00", 180, "Studio holiday party", "Hannah", 1, ["all"]),
            ]
            // Standup on Mondays, Wednesdays and Fridays.
            let cal = Calendar.current
            for day in -24...40 {
                let date = cal.date(byAdding: .day, value: day, to: cal.startOfDay(for: now)) ?? now
                if [2, 4, 6].contains(cal.component(.weekday, from: date)) {
                    rows.append(row(day, "09:30", 15, "Studio standup", "Hannah", 8, ["all"]))
                }
            }
            return rows
        }

        static let launches: [Row] = [
            allDay(-6, 1, "Halden Bikes: spring catalogue live", "Daniel", 0, ["all"]),
            allDay(5, 1, "Nordlicht Coffee: labels to print", "Daniel", 2, ["me", "Priya"]),
            allDay(13, 1, "Portfolio site launch", "Lucas", 1, ["all"]),
            allDay(24, 1, "Halden Bikes: website go-live", "Daniel", 0, ["all"]),
        ]

        static let outOfOffice: [Row] = [
            allDay(1, 3, "Kenji: Config conference", "Kenji", 6),
            allDay(9, 2, "Priya: long weekend", "Priya", 4),
            allDay(16, 5, "Lucas: Azores", "Lucas", 5),
            allDay(30, 2, "Hannah: moving flat", "Hannah", 8),
        ]

        static let hiring: [Row] = [
            row(2, "16:00", 45, "Portfolio review: product designer", "Hannah", 7, ["me", "Priya"]),
            row(4, "11:00", 60, "Final round: senior illustrator", "Daniel", 7, ["me", "Lucas"]),
        ]

        static func runs(now: Date) -> [Row] {
            var rows: [Row] = []
            let cal = Calendar.current
            for day in -20...40 {
                let date = cal.date(byAdding: .day, value: day, to: cal.startOfDay(for: now)) ?? now
                switch cal.component(.weekday, from: date) {
                case 3: rows.append(row(day, "07:00", 60, "Riverside tempo, 8 km", "Tom", 1, ["all"]))
                case 7: rows.append(row(day, "08:30", 120, "Long run: Monsanto loop", "Aisha", 4, ["all"]))
                default: break
                }
            }
            return rows
        }

        static let races: [Row] = [
            allDay(18, 1, "Lisbon Half Marathon", "Marta", 2, ["all"], "Bib pickup the day before at FIL."),
            allDay(39, 1, "São Silvestre 10K", "Tom", 5, ["all"]),
        ]

        static let familyRows: [Row] = [
            row(1, "19:30", 120, "Dinner at Nonna's", "Elena", 1, ["all"]),
            allDay(4, 1, "Luca: school trip to Óbidos", "Marco", 5, ["me"]),
            row(9, "10:00", 60, "Car service", "Marco", 8),
            allDay(20, 1, "Elena's birthday", "Marco", 6, ["all"]),
        ]
    }
}
#endif
