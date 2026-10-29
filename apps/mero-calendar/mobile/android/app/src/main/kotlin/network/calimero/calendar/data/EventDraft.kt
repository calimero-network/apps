package network.calimero.calendar.data

import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId

/**
 * The event sheet's form state (the web app's `ModalFormEvent` values), its validation and its
 * wire form. All-day events run 00:00–23:59 of their days, as on the web.
 */
data class EventDraft(
    val title: String = "",
    val description: String = "",
    val start: LocalDateTime,
    val end: LocalDateTime,
    val allDay: Boolean = false,
    val isPrivate: Boolean = false,
    val color: String = CalendarConstants.DEFAULT_COLOR,
    val peers: List<String> = emptyList(),
) {
    /** What is wrong with the draft, in the sheet's words; null when it can be saved. */
    val error: String?
        get() =
            when {
                title.isBlank() -> "Add a title"
                !effectiveEnd.isAfter(effectiveStart) -> "The event has to end after it starts"
                else -> null
            }

    private val effectiveStart: LocalDateTime get() = if (allDay) start.toLocalDate().atStartOfDay() else start
    private val effectiveEnd: LocalDateTime get() = if (allDay) end.toLocalDate().atTime(LocalTime.of(23, 59)) else end

    /** Move the start, keeping the length (the web's `onSelectStartDate`). */
    fun withStart(newStart: LocalDateTime): EventDraft {
        val length = java.time.Duration.between(start, end)
        return copy(start = newStart, end = newStart.plus(length))
    }

    fun withAllDay(on: Boolean): EventDraft = copy(allDay = on)

    /** Private events have no audience: turning private on drops the invitees. */
    fun withPrivate(on: Boolean): EventDraft = copy(isPrivate = on, peers = if (on) emptyList() else peers)

    fun togglePeer(id: String): EventDraft = copy(peers = if (id in peers) peers - id else peers + id)

    fun fields(zone: ZoneId = ZoneId.systemDefault()): EventFields =
        EventFields(
            title = title.trim(),
            description = description,
            start = EventTime.format(effectiveStart.atZone(zone).toInstant(), zone),
            end = EventTime.format(effectiveEnd.atZone(zone).toInstant(), zone),
            type = if (allDay) CalendarConstants.TYPE_ALL_DAY else CalendarConstants.TYPE_TIMED,
            color = color,
            peers = if (isPrivate) emptyList() else peers,
            isPrivate = isPrivate,
        )

    companion object {
        /** A new event on [day]: the next whole hour today, else 09:00, one hour long. */
        fun newOn(
            day: LocalDate,
            now: LocalDateTime = LocalDateTime.now(),
        ): EventDraft {
            val start =
                if (day == now.toLocalDate() && now.hour < 23) {
                    now.toLocalDate().atTime(now.hour + 1, 0)
                } else {
                    day.atTime(9, 0)
                }
            return EventDraft(start = start, end = start.plusHours(1))
        }

        fun from(
            event: CalEvent,
            zone: ZoneId = ZoneId.systemDefault(),
        ): EventDraft =
            EventDraft(
                title = event.title,
                description = event.description,
                start = LocalDateTime.ofInstant(event.start, zone),
                end = LocalDateTime.ofInstant(event.end, zone),
                allDay = event.allDay,
                isPrivate = event.isPrivate,
                color = event.color,
                peers = event.peers,
            )
    }
}
