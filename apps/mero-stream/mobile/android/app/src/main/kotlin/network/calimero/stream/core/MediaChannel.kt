package network.calimero.stream.core

import com.calimero.mero.ephemeral.RawCodec
import com.calimero.mero.presence.RelayPresenceClient
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/** One presence slice as it arrives. */
class MediaSlice(
    val author: String,
    val bytes: ByteArray?,
    val removed: Boolean = false,
    /** Set on a replayed entry (the seed a new subscriber gets). Stale media. */
    val ageMs: Long? = null,
)

/**
 * Where the call's media travels: the context's ephemeral presence. On a phone that is the
 * account's relay ([RelayMediaChannel]): each slice is a device-signed `presence-intents` POST,
 * gossiped to the room by the relay, read back off the relay's event stream. Tests pass a fake.
 */
interface MediaChannel {
    /** The author this device's slices carry (its device key), to skip our own echo. */
    val selfAuthor: String?

    /** Publish one slice. The call publishes one at a time. */
    suspend fun publish(
        contextId: String,
        slice: ByteArray,
    )

    /** Retract our slice, on leaving. */
    suspend fun retract(contextId: String)

    /** Every slice in the context as it arrives. */
    fun slices(contextId: String): Flow<MediaSlice>
}

/** [MediaChannel] over the SDK's [RelayPresenceClient]. */
class RelayMediaChannel(
    private val presence: RelayPresenceClient,
    override val selfAuthor: String?,
) : MediaChannel {
    override suspend fun publish(
        contextId: String,
        slice: ByteArray,
    ) = presence.set(contextId, slice, RawCodec)

    override suspend fun retract(contextId: String) {
        runCatching { presence.clear(contextId) }
    }

    override fun slices(contextId: String): Flow<MediaSlice> =
        presence.subscribe(contextId, RawCodec).map { MediaSlice(it.author, it.state, it.removed, it.ageMs) }
}
