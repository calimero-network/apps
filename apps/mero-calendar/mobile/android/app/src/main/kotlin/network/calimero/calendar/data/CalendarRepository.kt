package network.calimero.calendar.data

import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import network.calimero.calendar.contract.CalendarClient
import network.calimero.calendar.contract.CreateCalendarEvent
import network.calimero.calendar.contract.UpdateCalendarEvent
import network.calimero.calendar.contract.CalendarEvent as WireEvent

/**
 * One calendar (an app instance) through its typed contract client: the phone's copy of the web
 * app's `api/calendar.ts` adapter (iOS `CalendarRepository`).
 *
 * Private events live in the contract too: per-owner rows only the owner's own calls read
 * (`getPrivateEvents`), so they follow the account to every device.
 *
 * - a private event goes to `createPrivateEvent`; anything else to `createEvent`, which the
 *   contract keeps private when no one is invited;
 * - a private event is saved with `updatePrivateEvent`, which promotes it to a shared one when the
 *   edit invites someone; a shared one with `updateEvent` (sharing is one way).
 */
class CalendarRepository(
    private val client: CalendarClient,
) {
    suspend fun events(): List<CalEvent> =
        coroutineScope {
            val shared = async { client.getEvents() }
            val mine = async { client.getPrivateEvents() }
            val all = shared.await().mapNotNull { toEvent(it, it.private) } + mine.await().mapNotNull { toEvent(it, true) }
            all.distinctBy { it.id }.sortedWith(compareBy({ it.start }, { it.title }))
        }

    suspend fun members(): List<CalMember> = client.getMembers().map { CalMember(it.id, it.username.trim()) }

    suspend fun create(fields: EventFields): String {
        val data =
            CreateCalendarEvent(
                title = fields.title,
                description = fields.description,
                start = fields.start,
                end = fields.end,
                eventType = fields.type,
                color = fields.color,
                peers = if (fields.isPrivate) emptyList() else fields.peers,
            )
        return if (fields.isPrivate) client.createPrivateEvent(data) else client.createEvent(data)
    }

    suspend fun update(
        event: CalEvent,
        fields: EventFields,
    ): String {
        val patch =
            UpdateCalendarEvent(
                title = fields.title,
                description = fields.description,
                start = fields.start,
                end = fields.end,
                eventType = fields.type,
                color = fields.color,
                peers = if (fields.isPrivate) emptyList() else fields.peers,
            )
        return if (event.isPrivate) client.updatePrivateEvent(event.id, patch) else client.updateEvent(event.id, patch)
    }

    suspend fun delete(event: CalEvent) {
        if (event.isPrivate) client.deletePrivateEvent(event.id) else client.deleteEvent(event.id)
    }

    suspend fun setUsername(name: String) = client.setUsername(name)

    private fun toEvent(
        wire: WireEvent,
        isPrivate: Boolean,
    ): CalEvent? {
        val start = EventTime.parse(wire.start) ?: return null
        val end = EventTime.parse(wire.end) ?: start
        return CalEvent(
            id = wire.id,
            title = wire.title,
            description = wire.description,
            owner = wire.owner,
            start = start,
            end = if (end.isBefore(start)) start else end,
            allDay = wire.eventType == CalendarConstants.TYPE_ALL_DAY,
            color = wire.color.ifBlank { CalendarConstants.DEFAULT_COLOR },
            peers = wire.peers,
            isPrivate = isPrivate,
        )
    }
}
