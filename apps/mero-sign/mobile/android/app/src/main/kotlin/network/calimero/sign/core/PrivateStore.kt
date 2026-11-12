package network.calimero.sign.core

import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import network.calimero.sign.generated.ContractBytes
import network.calimero.sign.generated.SignContract
import network.calimero.sign.generated.SignatureRecord
import network.calimero.sign.generated.client.SignClient

/** A signature in the library, with its PNG when it could be fetched. (Swift `SavedSignature`.) */
data class SavedSignature(
    val id: ULong,
    val name: String,
    val blobId: String,
    val size: ULong,
    /** Milliseconds since the epoch. */
    val createdAt: ULong,
    val png: ByteArray?,
) {
    override fun equals(other: Any?): Boolean = other is SavedSignature && other.id == id && other.blobId == blobId

    override fun hashCode(): Int = id.hashCode()
}

/** Where the private context's id is remembered between launches, checked again before use. */
interface PrivateContextCache {
    fun load(account: String): String?

    fun save(
        contextId: String?,
        account: String,
    )
}

class MemoryPrivateContextCache : PrivateContextCache {
    private val values = mutableMapOf<String, String>()

    @Synchronized override fun load(account: String): String? = values[account]

    @Synchronized override fun save(
        contextId: String?,
        account: String,
    ) {
        if (contextId == null) values.remove(account) else values[account] = contextId
    }
}

/**
 * The account's PRIVATE library: its signature library and the registry of the agreements it
 * joined, with the identity it joined each one with (`identity_mappings`). Exactly the web's
 * `ensurePrivateLibrary`: an app instance named [SignConstants.LIBRARY_NAME] that the account owns
 * outside any organization, `setup(isPrivate = true, contextName = "default")` once, confirmed by
 * `isDefaultPrivateContext`. A phone and a browser on the same account share one library.
 * (Swift `PrivateStore`.)
 */
class PrivateStore(
    val backend: MeroAppBackend,
    val admin: SignAdmin,
    private val cache: PrivateContextCache = MemoryPrivateContextCache(),
) {
    private val ensuring = Mutex()

    @Volatile private var contextId: String? = null

    private fun client(contextId: String): SignClient = signClient(backend.contract, contextId)

    /** The account's library instances: named the library, owned by the account, in no organization. */
    private suspend fun candidates(): List<String> =
        admin
            .instances()
            .filter { it.name == SignConstants.LIBRARY_NAME && it.org == null && SignIds.same(it.owner, backend.account) }
            .map { it.appId }

    /** The library, without creating it. Null when there is none yet. */
    suspend fun find(): String? {
        contextId?.let { return it }
        cache.load(backend.account)?.let { cached ->
            if (isPrivate(cached)) return cached.also { contextId = it }
        }
        for (candidate in candidates()) {
            if (isPrivate(candidate)) return candidate.also(::remember)
        }
        return null
    }

    /** The library, found or created. One creation at a time. */
    suspend fun ensure(): String =
        ensuring.withLock {
            contextId ?: find() ?: create()
        }

    private suspend fun create(): String {
        // An instance whose setup never ran (created, then interrupted) is set up now.
        val appId = candidates().firstOrNull() ?: admin.createInstance(SignConstants.LIBRARY_NAME, null)
        client(appId).setup(true, SignConstants.PRIVATE_CONTEXT_NAME)
        remember(appId)
        return appId
    }

    private suspend fun isPrivate(contextId: String): Boolean = attempt { client(contextId).isDefaultPrivateContext() }.getOrDefault(false)

    private fun remember(id: String) {
        contextId = id
        cache.save(id, backend.account)
    }

    /**
     * Record an agreement in the private registry with the identity this account holds in it
     * (`joinSharedContext`, which writes the `IdentityMapping`). On Calimero 1.0 the identity is the
     * account itself. Best-effort: `Conflict` ("already joined") is the normal second answer.
     */
    suspend fun record(
        agreementContextId: String,
        sharedIdentity: String,
        name: String,
    ): Boolean {
        if (sharedIdentity.isEmpty()) return false
        return attempt {
            val store = ensure()
            client(store).joinSharedContext(agreementContextId, sharedIdentity, name)
            true
        }.getOrElse { SignErrorText.isConflict(it) }
    }

    /** The identity this account recorded for an agreement, if it recorded one. */
    suspend fun sharedIdentity(agreementContextId: String): String? {
        val store = attempt { find() }.getOrNull() ?: return null
        return attempt { ContractBytes.Text(client(store).getSharedIdentity(agreementContextId)).hex }.getOrNull()
    }

    /** The saved signatures, newest first, with their images. */
    suspend fun signatures(): List<SavedSignature> {
        val store = find() ?: return emptyList()
        val rows = client(store).listSignatures().map { SignContract.read<SignatureRecord>(it) }
        return coroutineScope {
            rows
                .map { row ->
                    async {
                        val blobId = SignIds.blobHex(row.blobId)
                        val png = if (blobId.isEmpty()) null else attempt { admin.getBlob(blobId, store) }.getOrNull()
                        SavedSignature(row.id, row.name, blobId, row.size, row.createdAt, png)
                    }
                }.awaitAll()
        }.sortedByDescending { it.createdAt }
    }

    /** Store a drawn signature (PNG): the blob into the library, then `createSignature`. */
    suspend fun saveSignature(
        png: ByteArray,
        name: String,
    ): SavedSignature {
        val store = ensure()
        val blobId = SignIds.blobHex(admin.uploadBlob(png, "image/png", store))
        if (blobId.isEmpty()) throw SignModelException("Your cluster returned a blob id this app can't use.")
        val id = client(store).createSignature(name, blobId, png.size.toULong())
        return SavedSignature(id, name, blobId, png.size.toULong(), System.currentTimeMillis().toULong(), png)
    }

    suspend fun deleteSignature(id: ULong) {
        val store = find() ?: return
        client(store).deleteSignature(id)
    }
}
