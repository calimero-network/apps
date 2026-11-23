import Foundation

/// Standup days, as the contract keys them: `YYYY-MM-DD`, the member's LOCAL
/// date (the web app's `lib/days.ts`). The contract cannot know a time zone, so
/// "today" is decided on the phone.
public enum Days {
    /// `date` as `YYYY-MM-DD` in `calendar`'s time zone.
    public static func dayOf(_ date: Date, calendar: Calendar = .current) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    /// Today, locally.
    public static func today(_ now: Date = Date(), calendar: Calendar = .current) -> String {
        dayOf(now, calendar: calendar)
    }

    /// Local noon on `day`, or nil when it is not a real date. Noon, so a DST
    /// shift never moves it onto a neighbouring day.
    public static func parse(_ day: String, calendar: Calendar = .current) -> Date? {
        let bits = day.split(separator: "-", omittingEmptySubsequences: false)
        guard bits.count == 3, bits[0].count == 4, bits[1].count == 2, bits[2].count == 2,
            let y = Int(bits[0]), let m = Int(bits[1]), let d = Int(bits[2])
        else { return nil }
        var parts = DateComponents()
        parts.year = y
        parts.month = m
        parts.day = d
        parts.hour = 12
        guard let date = calendar.date(from: parts) else { return nil }
        let back = calendar.dateComponents([.year, .month, .day], from: date)
        return back.year == y && back.month == m && back.day == d ? date : nil
    }

    /// `day` moved by `delta` days; `day` unchanged when it is not a date.
    public static func shift(_ day: String, by delta: Int, calendar: Calendar = .current) -> String {
        guard let date = parse(day, calendar: calendar),
            let moved = calendar.date(byAdding: .day, value: delta, to: date)
        else { return day }
        return dayOf(moved, calendar: calendar)
    }

    /// "Today", "Yesterday", "Tomorrow", or a short weekday and date.
    public static func describe(_ day: String, now: Date = Date(), calendar: Calendar = .current) -> String {
        let t = today(now, calendar: calendar)
        if day == t { return "Today" }
        if day == shift(t, by: -1, calendar: calendar) { return "Yesterday" }
        if day == shift(t, by: 1, calendar: calendar) { return "Tomorrow" }
        guard let date = parse(day, calendar: calendar) else { return day }
        let sameYear = calendar.component(.year, from: date) == calendar.component(.year, from: now)
        return format(date, template: sameYear ? "EEEMMMd" : "EEEMMMdyyyy", calendar: calendar)
    }

    /// A contract timestamp (nanoseconds) as a Date.
    public static func date(nanos: UInt64) -> Date {
        Date(timeIntervalSince1970: Double(nanos / 1_000_000) / 1000)
    }

    /// "just now", "5m ago", "3h ago", "yesterday", or a short date.
    public static func relative(nanos: UInt64, now: Date = Date(), calendar: Calendar = .current) -> String {
        guard nanos > 0 else { return "" }
        let then = date(nanos: nanos)
        let seconds = Int((now.timeIntervalSince(then)).rounded())
        if seconds < 45 { return "just now" }
        let minutes = Int((Double(seconds) / 60).rounded())
        if minutes < 60 { return "\(minutes)m ago" }
        let hours = Int((Double(minutes) / 60).rounded())
        if dayOf(then, calendar: calendar) == dayOf(now, calendar: calendar), hours < 24 { return "\(hours)h ago" }
        if dayOf(then, calendar: calendar) == shift(dayOf(now, calendar: calendar), by: -1, calendar: calendar) {
            return "yesterday"
        }
        let sameYear = calendar.component(.year, from: then) == calendar.component(.year, from: now)
        return format(then, template: sameYear ? "MMMd" : "MMMdyyyy", calendar: calendar)
    }

    /// The Monday of `day`'s week. Standup weeks start on Monday.
    public static func weekStart(_ day: String, calendar: Calendar = .current) -> String {
        guard let date = parse(day, calendar: calendar) else { return day }
        let weekday = calendar.component(.weekday, from: date)  // Sun=1 … Sat=7
        let offset = (weekday + 5) % 7  // Mon=0 … Sun=6
        return shift(day, by: -offset, calendar: calendar)
    }

    /// The seven days from `start`.
    public static func weekDays(_ start: String, calendar: Calendar = .current) -> [String] {
        (0..<7).map { shift(start, by: $0, calendar: calendar) }
    }

    /// "Mon", "Tue", … for a day.
    public static func weekdayShort(_ day: String, calendar: Calendar = .current) -> String {
        guard let date = parse(day, calendar: calendar) else { return day }
        return format(date, template: "EEE", calendar: calendar)
    }

    /// The day of the month, "28".
    public static func dayNumber(_ day: String) -> String {
        String(Int(day.suffix(2)) ?? 0)
    }

    /// "Oct 12 – 18", or across months "Oct 27 – Nov 2".
    public static func describeWeek(_ start: String, calendar: Calendar = .current) -> String {
        guard let a = parse(start, calendar: calendar), let b = parse(shift(start, by: 6, calendar: calendar), calendar: calendar)
        else { return start }
        let left = format(a, template: "MMMd", calendar: calendar)
        let right =
            calendar.component(.month, from: a) == calendar.component(.month, from: b)
            ? String(calendar.component(.day, from: b)) : format(b, template: "MMMd", calendar: calendar)
        return "\(left) – \(right)"
    }

    /// "October 2026", for the decision timeline.
    public static func monthTitle(nanos: UInt64, calendar: Calendar = .current) -> String {
        format(date(nanos: nanos), template: "MMMMyyyy", calendar: calendar)
    }

    /// "Oct 12", for a timeline entry.
    public static func shortDate(nanos: UInt64, calendar: Calendar = .current) -> String {
        format(date(nanos: nanos), template: "MMMd", calendar: calendar)
    }

    static func format(_ date: Date, template: String, calendar: Calendar) -> String {
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.locale = calendar.locale ?? .current
        formatter.setLocalizedDateFormatFromTemplate(template)
        return formatter.string(from: date)
    }
}
