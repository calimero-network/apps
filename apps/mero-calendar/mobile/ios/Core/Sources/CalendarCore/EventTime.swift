import Foundation

/// An event's `start` / `end` strings as the web app writes and reads them.
///
/// The web app stores `Date.prototype.toString()`
/// (`Wed Oct 28 2026 10:00:00 GMT+0100 (Central European Standard Time)`) and
/// reads it back with `new Date(…)`. The phone writes the same form, so an
/// event made here opens on the web and the other way round, and reads that
/// form plus ISO-8601 (what a hand-made or older event may carry).
public enum EventTime {
    private static let jsFormat = "EEE MMM dd yyyy HH:mm:ss 'GMT'Z"

    /// `date` as JavaScript's `Date.toString()` in `timeZone`.
    public static func format(_ date: Date, timeZone: TimeZone = .current) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = timeZone
        formatter.dateFormat = jsFormat
        let zoneName =
            timeZone.localizedName(
                for: timeZone.isDaylightSavingTime(for: date) ? .daylightSaving : .standard,
                locale: Locale(identifier: "en_US")) ?? timeZone.identifier
        return "\(formatter.string(from: date)) (\(zoneName))"
    }

    /// Read a `start` / `end` string; `nil` when it is neither form.
    public static func parse(_ raw: String) -> Date? {
        var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { return nil }
        if let paren = text.firstIndex(of: "(") {
            text = String(text[..<paren]).trimmingCharacters(in: .whitespaces)
        }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = jsFormat
        if let date = formatter.date(from: text) { return date }

        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = iso.date(from: text) { return date }
        iso.formatOptions = [.withInternetDateTime]
        if let date = iso.date(from: text) { return date }

        // `2026-10-28T10:00` / `2026-10-28`: local time, as `new Date` reads a date-time without a zone.
        for format in ["yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd'T'HH:mm", "yyyy-MM-dd"] {
            formatter.dateFormat = format
            formatter.timeZone = .current
            if let date = formatter.date(from: text) { return date }
        }
        return nil
    }
}
