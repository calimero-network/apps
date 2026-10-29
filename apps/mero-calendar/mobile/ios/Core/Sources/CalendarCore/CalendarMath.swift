import Foundation

/// The four ways the calendar shows time.
public enum CalendarMode: String, CaseIterable, Identifiable, Sendable {
    case month, week, day, agenda
    public var id: String { rawValue }
    public var title: String {
        switch self {
        case .month: return "Month"
        case .week: return "Week"
        case .day: return "Day"
        case .agenda: return "Agenda"
        }
    }
}

/// Date arithmetic for the views. Weeks start on Monday, as the web app's.
public struct CalendarMath: Sendable {
    public var calendar: Calendar

    public init(timeZone: TimeZone = .current, locale: Locale = .current) {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        calendar.locale = locale
        calendar.firstWeekday = 2
        self.calendar = calendar
    }

    public func startOfDay(_ date: Date) -> Date { calendar.startOfDay(for: date) }

    public func addDays(_ n: Int, to date: Date) -> Date {
        calendar.date(byAdding: .day, value: n, to: date) ?? date
    }

    /// Monday of `date`'s week, at midnight.
    public func startOfWeek(_ date: Date) -> Date {
        let day = startOfDay(date)
        let weekday = calendar.component(.weekday, from: day)  // 1 = Sunday
        let back = (weekday + 5) % 7
        return addDays(-back, to: day)
    }

    public func startOfMonth(_ date: Date) -> Date {
        calendar.date(from: calendar.dateComponents([.year, .month], from: date)) ?? startOfDay(date)
    }

    /// The 42 days (6 weeks) a month grid shows, Monday first.
    public func monthGrid(_ date: Date) -> [Date] {
        let first = startOfWeek(startOfMonth(date))
        return (0..<42).map { addDays($0, to: first) }
    }

    /// The seven days of `date`'s week.
    public func weekDays(_ date: Date) -> [Date] {
        let first = startOfWeek(date)
        return (0..<7).map { addDays($0, to: first) }
    }

    public func isSameDay(_ a: Date, _ b: Date) -> Bool { calendar.isDate(a, inSameDayAs: b) }
    public func isSameMonth(_ a: Date, _ b: Date) -> Bool {
        calendar.isDate(a, equalTo: b, toGranularity: .month)
    }

    /// Move `date` one period back (`-1`) or forward (`+1`) in `mode`.
    public func step(_ date: Date, mode: CalendarMode, by direction: Int) -> Date {
        switch mode {
        case .month:
            return calendar.date(byAdding: .month, value: direction, to: startOfMonth(date)) ?? date
        case .week: return addDays(7 * direction, to: date)
        case .day: return addDays(direction, to: date)
        case .agenda: return addDays(30 * direction, to: date)
        }
    }

    /// The header line for `mode` at `date`: "October 2026", "Oct 26 – Nov 1, 2026",
    /// "Wednesday, Oct 28", "Upcoming".
    public func title(_ date: Date, mode: CalendarMode) -> String {
        let f = DateFormatter()
        f.calendar = calendar
        f.locale = calendar.locale
        f.timeZone = calendar.timeZone
        switch mode {
        case .month:
            f.setLocalizedDateFormatFromTemplate("MMMMyyyy")
            return f.string(from: date)
        case .week:
            let days = weekDays(date)
            let interval = DateIntervalFormatter()
            interval.calendar = calendar
            interval.locale = calendar.locale
            interval.timeZone = calendar.timeZone
            interval.dateTemplate = "MMMdyyyy"
            return interval.string(from: days[0], to: days[6])
        case .day:
            f.setLocalizedDateFormatFromTemplate("EEEEMMMd")
            return f.string(from: date)
        case .agenda:
            return "Upcoming"
        }
    }

    /// The events that touch `day`, all-day first, then by start.
    public func events(_ events: [CalendarItem], on day: Date) -> [CalendarItem] {
        let start = startOfDay(day)
        return events.filter { $0.occurs(on: start, calendar: calendar) }
            .sorted { a, b in
                if a.isAllDay != b.isAllDay { return a.isAllDay }
                return (a.start, a.title) < (b.start, b.title)
            }
    }

    /// Agenda sections: each day from `from` for `days` days that has events.
    public func agenda(_ events: [CalendarItem], from: Date, days: Int = 90) -> [(day: Date, items: [CalendarItem])] {
        let first = startOfDay(from)
        var out: [(day: Date, items: [CalendarItem])] = []
        for offset in 0..<days {
            let day = addDays(offset, to: first)
            let items = self.events(events, on: day)
            if !items.isEmpty { out.append((day, items)) }
        }
        return out
    }

    /// Where timed events sit in a day column: minutes from midnight (clamped to
    /// the day), and side-by-side columns for overlaps, as a calendar app lays
    /// them out.
    public func layout(_ events: [CalendarItem], on day: Date) -> [TimedSlot] {
        let dayStart = startOfDay(day)
        let timed = events.filter { !$0.isAllDay && $0.occurs(on: dayStart, calendar: calendar) }
            .sorted { ($0.start, $0.end) < ($1.start, $1.end) }

        var slots: [TimedSlot] = []
        var cluster: [TimedSlot] = []
        var columnsEnd: [Double] = []
        var clusterEnd: Double = -1

        func flush() {
            let count = max(columnsEnd.count, 1)
            for var slot in cluster {
                slot.columns = count
                slots.append(slot)
            }
            cluster = []
            columnsEnd = []
        }

        for event in timed {
            let startMin = max(0, event.start.timeIntervalSince(dayStart) / 60)
            let endMin = min(24 * 60, max(event.end, event.start).timeIntervalSince(dayStart) / 60)
            let end = max(endMin, startMin + 15)
            if startMin >= clusterEnd, !cluster.isEmpty { flush() }
            let column = columnsEnd.firstIndex { $0 <= startMin } ?? columnsEnd.count
            if column == columnsEnd.count { columnsEnd.append(end) } else { columnsEnd[column] = end }
            cluster.append(TimedSlot(event: event, startMinute: startMin, endMinute: end, column: column, columns: 1))
            clusterEnd = max(clusterEnd, end)
        }
        flush()
        return slots
    }
}

/// One timed event placed in a day column.
public struct TimedSlot: Identifiable, Sendable {
    public var id: String { event.id }
    public let event: CalendarItem
    public let startMinute: Double
    public let endMinute: Double
    public let column: Int
    public var columns: Int
}
