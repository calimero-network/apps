package network.calimero.sign.core

import com.calimero.mero.crypto.Hex
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import network.calimero.sign.generated.ContextDetails
import network.calimero.sign.generated.DocumentInfo
import network.calimero.sign.generated.DocumentSignature
import network.calimero.sign.generated.DocumentStatus
import network.calimero.sign.generated.PermissionLevel
import java.security.MessageDigest

/** Which inbox list a document belongs in for the signed-in account. (Swift `InboxBucket`.) */
enum class InboxBucket(
    val title: String,
) {
    TO_SIGN("To sign"),
    WAITING("Waiting"),
    COMPLETED("Completed"),
}

/** One document as the signed-in account sees it. (Swift `DocumentEntry`.) */
data class DocumentEntry(
    val agreement: AgreementRef,
    val document: DocumentInfo,
    /** The signatures so far, in the order applied. Empty for a completed document read from a listing. */
    val signatures: List<DocumentSignature>,
    /** The caller's ACCOUNT, from `whoami`. */
    val me: String,
    /** Your permission in the agreement, null when you are not a participant. */
    val myLevel: PermissionLevel?,
) {
    val id: String get() = "${agreement.contextId}/${document.id}"

    val isComplete: Boolean get() = document.status == DocumentStatus.FullySigned

    val iSigned: Boolean get() = signatures.any { SignIds.same(it.signer, me) }

    val canSign: Boolean get() = myLevel != null && myLevel != PermissionLevel.Read && !isComplete && !iSigned

    val iAmRequired: Boolean get() = document.requiredSigners.any { SignIds.same(it, me) }

    val bucket: InboxBucket
        get() =
            when {
                isComplete -> InboxBucket.COMPLETED
                canSign -> InboxBucket.TO_SIGN
                else -> InboxBucket.WAITING
            }

    /** Required signers who have signed, of all required signers. */
    val progress: Pair<Int, Int>
        get() {
            val required = document.requiredSigners
            val signed = required.count { r -> signatures.any { SignIds.same(it.signer, r) } }
            return (if (isComplete) required.size else signed) to required.size
        }
}

/** One agreement's state as the account sees it. */
data class AgreementSnapshot(
    val agreement: AgreementRef,
    val details: ContextDetails,
    val me: String,
    val documents: List<DocumentEntry>,
) {
    val myLevel: PermissionLevel? get() = details.participants.firstOrNull { SignIds.same(it.userId, me) }?.permissionLevel

    val isParticipant: Boolean get() = myLevel != null
}

/** Read one agreement: details, who you are, its documents, and signatures of each open one. */
suspend fun AgreementDirectory.snapshot(
    agreement: AgreementRef,
    signaturesForCompleted: Boolean = false,
): AgreementSnapshot =
    coroutineScope {
        val sign = client(agreement.contextId)
        val details = async { sign.getContextDetails(agreement.contextId) }
        val me = async { SignIds.hex(sign.whoami()) }
        val documents = async { sign.listDocuments() }
        val level =
            details
                .await()
                .participants
                .firstOrNull { SignIds.same(it.userId, me.await()) }
                ?.permissionLevel
        val name = details.await().contextName.trim()
        val named = if (name.isEmpty() || name == agreement.name) agreement else agreement.copy(name = name)
        val entries =
            documents
                .await()
                .map { document ->
                    async {
                        val needs = document.status != DocumentStatus.FullySigned || signaturesForCompleted
                        val signatures = if (needs) sign.getDocumentSignatures(document.id) else emptyList()
                        DocumentEntry(named, document, signatures, me.await(), level)
                    }
                }.awaitAll()
        AgreementSnapshot(named, details.await(), me.await(), entries)
    }

/** People by the name they set for the workspace, else a short id. Cached per session. */
class NameDirectory(
    private val admin: SignAdmin,
) {
    private val names = mutableMapOf<String, String?>()
    private val lock = Mutex()

    suspend fun name(
        account: String,
        namespaceId: String,
    ): String? {
        val key = "$namespaceId/${SignIds.hex(account)}"
        lock.withLock { if (names.containsKey(key)) return names[key] }
        val fetched = attempt { admin.memberName(namespaceId, account) }.getOrNull()?.trimmedOrNull()
        lock.withLock { names[key] = fetched }
        return fetched
    }
}

/** SHA-256 as lowercase hex: the document hash the contract records. (Swift `DocumentHash`.) */
object DocumentHash {
    fun sha256Hex(data: ByteArray): String = Hex.encode(MessageDigest.getInstance("SHA-256").digest(data))

    /** A warning when the bytes don't match the recorded hash; null when they do or none was recorded. */
    fun integrityWarning(
        bytes: ByteArray,
        recordedHash: String,
    ): String? {
        val expected = recordedHash.trim().lowercase()
        if (expected.isEmpty()) return null
        val actual = sha256Hex(bytes)
        if (actual == expected) return null
        return "The file your relay returned doesn't match the fingerprint recorded for this document " +
            "(recorded ${expected.take(12)}…, got ${actual.take(12)}…). Don't rely on what's shown " +
            "without checking with the other parties."
    }
}
