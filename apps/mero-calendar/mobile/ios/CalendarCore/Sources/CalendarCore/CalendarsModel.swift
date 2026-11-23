import Foundation
import MeroKit

#if canImport(Combine)
import Combine
#endif

/// The calendars in one team, creating one, and opening one (which joins it).
/// (`app/src/pages/teams/TeamCalendarsPage.tsx`.)
@MainActor
public final class CalendarsModel: ObservableObject {
    @Published public private(set) var calendars: [TeamCalendar] = []
    @Published public private(set) var isLoading = false
    @Published public private(set) var hasLoaded = false
    @Published public private(set) var opening: String?
    @Published public var error: String?

    public let backend: any MeroAppBackend
    public let team: Team
    public let names: NameBook
    /// The team was joined in this session: a refused calendar join is
    /// retried for longer while the calendar syncs (`api/joinCalendar.ts`).
    public let justJoined: Bool
    /// How long to keep retrying a refused join, and how often.
    public var joinWindow: Duration
    public var joinRetry: Duration = .seconds(3)

    public init(backend: any MeroAppBackend, team: Team, names: NameBook, justJoined: Bool = false) {
        self.backend = backend
        self.team = team
        self.names = names
        self.justJoined = justJoined
        self.joinWindow = justJoined ? .seconds(90) : .seconds(20)
    }

    /// The team's calendars: the context in each subgroup, and any straight in the team.
    public func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            var found: [TeamCalendar] = []
            var seen = Set<String>()
            for subgroup in try await backend.listSubgroups(namespaceId: team.id) {
                for contextId in subgroup.contextIds where seen.insert(contextId).inserted {
                    found.append(
                        TeamCalendar(
                            id: contextId, name: label(contextId, subgroup.name), groupId: subgroup.groupId))
                }
            }
            let root = (try? await backend.listContexts(groupId: team.id)) ?? []
            for contextId in root where seen.insert(contextId).inserted {
                found.append(TeamCalendar(id: contextId, name: label(contextId, nil), groupId: team.id))
            }
            calendars = found
            error = nil
        } catch {
            self.error = ErrorText.describe(error, doing: "load this team's calendars")
        }
        hasLoaded = true
    }

    /// Create a calendar: an open subgroup with the calendar's context in it,
    /// as the web app does. Returns it, joined.
    @discardableResult
    public func create(name raw: String) async throws -> TeamCalendar {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let name = String((trimmed.isEmpty ? team.name : trimmed).prefix(64))
        let applicationId = team.applicationId
        guard !applicationId.isEmpty else { throw CalendarError.noApplication }
        let group = try await backend.createSubgroup(namespaceId: team.id, name: name, isPublic: true)
        let contextId = try await backend.createContext(
            groupId: group, applicationId: applicationId, name: name, initArgs: .object([:]))
        names.setCalendarName(name, for: contextId)
        let calendar = TeamCalendar(id: contextId, name: name, groupId: group)
        if !calendars.contains(where: { $0.id == contextId }) { calendars.append(calendar) }
        if (try? await backend.isMember(contextId: contextId)) != true {
            try? await backend.joinContext(contextId: contextId)
        }
        return calendar
    }

    /// Join `calendar` if this account is not in it yet, retrying a refused
    /// join (right after a team join the calendar may not have synced).
    public func open(_ calendar: TeamCalendar) async throws {
        opening = calendar.id
        defer { opening = nil }
        if (try? await backend.isMember(contextId: calendar.id)) == true { return }
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: joinWindow)
        while true {
            do {
                try await backend.joinContext(contextId: calendar.id)
                return
            } catch {
                if Task.isCancelled || clock.now >= deadline { throw error }
            }
            try await Task.sleep(for: joinRetry)
        }
    }

    func label(_ contextId: String, _ server: String?) -> String {
        if let server = server?.trimmingCharacters(in: .whitespaces), !server.isEmpty { return server }
        return names.calendarName(contextId) ?? "Calendar \(contextId.prefix(6))"
    }
}
