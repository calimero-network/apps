package network.calimero.chess.app

import com.calimero.mero.app.MeroAppBackend
import network.calimero.chess.generated.MeroChessClient

/** [MeroChessClient] for [contextId] (the table's app id) in the account's backend. */
fun chessClient(
    backend: MeroAppBackend,
    contextId: String,
): MeroChessClient = MeroChessClient(backend, contextId)

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
        NO_RELAY("You're not connected to your cluster. Sign in again, or join a table from an invitation link."),
    }
}
