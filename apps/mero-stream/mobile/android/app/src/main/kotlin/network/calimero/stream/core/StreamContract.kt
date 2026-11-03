package network.calimero.stream.core

import com.calimero.mero.app.ContextContractCalling
import com.calimero.mero.app.MeroAppBackend
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put

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
 * The room contract (`../../logic`, `res/abi.json`), bound to one room's app instance. Only the
 * methods the phone calls: the probe's in-WASM codec and chunk paths are measurement tools the web
 * keeps. Names and arguments are the component ABI's: camelCase, u64 as a decimal string.
 * (Identical to the iOS `StreamClient`.)
 */
class StreamClient(
    private val transport: ContextContractCalling,
) {
    /** Record (or rename) the caller in the room. [now] is unix seconds. */
    suspend fun join(
        username: String,
        now: Long,
    ): Member {
        val args =
            buildJsonObject {
                put("username", username)
                put("now", now.toString())
            }
        return Member.from(Json.parseToJsonElement(transport.execute("join", args.toString())))
    }

    /** Everyone who joined the room, in account order (a view). */
    suspend fun getMembers(): List<Member> {
        val answer = Json.parseToJsonElement(transport.query("getMembers", "{}"))
        val list = answer as? JsonArray ?: throw SerializationException("getMembers answered $answer")
        return list.map(Member::from)
    }

    companion object {
        /** Every contract method this client calls, with its parameters in ABI order. */
        val METHODS: Map<String, List<String>> =
            mapOf(
                "join" to listOf("username", "now"),
                "getMembers" to emptyList(),
            )
    }
}

/** The client for one room's call (app instance), through the signed-in backend. */
fun streamClient(
    backend: MeroAppBackend,
    contextId: String,
): StreamClient = StreamClient(backend.contract.bound(contextId))
