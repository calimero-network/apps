package network.calimero.calendar.data

import network.calimero.calendar.generated.CalendarClient
import network.calimero.calendar.generated.CreateCalendarEvent
import network.calimero.calendar.generated.UpdateCalendarEvent
import network.calimero.calendar.generated.CalendarEvent as WireEvent

/**
 * One calendar (a context): its shared events through the generated client, its private events
 * from this device ([PrivateEventStore]). Mirrors the web app's `ClientApiDataSource` on an
 * account session:
 *
 * - a private event, and a peerless one (which the contract would route to its private storage,
 *   which a relay does not have), stays on this device;
 * - an event with peers goes to `create_event`;
 * - a private event that gains peers and stops being private is promoted (the contract's own
 *   `update_private_event` rule): created shared, then dropped from this device.
 */
class CalendarRepository(
    private val client: CalendarClient,
    private val privateStore: PrivateEventStore,
    private val account: String,
    namespaceId: String,
    private val contextId: String,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val key = privateStore.key(account, namespaceId)

    suspend fun events(): List<CalEvent> {
        val shared = client.getEvents().mapNotNull(::toEvent)
        return shared + privateStore.list(key, contextId)
    }

    suspend fun members(): List<CalMember> = client.getMembers().map { CalMember(it.id, it.username.trim()) }

    suspend fun create(fields: EventFields): String {
        if (fields.isPrivate || fields.peers.isEmpty()) return privateStore.add(key, contextId, account, fields)
        return client.createEvent(
            CreateCalendarEvent(
                title = fields.title,
                description = fields.description,
                start = fields.start,
                end = fields.end,
                eventType = fields.type,
                color = fields.color,
                peers = fields.peers.map(HexIdTransport::bytesOf),
            ),
            now().toULong(),
        )
    }

    suspend fun update(
        event: CalEvent,
        fields: EventFields,
    ): String {
        if (event.isLocal) {
            if (!fields.isPrivate && fields.peers.isNotEmpty()) {
                val id = create(fields)
                privateStore.remove(key, event.id)
                return id
            }
            check(privateStore.update(key, event.id, fields)) { "This private event is no longer on this device." }
            return event.id
        }
        return client.updateEvent(
            event.id,
            UpdateCalendarEvent(
                title = fields.title,
                description = fields.description,
                start = fields.start,
                end = fields.end,
                eventType = fields.type,
                color = fields.color,
                peers = fields.peers.map(HexIdTransport::bytesOf),
            ),
            now().toULong(),
        )
    }

    suspend fun delete(event: CalEvent) {
        if (event.isLocal) {
            check(privateStore.remove(key, event.id)) { "This private event is no longer on this device." }
            return
        }
        client.deleteEvent(event.id)
    }

    suspend fun setUsername(name: String) = client.setUsername(name, now().toULong())

    private fun toEvent(wire: WireEvent): CalEvent? {
        val start = EventTime.parse(wire.start) ?: return null
        val end = EventTime.parse(wire.end) ?: start
        return CalEvent(
            id = wire.id,
            title = wire.title,
            description = wire.description,
            owner = HexIdTransport.hexOf(wire.owner),
            start = start,
            end = end,
            allDay = wire.eventType == CalendarConstants.TYPE_ALL_DAY,
            color = wire.color.ifBlank { CalendarConstants.DEFAULT_COLOR },
            peers = wire.peers.map(HexIdTransport::hexOf),
            isPrivate = false,
        )
    }
}
