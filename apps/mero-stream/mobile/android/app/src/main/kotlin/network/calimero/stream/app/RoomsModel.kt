package network.calimero.stream.app

import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import network.calimero.stream.core.ErrorText
import network.calimero.stream.core.StreamException
import network.calimero.stream.core.StreamInvitation
import network.calimero.stream.core.streamClient
import network.calimero.stream.generated.Member

private val roomOrder = compareBy(String.CASE_INSENSITIVE_ORDER) { r: RoomSummary -> r.title }

/**
 * One stream's rooms (the web's `/streams/:namespaceId`): listing them, creating one (an open
 * subgroup plus the context that is its call), entering one, and minting room or stream links.
 */
class RoomsModel(
    val stream: StreamSummary,
    val backend: MeroAppBackend,
    private val applicationId: String?,
) {
    private val _rooms = MutableStateFlow<List<RoomSummary>>(emptyList())
    val rooms: StateFlow<List<RoomSummary>> = _rooms.asStateFlow()

    /** Who is in each room, by context id, when the roster could be read. */
    private val _rosters = MutableStateFlow<Map<String, List<Member>>>(emptyMap())
    val rosters: StateFlow<Map<String, List<Member>>> = _rosters.asStateFlow()
    private val _hasLoaded = MutableStateFlow(false)
    val hasLoaded: StateFlow<Boolean> = _hasLoaded.asStateFlow()

    /** The action in flight: "create", "enter:<room>", "invite:<room>", "invite". */
    private val _pending = MutableStateFlow<String?>(null)
    val pending: StateFlow<String?> = _pending.asStateFlow()
    val status = MutableStateFlow<String?>(null)
    val error = MutableStateFlow<String?>(null)

    suspend fun load() {
        try {
            _rooms.value =
                backend
                    .listSubgroups(stream.id)
                    .map { RoomSummary(it.groupId, stream.id, it.name.orEmpty(), it.contextIds.firstOrNull()) }
                    .sortedWith(roomOrder)
            error.value = null
            loadRosters()
        } catch (e: Exception) {
            error.value = ErrorText.describe(e)
        } finally {
            _hasLoaded.value = true
        }
    }

    /** Each room's roster, read in parallel. Best effort: a room we are not in may refuse the read. */
    private suspend fun loadRosters() {
        _rosters.value =
            coroutineScope {
                _rooms.value
                    .mapNotNull { it.contextId }
                    .map { id -> async { id to runCatching { streamClient(backend, id).getMembers() }.getOrNull() } }
                    .awaitAll()
                    .mapNotNull { (id, members) -> members?.let { id to it } }
                    .toMap()
            }
    }

    /** Create a room and its call. Returns it, ready to enter. */
    suspend fun create(name: String): RoomSummary? {
        val trimmed = name.trim()
        if (trimmed.isEmpty()) return null
        _pending.value = "create"
        return try {
            status.value = "Creating the room…"
            val groupId = backend.createSubgroup(stream.id, trimmed, isPublic = true)
            status.value = "Creating the call context…"
            val contextId =
                backend.createContext(groupId, resolveApplicationId(), trimmed, buildJsonObject { put("name", JsonPrimitive(trimmed)) })
            val room = RoomSummary(groupId, stream.id, trimmed, contextId)
            _rooms.value = (_rooms.value + room).sortedWith(roomOrder)
            error.value = null
            room
        } catch (e: Exception) {
            error.value = ErrorText.describe(e)
            null
        } finally {
            _pending.value = null
            status.value = null
        }
    }

    /** Join the room's call context if needed. Returns the room to open. */
    suspend fun enter(room: RoomSummary): RoomSummary? {
        val contextId = room.contextId
        if (contextId == null) {
            error.value = StreamException.noRoomContext(room.title).message
            return null
        }
        _pending.value = "enter:${room.id}"
        try {
            status.value = "Checking your membership…"
            if (runCatching { backend.isMember(contextId) }.getOrDefault(false)) return room
            status.value = "Joining the room…"
            var last: Exception? = null
            // Membership of a stream you just joined can take a moment to reach the relay; the web
            // waits for it the same way.
            repeat(JOIN_ATTEMPTS) { attempt ->
                try {
                    backend.joinContext(contextId)
                    error.value = null
                    return room
                } catch (e: Exception) {
                    last = e
                    if (attempt == 0) status.value = "Waiting for your membership to reach the room…"
                    delay(JOIN_RETRY_MS)
                }
            }
            error.value = last?.let(ErrorText::describe)
            return null
        } finally {
            _pending.value = null
            status.value = null
        }
    }

    /** A link that drops someone straight into this room's call. */
    suspend fun inviteLink(room: RoomSummary): String? =
        mint("invite:${room.id}") {
            StreamInvitation(it, StreamInvitation.Kind.ROOM, stream.id, stream.title, room.id, room.contextId, room.title)
        }

    /** A link that joins the whole stream and lands on its rooms. */
    suspend fun streamInviteLink(): String? =
        mint("invite") { StreamInvitation(it, StreamInvitation.Kind.NAMESPACE, stream.id, stream.title) }

    private suspend fun mint(
        key: String,
        make: (com.calimero.mero.admin.SignedGroupOpenInvitation) -> StreamInvitation,
    ): String? {
        _pending.value = key
        return try {
            make(backend.createInvitation(stream.id)).link()
        } catch (e: Exception) {
            error.value = ErrorText.describe(e)
            null
        } finally {
            _pending.value = null
        }
    }

    private suspend fun resolveApplicationId(): String {
        if (!applicationId.isNullOrEmpty()) return applicationId
        return backend
            .listNamespaces()
            .firstOrNull { it.id == stream.id }
            ?.applicationId
            ?.takeIf { it.isNotEmpty() }
            ?: throw StreamException.noApplication()
    }

    companion object {
        const val JOIN_ATTEMPTS = 4
        const val JOIN_RETRY_MS = 1_500L
    }
}
