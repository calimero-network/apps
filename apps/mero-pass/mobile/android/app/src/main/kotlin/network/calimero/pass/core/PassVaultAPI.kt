package network.calimero.pass.core

import com.calimero.mero.app.ContextContract
import network.calimero.pass.generated.ContextContractCalling
import network.calimero.pass.generated.KeyWrapInput
import network.calimero.pass.generated.PassClient

/**
 * The SDK's bound contract, as the generated client's transport. The two interfaces have the same
 * methods; they are separate types only because the generated file declares its own.
 * (Swift `PassTransport`.)
 */
class PassTransport(
    private val bound: com.calimero.mero.app.ContextContractCalling,
) : ContextContractCalling {
    override suspend fun query(
        method: String,
        argsJson: String,
    ): String = bound.query(method, argsJson)

    override suspend fun execute(
        method: String,
        argsJson: String,
    ): String = bound.execute(method, argsJson)
}

/** The vault client for one context, over the account's relay. */
fun passClient(
    contract: ContextContract,
    contextId: String,
): PassClient = PassClient(PassTransport(contract.bound(contextId)))

/**
 * The generated client, adapted to the narrow [VaultAPI] a session needs (the web's
 * `vaultApi.ts`), plus the calls the screens make directly. (Swift `PassVaultAPI`.)
 */
class PassVaultAPI(
    val client: PassClient,
) : VaultScreenAPI {
    constructor(contract: ContextContract, contextId: String) : this(passClient(contract, contextId))

    override suspend fun vaultInfo(): VaultInfoRecord {
        val i = client.vaultInfo()
        return VaultInfoRecord(i.name, i.currentKey, i.defaultRole, i.myAccount, Role.of(i.myRole))
    }

    override suspend fun registerDevice(
        fingerprint: String,
        publicKey: String,
        label: String,
        kind: DeviceKind,
    ) = client.registerDevice(fingerprint, publicKey, label, kind.wire)

    override suspend fun revokeDevice(fingerprint: String) = client.revokeDevice(fingerprint)

    override suspend fun listDevices(): List<DeviceRecord> =
        client.listDevices().map { DeviceRecord(it.fingerprint, it.publicKey, it.label, it.kind, it.account, it.addedAt, it.revoked) }

    override suspend fun listMembers(): List<MemberRecord> =
        client.listMembers().map { MemberRecord(it.account, Role.of(it.role), it.devices.toInt()) }

    override suspend fun keyWrapsFor(recipient: String): List<WrapRecord> =
        client.keyWrapsFor(recipient).map { WrapRecord(it.keyId, it.recipient, it.wrapper, it.envelope) }

    override suspend fun wrappedPairs(): List<String> = client.wrappedPairs()

    override suspend fun addKeyWraps(wraps: List<WrapRecord>): Int =
        client.addKeyWraps(wraps.map { KeyWrapInput(it.keyId, it.recipient, it.wrapper, it.envelope) }).toInt()

    override suspend fun rotateKey(keyId: String) = client.rotateKey(keyId)

    override suspend fun setRole(
        account: String,
        role: Role,
    ) = client.setRole(account, role.wire)

    override suspend fun removeMember(account: String) = client.removeMember(account)

    override suspend fun listSecrets(): List<SecretRecord> =
        client.listSecrets().map {
            SecretRecord(it.id, it.kind, it.name, it.tags, it.fields, it.createdAt, it.createdBy, it.updatedAt, it.updatedBy, it.trashed, it.trashedAt)
        }

    override suspend fun addSecret(
        id: String,
        kind: String,
        name: String,
        tags: String,
        fields: Map<String, String>,
    ): String = client.addSecret(id, kind, name, tags, fields)

    override suspend fun updateSecret(
        id: String,
        name: String?,
        tags: String?,
        fields: Map<String, String>,
        rekey: Boolean,
    ) = client.updateSecret(id, name, tags, fields, rekey)

    override suspend fun secretHistory(id: String): List<RevisionRecord> =
        client.secretHistory(id).map { RevisionRecord(it.field, it.previous, it.replacedAt, it.replacedBy) }

    override suspend fun trashSecret(id: String) = client.trashSecret(id)

    override suspend fun restoreSecret(id: String) = client.restoreSecret(id)

    override suspend fun purgeSecret(id: String) = client.purgeSecret(id)

    override suspend fun auditLogs(): List<AuditRecord> =
        client.getAuditLogs().map { AuditRecord(it.action, it.target, it.account, it.device, it.timestamp, it.redacted) }

    override suspend fun setDefaultRole(role: Role) = client.setDefaultRole(role.wire)
}
