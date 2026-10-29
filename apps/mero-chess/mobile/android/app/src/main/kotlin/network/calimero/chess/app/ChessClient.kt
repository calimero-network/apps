package network.calimero.chess.app

import com.calimero.mero.app.MeroAppBackend
import network.calimero.chess.generated.ContextContractCalling
import network.calimero.chess.generated.MeroChessClient

/**
 * The generated client over one table's contract.
 *
 * The generated file declares its own `ContextContractCalling` (it depends on nothing but
 * kotlinx.serialization), with the same two methods as the SDK's; this forwards one to the other,
 * so every contract call in the app goes through [MeroChessClient] and never names a method by hand.
 */
internal class ContractTransport(
    private val inner: com.calimero.mero.app.ContextContractCalling,
) : ContextContractCalling {
    override suspend fun query(
        method: String,
        argsJson: String,
    ): String = inner.query(method, argsJson)

    override suspend fun execute(
        method: String,
        argsJson: String,
    ): String = inner.execute(method, argsJson)
}

/** [MeroChessClient] for [contextId] in the account's backend. */
fun chessClient(
    backend: MeroAppBackend,
    contextId: String,
): MeroChessClient = MeroChessClient(ContractTransport(backend.contract.bound(contextId)))

/** Milliseconds since the epoch: every `now` the contract takes. */
internal fun nowMillis(): ULong = System.currentTimeMillis().toULong()

/** Where the player's chosen display name lives between visits. */
interface NameStore {
    var name: String
}

/** For tests and previews. */
class MemoryNameStore(
    override var name: String = "",
) : NameStore

/** Thrown by the models with a sentence for the player. (Swift `ChessError`.) */
class ChessException(
    val kind: Kind,
) : Exception(kind.message) {
    enum class Kind(
        val message: String,
    ) {
        NO_NAMESPACE("This table's club is not known on this device yet. Open it from Tables and try again."),
        NO_APPLICATION("Mero Chess is still being looked up in the app registry. Try again in a moment."),
        NOT_AN_INVITATION("That is not a Mero Chess invitation link."),
        NO_RELAY("Your account has no relay yet. Join a table from an invitation link first."),
    }
}
