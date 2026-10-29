package network.calimero.sign.core

import com.calimero.mero.admin.AdminSurface
import com.calimero.mero.admin.SetGroupMetadataRequest
import com.calimero.mero.app.MeroAppBackend

/** A group's metadata record: its name and data map. */
data class GroupRecord(
    val name: String?,
    val data: Map<String, String>,
)

/**
 * What Mero Sign needs beyond `MeroAppBackend`: blobs (a document's PDF and every signed version,
 * the signature images), group metadata (the marker on the private store's namespace) and member
 * names. The app uses [BackendSignAdmin]; tests use a fake. (Swift `SignAdmin`.)
 */
interface SignAdmin {
    /** Store bytes against a context the account is a member of. Returns the blob id. */
    suspend fun uploadBlob(
        data: ByteArray,
        contextId: String,
    ): String

    /** A blob's bytes, read through the context that holds it. */
    suspend fun getBlob(
        blobId: String,
        contextId: String,
    ): ByteArray

    suspend fun groupMetadata(groupId: String): GroupRecord?

    /** Replace a group's metadata record (name and data together). */
    suspend fun setGroupMetadata(
        groupId: String,
        name: String?,
        data: Map<String, String>,
    )

    /** The name a member set for themselves in a namespace. */
    suspend fun memberName(
        namespaceId: String,
        account: String,
    ): String?
}

/**
 * [SignAdmin] over the account's `MeroAppBackend` (blobs, metadata reads, member names) and, for the
 * one write the backend has no call for — a metadata record WITH a data map, the private store's
 * marker — the session's admin surface. (Swift `BackendSignAdmin`.)
 */
class BackendSignAdmin(
    private val backend: MeroAppBackend,
    private val admin: AdminSurface?,
) : SignAdmin {
    override suspend fun uploadBlob(
        data: ByteArray,
        contextId: String,
    ): String = backend.uploadBlob(contextId, data).blobId

    override suspend fun getBlob(
        blobId: String,
        contextId: String,
    ): ByteArray = backend.getBlob(blobId, contextId)

    override suspend fun groupMetadata(groupId: String): GroupRecord? = backend.groupMetadata(groupId)?.let { GroupRecord(it.name, it.data) }

    override suspend fun setGroupMetadata(
        groupId: String,
        name: String?,
        data: Map<String, String>,
    ) {
        val surface = admin ?: throw SignModelException("You're signed out. Sign in again and retry.")
        surface.setGroupMetadata(groupId, SetGroupMetadataRequest(name = name, data = data))
    }

    override suspend fun memberName(
        namespaceId: String,
        account: String,
    ): String? = backend.listMembers(namespaceId).firstOrNull { SignIds.same(it.identity, account) }?.name
}
