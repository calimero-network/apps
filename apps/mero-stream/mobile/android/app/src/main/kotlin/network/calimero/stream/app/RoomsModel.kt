package network.calimero.stream.app

import com.calimero.mero.app.MeroAppBackend
import com.calimero.mero.app.OrgInvitation
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import network.calimero.stream.core.ErrorText
import network.calimero.stream.core.Member
import network.calimero.stream.core.StreamException
import network.calimero.stream.core.StreamInvitation
import network.calimero.stream.core.streamClient

private val roomOrder = compareBy(String.CASE_INSENSITIVE_ORDER) { r: RoomSummary -> r.title }.thenBy { it.id }

/**
 * One stream's rooms (the web's `/streams/:orgId`): listing them, creating one (an app instance in
 * the stream's organization, initialised with its name), entering one, and minting room or stream
 * links. (Identical to the iOS `RoomsModel`.)
 *
 * There is no per-room join any more: the organization grants every room in it, and the contract's
 * own `join` (in the call) records the display name.
 */
class RoomsModel(
    val stream: StreamSummary,
    val backend: MeroAppBackend,
    private val applicationId: String?,
) {
    private val _rooms = MutableStateFlow<List<RoomSummary>>(emptyList())
    val rooms: StateFlow<List<RoomSummary>> = _rooms.asStateFlow()

    /** Who is in each room, by room id, when the roster could be read. */
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
                    .listContextEntries(stream.id)
                    .map { RoomSummary(it.id, stream.id, it.name.orEmpty()) }
                    .sortedWith(roomOrder)
            error.value = null
            loadRosters()
        } catch (e: Exception) {
            error.value = ErrorText.describe(e)
        } finally {
            _hasLoaded.value = true
        }
    }

    /** Each room's roster, read in parallel. Best effort. */
    private suspend fun loadRosters() {
        _rosters.value =
            coroutineScope {
                _rooms.value
                    .map { room -> async { room.id to runCatching { streamClient(backend, room.id).getMembers().map(Member::from) }.getOrNull() } }
                    .awaitAll()
                    .mapNotNull { (id, members) -> members?.let { id to it } }
                    .toMap()
            }
    }

    /** Create a room: its call's app instance, named and initialised with the name. */
    suspend fun create(name: String): RoomSummary? {
        val trimmed = name.trim()
        if (trimmed.isEmpty()) return null
        _pending.value = "create"
        return try {
            status.value = "Creating the room…"
            val app = applicationId?.takeIf { it.isNotEmpty() } ?: throw StreamException.noApplication()
            val appId = backend.createContext(stream.id, app, trimmed, buildJsonObject { put("name", JsonPrimitive(trimmed)) })
            val room = RoomSummary(appId, stream.id, trimmed)
            _rooms.value = (_rooms.value.filter { it.id != appId } + room).sortedWith(roomOrder)
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

    /** The room to open. The stream's organization already grants it. */
    @Suppress("RedundantSuspendModifier")
    suspend fun enter(room: RoomSummary): RoomSummary? {
        error.value = null
        return room
    }

    /** A link that drops someone straight into this room's call. */
    suspend fun inviteLink(room: RoomSummary): String? =
        mint("invite:${room.id}") {
            StreamInvitation(it, StreamInvitation.Kind.ROOM, stream.title, room.id, room.id, room.title)
        }

    /** A link that joins the whole stream and lands on its rooms. */
    suspend fun streamInviteLink(): String? = mint("invite") { StreamInvitation(it, StreamInvitation.Kind.NAMESPACE, stream.title) }

    private suspend fun mint(
        key: String,
        make: (OrgInvitation) -> StreamInvitation,
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
}
