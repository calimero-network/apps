package network.calimero.stream.core

import com.calimero.mero.app.MeroAppBackend
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import network.calimero.stream.generated.StreamClient

/**
 * A member of a room's call, as the contract's `getMembers` and `join` answer. [memberId] is the
 * member's **account** (64 hex); [joinedAt] and [updatedAt] are unix seconds, sent as decimal
 * strings (u64 on the wire). (Identical to the iOS `Member`.)
 */
data class Member(
    val memberId: String,
    val username: String,
    val joinedAt: Long,
    val updatedAt: Long,
) {
    companion object {
        /** A member from the contract's JSON. */
        fun from(json: JsonElement): Member {
            val o = json as? JsonObject ?: throw SerializationException("a member is not an object: $json")
            val id = (o["memberId"] as? JsonPrimitive)?.contentOrNull ?: throw SerializationException("a member has no memberId")
            return Member(
                memberId = id,
                username = (o["username"] as? JsonPrimitive)?.contentOrNull.orEmpty(),
                joinedAt = u64(o["joinedAt"]),
                updatedAt = u64(o["updatedAt"]),
            )
        }

        /** A u64 field: a decimal string on the component runtime, a number from an older node. */
        private fun u64(value: JsonElement?): Long {
            val text = (value as? JsonPrimitive)?.contentOrNull ?: return 0
            return text.toLongOrNull() ?: throw SerializationException("not a u64: $text")
        }
    }
}

/**
 * The room contract (`../../logic`, `res/abi.json`) is [StreamClient], generated from it by core's
 * `mero-app-build codegen` (`scripts/mobile-codegen.sh`). The phone calls only `join` and
 * `getMembers`: the probe's in-WASM codec and chunk paths are measurement tools the web keeps.
 * Until the logic derives `AbiType`, the ABI names `Member` without its shape, so the client answers
 * its JSON and [Member.from] reads it. (Identical to the iOS `StreamContract.swift`.)
 */
object StreamContract {
    /** Every contract method the app calls, with its parameters in ABI order. */
    val METHODS: Map<String, List<String>> =
        mapOf(
            "join" to listOf("username", "now"),
            "getMembers" to emptyList(),
        )
}

/** The client for one room's call (app instance), through the signed-in backend. */
fun streamClient(
    backend: MeroAppBackend,
    contextId: String,
): StreamClient = StreamClient(backend, contextId)
