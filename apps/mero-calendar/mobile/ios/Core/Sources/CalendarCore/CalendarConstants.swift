// The generated client's types (`CalendarEvent`, `Member`, …) are part of this
// module's surface.
@_exported import CalendarGenerated
import Foundation

/// The names Mero Calendar is known by on the wire.
public enum CalendarConstants {
    /// The registry package and invitation-link slug (`logic/Cargo.toml`,
    /// `app/src/utils/invitation.ts` `APP_SLUG`).
    public static let packageName = "com.calimero.mero-calendar"

    /// The web app's event palette (`app/.../color-picker/colors.ts`), in order.
    public static let palette: [String] = [
        "#3b6fe0", "#2aa775", "#c8472b", "#9b4dca", "#0f7c8c",
        "#d98324", "#c2356f", "#5566c4", "#6b7280", "#1f9e54",
    ]

    /// The color a new event starts with.
    public static let defaultColor = palette[0]

    /// `event_type` of a timed event and of an all-day one (`types/event.ts`).
    public static let timedType = "event"
    public static let allDayType = "long-event"

    /// The first `n` characters of an id with an ellipsis, as the web app's `shortPk`.
    public static func short(_ id: String, _ n: Int = 6) -> String {
        id.count > n + 2 ? String(id.prefix(n)) + "…" : id
    }
}

/// The current time in Unix milliseconds, as the web app's `Date.now()`.
public func nowMillis(_ date: Date = Date()) -> UInt64 {
    UInt64(max(0, (date.timeIntervalSince1970 * 1000).rounded()))
}
