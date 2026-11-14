package network.calimero.stream.core

import com.calimero.mero.app.MeroAppBackend
import network.calimero.stream.generated.StreamClient

/**
 * A member of a room's call, as the contract's `getMembers` and `join` answer: the generated
 * client's type. `memberId` is the member's **account** (64 hex); `joinedAt` and `updatedAt` are
 * unix seconds, sent as decimal strings (u64 on the wire). (Identical to the iOS `Member`.)
 */
typealias Member = StreamClient.Member

/**
 * The room contract (`../../logic`, `res/abi.json`) is [StreamClient], generated from it by core's
 * `meroctl app codegen` (`scripts/mobile-codegen.sh`). The phone calls only `join` and
 * `getMembers`: the probe's in-WASM codec and chunk paths are measurement tools the web keeps.
 * (Identical to the iOS `StreamContract.swift`.)
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
