package network.calimero.calendar.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import java.util.UUID

/**
 * Private events for an account, kept on this device and never sent anywhere — the web app's
 * `api/privateStore.ts`, with the same keys and record shape.
 *
 * A relay has no private storage for the accounts it serves, so the contract's `#[app::private]`
 * storage is not there for a phone. The only place "private" can mean anything is this device.
 * Keyed by account + team; each record carries its calendar's context id.
 */
class PrivateEventStore(
    private val store: KeyValueStore,
    private val newId: () -> String = { CalendarConstants.LOCAL_PREFIX + UUID.randomUUID() },
) {
    @Serializable
    data class Stored(
        val id: String,
        val contextId: String,
        val title: String,
        val description: String,
        val start: String,
        val end: String,
        val type: String,
        val color: String,
        val peers: List<String> = emptyList(),
        val owner: String,
        val private: Boolean = true,
    )

    private val json = Json { ignoreUnknownKeys = true }
    private val serializer = ListSerializer(Stored.serializer())

    /** The key the web app uses: `mc-private-events:<account>:<namespace>`. */
    fun key(
        account: String,
        namespaceId: String,
    ): String = "mc-private-events:$account:$namespaceId"

    private fun read(key: String): List<Stored> = store.get(key)?.let { runCatching { json.decodeFromString(serializer, it) }.getOrNull() } ?: emptyList()

    private fun write(
        key: String,
        events: List<Stored>,
    ) = store.put(key, json.encodeToString(serializer, events))

    /** One calendar's private events. */
    fun list(
        key: String,
        contextId: String,
    ): List<CalEvent> = read(key).filter { it.contextId == contextId }.mapNotNull(::toEvent)

    fun add(
        key: String,
        contextId: String,
        owner: String,
        draft: EventFields,
    ): String {
        val id = newId()
        write(
            key,
            read(key) +
                Stored(
                    id = id,
                    contextId = contextId,
                    title = draft.title,
                    description = draft.description,
                    start = draft.start,
                    end = draft.end,
                    type = draft.type,
                    color = draft.color,
                    owner = owner,
                ),
        )
        return id
    }

    fun update(
        key: String,
        eventId: String,
        draft: EventFields,
    ): Boolean {
        val all = read(key)
        val index = all.indexOfFirst { it.id == eventId }
        if (index < 0) return false
        val next =
            all[index].copy(
                title = draft.title,
                description = draft.description,
                start = draft.start,
                end = draft.end,
                type = draft.type,
                color = draft.color,
                peers = emptyList(),
                private = true,
            )
        write(key, all.toMutableList().also { it[index] = next })
        return true
    }

    fun remove(
        key: String,
        eventId: String,
    ): Boolean {
        val all = read(key)
        val kept = all.filter { it.id != eventId }
        if (kept.size == all.size) return false
        write(key, kept)
        return true
    }

    private fun toEvent(stored: Stored): CalEvent? {
        val start = EventTime.parse(stored.start) ?: return null
        val end = EventTime.parse(stored.end) ?: start
        return CalEvent(
            id = stored.id,
            title = stored.title,
            description = stored.description,
            owner = stored.owner,
            start = start,
            end = end,
            allDay = stored.type == CalendarConstants.TYPE_ALL_DAY,
            color = stored.color,
            peers = emptyList(),
            isPrivate = true,
        )
    }
}

/** An event's fields in wire form, ready for the contract or the private store. */
data class EventFields(
    val title: String,
    val description: String,
    val start: String,
    val end: String,
    val type: String,
    val color: String,
    val peers: List<String>,
    val isPrivate: Boolean,
)
