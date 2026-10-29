package network.calimero.sign.core

import com.calimero.mero.app.AppNamespace
import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import network.calimero.sign.generated.SignClient

/** A signature in the library, with its PNG when it could be fetched. (Swift `SavedSignature`.) */
data class SavedSignature(
    val id: ULong,
    val name: String,
    val blobId: String,
    val size: ULong,
    /** Nanoseconds. */
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
 * The account's PRIVATE context: its signature library and the registry of the agreements it
 * joined, with the identity it joined each one with (`identity_mappings`). Mirrors the web's
 * `DefaultContextService` + `ensurePersonalWorkspace` + `createPersonalContext`: a namespace of its
 * own found by its metadata MARKER, a RESTRICTED "Private" subgroup, and a context initialised
 * `{is_private: true, context_name: "default"}`, confirmed by `is_default_private_context`.
 * (Swift `PrivateStore`.)
 */
class PrivateStore(
    val backend: MeroAppBackend,
    val admin: SignAdmin,
    private val applicationId: String?,
    private val cache: PrivateContextCache = MemoryPrivateContextCache(),
) {
    private val ensuring = Mutex()

    @Volatile private var contextId: String? = null

    private fun client(contextId: String): SignClient = signClient(backend.contract, contextId)

    suspend fun personalNamespace(): AppNamespace? = backend.listNamespaces().firstOrNull { isPersonal(it.id) }

    /** Whether a namespace carries the personal marker. A failed read is "no". */
    suspend fun isPersonal(namespaceId: String): Boolean = attempt { admin.groupMetadata(namespaceId) }.getOrNull()?.data?.get("kind") == SignConstants.PERSONAL_KIND

    /** The private context, without creating it. Null when there is none yet. */
    suspend fun find(): String? {
        contextId?.let { return it }
        cache.load(backend.account)?.let { cached ->
            if (isPrivate(cached)) return cached.also { contextId = it }
        }
        val personal = personalNamespace() ?: return null
        val candidates =
            backend.listSubgroups(personal.id).flatMap { it.contextIds } +
                attempt { backend.listContexts(personal.id) }.getOrDefault(emptyList())
        for (candidate in candidates) {
            if (isPrivate(candidate)) return candidate.also(::remember)
        }
        return null
    }

    /** The private context, found or created. One creation at a time. */
    suspend fun ensure(): String =
        ensuring.withLock {
            contextId ?: find() ?: create()
        }

    private suspend fun create(): String {
        val personal = personalNamespace()
        val namespaceId: String
        val appId: String
        if (personal != null) {
            namespaceId = personal.id
            appId = applicationId?.takeIf { it.isNotEmpty() } ?: personal.applicationId
        } else {
            namespaceId = backend.foundNamespace(SignConstants.PERSONAL_WORKSPACE_NAME).namespaceId
            // NOT swallowed: the marker IS this namespace's identity.
            admin.setGroupMetadata(namespaceId, SignConstants.PERSONAL_WORKSPACE_NAME, mapOf("kind" to SignConstants.PERSONAL_KIND))
            appId = applicationId?.takeIf { it.isNotEmpty() }
                ?: backend.listNamespaces().let { all -> all.firstOrNull { it.id == namespaceId }?.applicationId ?: all.firstOrNull()?.applicationId }
                ?: ""
        }
        if (appId.isEmpty()) throw SignModelException("Mero Sign's application isn't known to your account yet. Try again shortly.")
        // RESTRICTED: open, anybody admitted to the namespace could reach the library.
        val groupId = backend.createSubgroup(namespaceId, SignConstants.PERSONAL_GROUP_NAME, isPublic = false)
        val created =
            backend.createContext(
                groupId,
                appId,
                SignConstants.PRIVATE_CONTEXT_NAME,
                buildJsonObject {
                    put("is_private", JsonPrimitive(true))
                    put("context_name", JsonPrimitive(SignConstants.PRIVATE_CONTEXT_NAME))
                },
            )
        remember(created)
        return created
    }

    private suspend fun isPrivate(contextId: String): Boolean = attempt { client(contextId).isDefaultPrivateContext() }.getOrDefault(false)

    private fun remember(id: String) {
        contextId = id
        cache.save(id, backend.account)
    }

    /**
     * Record an agreement in the private registry with the identity this account holds in it
     * (`join_shared_context`, which writes the `IdentityMapping`). Through a relay the identity is
     * the account itself. Best-effort: "Already joined this context" is the normal second answer.
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
        }.getOrElse { SignErrorText.message(it).contains("already joined", ignoreCase = true) }
    }

    /** The identity this account recorded for an agreement, if it recorded one. */
    suspend fun sharedIdentity(agreementContextId: String): String? {
        val store = attempt { find() }.getOrNull() ?: return null
        return attempt { client(store).getSharedIdentity(agreementContextId).hex }.getOrNull()
    }

    /** The saved signatures, newest first, with their images. */
    suspend fun signatures(): List<SavedSignature> {
        val store = find() ?: return emptyList()
        val rows = client(store).listSignatures()
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

    /** Store a drawn signature (PNG): the blob into the private context, then `create_signature`. */
    suspend fun saveSignature(
        png: ByteArray,
        name: String,
    ): SavedSignature {
        val store = ensure()
        val blobId = SignIds.blobHex(admin.uploadBlob(png, store))
        if (blobId.isEmpty()) throw SignModelException("Your relay returned a blob id this app can't use.")
        val id = client(store).createSignature(name, blobId, png.size.toULong())
        return SavedSignature(id, name, blobId, png.size.toULong(), (System.currentTimeMillis() * 1_000_000).toULong(), png)
    }

    suspend fun deleteSignature(id: ULong) {
        val store = find() ?: return
        client(store).deleteSignature(id)
    }
}
