package network.calimero.stream.app

import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import network.calimero.stream.core.ErrorText
import network.calimero.stream.core.StreamInvitation

/** A stream: a namespace you invite people to. Each room in it is one call. */
data class StreamSummary(
    val id: String,
    val name: String,
    val memberCount: Int = 0,
    val roomCount: Int? = null,
) {
    /** The web's fallback for an unnamed namespace. */
    val title: String get() = name.trim().ifEmpty { "Stream ${id.take(6)}" }
}

/** A room: a subgroup of the stream, and the context that is its call. */
data class RoomSummary(
    val id: String,
    val namespaceId: String,
    val name: String,
    val contextId: String?,
) {
    val title: String get() = name.trim().ifEmpty { "Room ${id.take(6)}" }
}

/** Where redeeming an invitation lands: a stream's rooms, or straight into a call. */
sealed interface InvitationLanding {
    data class Stream(
        val stream: StreamSummary,
    ) : InvitationLanding

    data class Room(
        val stream: StreamSummary,
        val room: RoomSummary,
    ) : InvitationLanding
}

private val byTitle = compareBy(String.CASE_INSENSITIVE_ORDER) { s: StreamSummary -> s.title }

/** The stream list (the web's `/streams`): the account's namespaces, creating, inviting, joining. */
class StreamsModel(
    val backend: MeroAppBackend,
) {
    private val _streams = MutableStateFlow<List<StreamSummary>>(emptyList())
    val streams: StateFlow<List<StreamSummary>> = _streams.asStateFlow()
    private val _hasLoaded = MutableStateFlow(false)
    val hasLoaded: StateFlow<Boolean> = _hasLoaded.asStateFlow()
    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()
    private val _isWorking = MutableStateFlow(false)
    val isWorking: StateFlow<Boolean> = _isWorking.asStateFlow()
    val error = MutableStateFlow<String?>(null)

    /** Set when a stream was founded but the cloud would not host it. */
    val notice = MutableStateFlow<String?>(null)

    val hasRelay: Boolean get() = backend.hasRelay

    suspend fun load() {
        if (!backend.hasRelay) {
            _streams.value = emptyList()
            _hasLoaded.value = true
            return
        }
        _isLoading.value = true
        try {
            val namespaces = backend.listNamespaces()
            _streams.value =
                coroutineScope {
                    namespaces
                        .map { ns ->
                            async {
                                val rooms = runCatching { backend.listSubgroups(ns.id).size }.getOrNull()
                                StreamSummary(ns.id, ns.name.orEmpty(), ns.memberCount, rooms)
                            }
                        }.awaitAll()
                }.sortedWith(byTitle)
            error.value = null
        } catch (e: Exception) {
            error.value = ErrorText.describe(e)
        } finally {
            _isLoading.value = false
            _hasLoaded.value = true
        }
    }

    /** Found a stream. Returns it, or null with [error] set. */
    suspend fun create(name: String): StreamSummary? {
        val trimmed = name.trim()
        if (trimmed.isEmpty()) return null
        _isWorking.value = true
        return try {
            val founded = backend.foundNamespace(trimmed)
            if (!founded.haEnabled) {
                notice.value = founded.haError
                    ?: "The cloud is not hosting this stream yet, so people you invite can't find it until it is."
            }
            val stream = StreamSummary(founded.namespaceId, trimmed, memberCount = 1, roomCount = 0)
            _streams.value = (_streams.value.filter { it.id != stream.id } + stream).sortedWith(byTitle)
            error.value = null
            stream
        } catch (e: Exception) {
            error.value = ErrorText.describe(e)
            null
        } finally {
            _isWorking.value = false
        }
    }

    /** A link that joins the whole stream and lands on its rooms. */
    suspend fun inviteLink(stream: StreamSummary): String? {
        _isWorking.value = true
        return try {
            val signed = backend.createInvitation(stream.id)
            StreamInvitation(signed, StreamInvitation.Kind.NAMESPACE, stream.id, namespaceName = stream.title).link()
        } catch (e: Exception) {
            error.value = ErrorText.describe(e)
            null
        } finally {
            _isWorking.value = false
        }
    }

    /** Redeem an invitation. Null with [error] set when the relay refused. */
    suspend fun join(invitation: StreamInvitation): InvitationLanding? {
        _isWorking.value = true
        return try {
            backend.joinNamespace(invitation.namespaceId, invitation.invitation)
            val stream = StreamSummary(invitation.namespaceId, invitation.namespaceName.orEmpty())
            if (_streams.value.none { it.id == stream.id }) _streams.value = _streams.value + stream
            error.value = null
            val roomId = invitation.roomId
            if (invitation.opensRoom && roomId != null) {
                InvitationLanding.Room(
                    stream,
                    RoomSummary(roomId, invitation.namespaceId, invitation.roomName.orEmpty(), invitation.contextId),
                )
            } else {
                InvitationLanding.Stream(stream)
            }
        } catch (e: Exception) {
            error.value = ErrorText.describe(e)
            null
        } finally {
            _isWorking.value = false
        }
    }
}
