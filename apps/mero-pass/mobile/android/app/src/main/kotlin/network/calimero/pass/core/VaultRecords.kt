package network.calimero.pass.core

// The contract surface a vault session needs (the web's `VaultApi`), and the plaintext shapes it
// hands the screens. (Swift: the top of `VaultSession.swift`.)

enum class Role(
    val wire: String,
) {
    ADMIN("admin"),
    EDITOR("editor"),
    VIEWER("viewer"),
    PENDING("pending"),
    REMOVED("removed"),
    ;

    val holdsKey: Boolean get() = this == ADMIN || this == EDITOR || this == VIEWER

    companion object {
        fun of(wire: String): Role = entries.firstOrNull { it.wire == wire } ?: PENDING
    }
}

/**
 * What a device's key is. A phone registers as `browser`: the contract knows these three kinds,
 * and a phone is the same thing as far as the vault is concerned.
 */
enum class DeviceKind(
    val wire: String,
) {
    BROWSER("browser"),
    RECOVERY("recovery"),
    AGENT("agent"),
}

data class VaultInfoRecord(
    val name: String,
    val currentKey: String,
    val defaultRole: String,
    val myAccount: String,
    val myRole: Role,
)

data class SecretRecord(
    val id: String,
    val kind: String,
    val name: String,
    val tags: String,
    val fields: Map<String, String>,
    val createdAt: ULong = 0u,
    val createdBy: String = "",
    val updatedAt: ULong = 0u,
    val updatedBy: String = "",
    val trashed: Boolean = false,
    val trashedAt: ULong = 0u,
)

data class RevisionRecord(
    val field: String,
    val previous: String,
    val replacedAt: ULong,
    val replacedBy: String,
)

data class DeviceRecord(
    val fingerprint: String,
    /** Base64 of the raw public key. */
    val publicKey: String,
    val label: String,
    val kind: String,
    /** The account that registered it: the entry's owner stamp. */
    val account: String,
    val addedAt: ULong = 0u,
    val revoked: Boolean = false,
)

data class MemberRecord(
    val account: String,
    val role: Role,
    val devices: Int,
)

data class WrapRecord(
    val keyId: String,
    val recipient: String,
    val wrapper: String,
    val envelope: String,
)

data class AuditRecord(
    val action: String,
    val target: String,
    val account: String,
    val device: String,
    val timestamp: ULong,
    val redacted: Boolean,
)

/** The contract surface a session needs (the web's `VaultApi`). (Swift `VaultAPI`.) */
interface VaultAPI {
    suspend fun vaultInfo(): VaultInfoRecord

    suspend fun registerDevice(
        fingerprint: String,
        publicKey: String,
        label: String,
        kind: DeviceKind,
    )

    suspend fun revokeDevice(fingerprint: String)

    suspend fun listDevices(): List<DeviceRecord>

    suspend fun listMembers(): List<MemberRecord>

    suspend fun keyWrapsFor(recipient: String): List<WrapRecord>

    suspend fun wrappedPairs(): List<String>

    suspend fun addKeyWraps(wraps: List<WrapRecord>): Int

    suspend fun rotateKey(keyId: String)

    suspend fun setRole(
        account: String,
        role: Role,
    )

    suspend fun removeMember(account: String)

    suspend fun listSecrets(): List<SecretRecord>

    suspend fun addSecret(
        id: String,
        kind: String,
        name: String,
        tags: String,
        fields: Map<String, String>,
    ): String

    suspend fun updateSecret(
        id: String,
        name: String?,
        tags: String?,
        fields: Map<String, String>,
        rekey: Boolean,
    )

    suspend fun secretHistory(id: String): List<RevisionRecord>
}

/** [VaultAPI] plus the calls the vault screens make directly. (Swift `VaultScreenAPI`.) */
interface VaultScreenAPI : VaultAPI {
    suspend fun trashSecret(id: String)

    suspend fun restoreSecret(id: String)

    suspend fun purgeSecret(id: String)

    suspend fun auditLogs(): List<AuditRecord>

    suspend fun setDefaultRole(role: Role)
}

data class Secret(
    val id: String,
    val kind: String,
    val name: String,
    val tags: List<String>,
    val fields: Map<String, String>,
    val createdAt: ULong = 0u,
    val createdBy: String = "",
    val updatedAt: ULong = 0u,
    val updatedBy: String = "",
    val trashed: Boolean = false,
    val trashedAt: ULong = 0u,
    /** Some envelope did not open on this device. */
    val unreadable: Boolean = false,
) {
    // Plaintext lives here: keep it out of logs and crash reports.
    override fun toString(): String = "Secret($id, $kind)"
}

data class Revision(
    val field: String,
    val previous: String,
    val replacedAt: ULong,
    val replacedBy: String,
    val unreadable: Boolean,
) {
    override fun toString(): String = "Revision($field)"
}

data class SecretDraft(
    val kind: String,
    val name: String,
    val tags: List<String>,
    val fields: Map<String, String>,
) {
    override fun toString(): String = "SecretDraft($kind)"
}

enum class SessionState {
    /** Holds the current key: can read and (role permitting) write. */
    READY,

    /** Registered, but nobody holding the key has wrapped it to this device yet. */
    WAITING,

    /** A fresh vault whose admin has not opened it yet, so there is no key. */
    UNINITIALISED,
}

data class Holders(
    val browsers: Int,
    val recovery: Int,
    val agents: Int,
)

data class Chores(
    val admitted: Int,
    val wrapped: Int,
    val removed: Int,
)

class VaultSessionException(
    message: String,
) : Exception(message) {
    companion object {
        val NO_KEY get() = VaultSessionException("This device has not been given the vault key yet.")
    }
}

/** How a recovery key is listed among a vault's devices. */
const val RECOVERY_LABEL = "Recovery key"

/**
 * Which devices a key holder may wrap keys to without anyone being asked, and which wait for
 * approval. See the web's `classifyDevices`.
 */
fun classifyDevices(
    devices: List<DeviceRecord>,
    members: List<MemberRecord>,
    pairs: List<String>,
    allowed: Set<String>?,
): Pair<List<DeviceRecord>, List<DeviceRecord>> {
    val role = HashMap<String, Role>()
    for (m in members) role.putIfAbsent(m.account, m.role)
    val holders = pairs.map { it.substringAfter(':') }.toSet()
    val live =
        devices.filter { d ->
            !d.revoked && (role[d.account] ?: Role.PENDING).holdsKey && (allowed?.contains(d.account) ?: true)
        }
    val accountsWithApproved =
        live.filter { it.kind == DeviceKind.BROWSER.wire && it.fingerprint in holders }.map { it.account }.toSet()
    val entitled = mutableListOf<DeviceRecord>()
    val awaiting = mutableListOf<DeviceRecord>()
    for (d in live) {
        when {
            d.fingerprint in holders -> entitled += d
            d.kind == DeviceKind.RECOVERY.wire -> Unit
            d.kind == DeviceKind.AGENT.wire -> awaiting += d
            d.account !in accountsWithApproved -> entitled += d
            else -> awaiting += d
        }
    }
    return entitled to awaiting
}

/** Accounts that registered only agent keys: software, not people. */
fun agentOnlyAccounts(devices: List<DeviceRecord>): Set<String> {
    val kinds = HashMap<String, MutableSet<String>>()
    for (d in devices) if (!d.revoked) kinds.getOrPut(d.account) { mutableSetOf() }.add(d.kind)
    return kinds.filterValues { it == setOf(DeviceKind.AGENT.wire) }.keys
}
