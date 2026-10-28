import Foundation
import MeroKit

/// The Week tab: a week of standups per person, shareable as Markdown (the
/// web's `WeekDigest`).
@MainActor
public final class WeekModel: ObservableObject {
    public let team: TeamModel
    private let now: () -> Date
    private let calendar: Calendar

    @Published public private(set) var start: String
    @Published public private(set) var week: [DayView]?
    @Published public private(set) var isLoading = false
    @Published public var error: String?

    public init(team: TeamModel, now: @escaping () -> Date = Date.init, calendar: Calendar = .current) {
        self.team = team
        self.now = now
        self.calendar = calendar
        self.start = Days.weekStart(Days.today(now(), calendar: calendar), calendar: calendar)
    }

    public var isThisWeek: Bool { start == Days.weekStart(Days.today(now(), calendar: calendar), calendar: calendar) }
    public var range: String { Days.describeWeek(start, calendar: calendar) }
    public var people: [PersonWeek] { week.map(Digest.byPerson) ?? [] }

    public var markdown: String {
        Digest.markdown(teamName: team.teamName, start: start, week: week ?? [], calendar: calendar)
    }

    public func weekday(_ day: String) -> String { Days.weekdayShort(day, calendar: calendar) }

    public func shift(by weeks: Int) async {
        let next = Days.shift(start, by: 7 * weeks, calendar: calendar)
        guard weeks < 0 || !isThisWeek else { return }
        start = next
        week = nil
        await load()
    }

    public func load() async {
        isLoading = true
        defer { isLoading = false }
        let start = start
        do {
            let week = try await team.client.getWeek(start: start)
            guard start == self.start else { return }
            self.week = week
            error = nil
        } catch {
            self.error = ErrorText.describe(error)
        }
    }
}
