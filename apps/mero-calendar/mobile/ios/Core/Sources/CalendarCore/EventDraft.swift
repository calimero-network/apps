import Foundation

/// The event form's state: what the create / edit sheet edits, and the rules
/// the web app's `ModalFormEvent` applies to it.
public struct EventDraft: Equatable, Sendable {
    /// The event being edited, `nil` for a new one.
    public var original: CalendarItem?
    public var title: String
    public var description: String
    public var start: Date
    public var end: Date
    public var isAllDay: Bool
    public var isPrivate: Bool
    public var color: String
    public var peers: [String]

    /// A new event on `day`: the next whole hour when `day` is today, else
    /// 09:00, one hour long.
    public static func new(on day: Date, now: Date = Date(), math: CalendarMath = CalendarMath()) -> EventDraft {
        let cal = math.calendar
        var start: Date
        if math.isSameDay(day, now) {
            let hour = cal.component(.hour, from: now)
            start = cal.date(bySettingHour: min(hour + 1, 23), minute: 0, second: 0, of: now) ?? now
        } else {
            start = cal.date(bySettingHour: 9, minute: 0, second: 0, of: day) ?? day
        }
        start = max(start, math.startOfDay(day))
        let end = cal.date(byAdding: .hour, value: 1, to: start) ?? start
        return EventDraft(
            original: nil, title: "", description: "", start: start, end: end, isAllDay: false, isPrivate: false,
            color: CalendarConstants.defaultColor, peers: [])
    }

    /// The draft for editing `event`.
    public static func editing(_ event: CalendarItem) -> EventDraft {
        EventDraft(
            original: event, title: event.title, description: event.description, start: event.start,
            end: event.end, isAllDay: event.isAllDay, isPrivate: event.isPrivate, color: event.color,
            peers: event.peers)
    }

    public var isNew: Bool { original == nil }

    /// A shared event can't become private again: it is already replicated
    /// to every member (the contract's `update_event` note).
    public var canTogglePrivate: Bool { original == nil || original?.isPrivate == true }

    /// Why the draft can't be saved yet, or `nil`.
    public func problem(math: CalendarMath = CalendarMath()) -> String? {
        if title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return "Add a title" }
        let (s, e) = normalisedTimes(math: math)
        if e <= s { return "The event has to end after it starts" }
        return nil
    }

    /// Move the start, keeping the length (as the web form does).
    public mutating func setStart(_ date: Date) {
        let length = end.timeIntervalSince(start)
        start = date
        end = date.addingTimeInterval(max(length, isAllDay ? 0 : 15 * 60))
    }

    public mutating func setPrivate(_ value: Bool) {
        guard canTogglePrivate else { return }
        isPrivate = value
        if value { peers = [] }
    }

    public mutating func togglePeer(_ id: String) {
        if let index = peers.firstIndex(of: id) { peers.remove(at: index) } else { peers.append(id) }
    }

    /// All-day events run 00:00 to 23:59 of their days (`onToggleIsLongEvent`).
    func normalisedTimes(math: CalendarMath) -> (Date, Date) {
        guard isAllDay else { return (start, end) }
        let cal = math.calendar
        let s = math.startOfDay(start)
        let e = cal.date(bySettingHour: 23, minute: 59, second: 0, of: math.startOfDay(end)) ?? end
        return (s, e)
    }

    /// The event to save, owned by `owner`.
    public func item(owner: String, math: CalendarMath = CalendarMath()) -> CalendarItem {
        let (s, e) = normalisedTimes(math: math)
        return CalendarItem(
            id: original?.id ?? "", title: title.trimmingCharacters(in: .whitespacesAndNewlines),
            description: description, owner: original?.owner ?? owner.lowercased(), start: s, end: e,
            isAllDay: isAllDay, color: color, peers: isPrivate ? [] : peers, isPrivate: isPrivate)
    }
}
