package network.calimero.vote.core

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import network.calimero.vote.crypto.Ballot
import network.calimero.vote.crypto.Branch
import network.calimero.vote.crypto.Ciphertext
import network.calimero.vote.crypto.Dealing
import network.calimero.vote.crypto.EncryptedChoice
import network.calimero.vote.crypto.EncryptedShare
import network.calimero.vote.crypto.Hex
import network.calimero.vote.crypto.RistrettoPoint
import network.calimero.vote.crypto.Rules
import network.calimero.vote.crypto.Scalar
import network.calimero.vote.crypto.VoteCryptoException
import network.calimero.vote.generated.PollDefinition
import network.calimero.vote.generated.WireBallot
import network.calimero.vote.generated.WireBranch
import network.calimero.vote.generated.WireChoice
import network.calimero.vote.generated.WireDealing
import network.calimero.vote.generated.WireEncShare

/** The contract's JSON shapes (the generated `Wire*` types) to and from the protocol's values. (Swift `VoteWire`.) */
object VoteWire {
    private fun isHex32(hex: String) = hex.length == 64 && Hex.decode(hex) != null

    fun point(
        hex: String,
        what: String = "point",
    ): RistrettoPoint {
        if (!isHex32(hex)) throw VoteCryptoException("$what: not 32 bytes of hex")
        return try {
            RistrettoPoint.fromHex(hex)
        } catch (e: IllegalArgumentException) {
            throw VoteCryptoException("$what: not a valid ristretto255 point")
        }
    }

    fun scalar(
        hex: String,
        what: String = "scalar",
    ): Scalar {
        if (!isHex32(hex)) throw VoteCryptoException("$what: not 32 bytes of hex")
        return try {
            Scalar.fromHex(hex)
        } catch (e: IllegalArgumentException) {
            throw VoteCryptoException("$what: not a canonical scalar")
        }
    }

    fun branch(b: Branch): WireBranch = WireBranch(b.c.hex(), b.z.hex())

    fun branch(
        w: WireBranch,
        what: String = "proof",
    ): Branch = Branch(scalar(w.c, what), scalar(w.z, what))

    fun ballot(b: Ballot): WireBallot =
        WireBallot(
            b.choices.map { WireChoice(it.ct.a.hex(), it.ct.b.hex(), it.proof.map(::branch)) },
            b.sumProof.map(::branch),
        )

    fun ballot(w: WireBallot): Ballot =
        Ballot(
            w.choices.map { ch ->
                EncryptedChoice(
                    Ciphertext(point(ch.a, "ciphertext"), point(ch.b, "ciphertext")),
                    ch.proof.map { branch(it, "choice proof") },
                )
            },
            w.sumProof.map { branch(it, "sum proof") },
        )

    fun dealing(d: Dealing): WireDealing =
        WireDealing(d.commitments.map { it.hex() }, branch(d.proof), d.shares.map { WireEncShare(it.r.hex(), it.v.hex()) })

    fun dealing(w: WireDealing): Dealing =
        Dealing(
            w.commitments.map { point(it, "commitment") },
            branch(w.proof, "dealing proof"),
            w.shares.map { EncryptedShare(point(it.r, "share"), scalar(it.v, "share")) },
        )

    fun rules(def: PollDefinition): Rules = Rules(def.options.size, def.minChoices.toInt(), def.maxChoices.toInt())
}

/**
 * A trustee's transport secret: the one value on this device that can help decrypt anything.
 * Same JSON as the web's backup file (`utils/trusteeKeys.ts`), so a backup moves between the web
 * and the phone. (Swift `TrusteeKey`.)
 */
@Serializable
data class TrusteeKey(
    val v: Int = 1,
    val contextId: String,
    val pollId: String,
    val account: String,
    /** 64-hex canonical scalar. */
    val secret: String,
) {
    /** The backup file's text, as the web writes it. */
    fun json(): String = pretty.encodeToString(serializer(), this)

    val backupFileName: String get() = "mero-vote-trustee-${pollId.take(12)}.json"

    companion object {
        private val pretty =
            Json {
                prettyPrint = true
                encodeDefaults = true
            }
        private val lenient = Json { ignoreUnknownKeys = true }

        /** Parse a backup, refusing one made for a different poll, account or context. */
        fun parse(
            raw: String,
            contextId: String,
            pollId: String,
            account: String,
        ): TrusteeKey {
            val key =
                runCatching { lenient.decodeFromString(serializer(), raw) }
                    .getOrNull()
                    ?.takeIf { it.v == 1 && it.secret.length == 64 && it.secret.all { c -> c in "0123456789abcdef" } }
                    ?: throw VoteModelException("This isn't a Mero Vote trustee key.")
            if (key.pollId != pollId) throw VoteModelException("This key is for a different poll.")
            if (key.account != account) throw VoteModelException("This key belongs to a different account.")
            if (key.contextId != contextId) throw VoteModelException("This key is for a different voting group.")
            return key
        }

        /** The storage name, as the web's localStorage key. */
        fun name(
            contextId: String,
            pollId: String,
            account: String,
        ): String = "mero-vote:trustee:$contextId:$pollId:$account"
    }
}

/** Where trustee keys live on this device. The app uses the Android Keystore; tests use memory. */
interface TrusteeKeyStore {
    fun load(
        contextId: String,
        pollId: String,
        account: String,
    ): TrusteeKey?

    /** False when the device refused to store it. */
    fun save(key: TrusteeKey): Boolean
}

class MemoryTrusteeKeyStore : TrusteeKeyStore {
    private val keys = mutableMapOf<String, TrusteeKey>()

    @Volatile var refuses = false

    override fun load(
        contextId: String,
        pollId: String,
        account: String,
    ): TrusteeKey? = synchronized(keys) { keys[TrusteeKey.name(contextId, pollId, account)] }

    override fun save(key: TrusteeKey): Boolean =
        synchronized(keys) {
            if (refuses) return false
            keys[TrusteeKey.name(key.contextId, key.pollId, key.account)] = key
            true
        }
}
