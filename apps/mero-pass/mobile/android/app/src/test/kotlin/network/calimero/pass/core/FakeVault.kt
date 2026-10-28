package network.calimero.pass.core

/**
 * A shared in-memory vault, and one [VaultAPI] handle per account: the web's `FakeVault` from
 * `vaultSession.test.ts`, with the contract's rules (roles, the device registry, wraps that land
 * only on registered unrevoked devices, wraps that approve only when a role holder wrote them,
 * field-level updates). iOS `FakeVault.swift` is the same.
 */
class FakeVault(
    creator: String,
) {
    data class StoredWrap(
        val wrap: WrapRecord,
        val by: String,
    )

    data class HistoryEntry(
        val id: String,
        val field: String,
        val previous: String,
    )

    var name = "Team vault"
    var currentKey = ""
    var defaultRole = "editor"
    val roles = LinkedHashMap<String, Role>()
    val devices = LinkedHashMap<String, DeviceRecord>()
    val wraps = LinkedHashMap<String, StoredWrap>()
    val secrets = LinkedHashMap<String, SecretRecord>()
    val history = mutableListOf<HistoryEntry>()
    val audit = mutableListOf<AuditRecord>()

    init {
        roles[creator] = Role.ADMIN
    }

    fun api(account: String): VaultScreenAPI = Handle(this, account)

    class Denied(
        message: String,
    ) : Exception(message)

    private class Handle(
        val vault: FakeVault,
        val account: String,
    ) : VaultScreenAPI {
        private fun role(): Role = vault.roles[account] ?: Role.PENDING

        private fun mustWrite() {
            if (role() != Role.ADMIN && role() != Role.EDITOR) throw Denied("view-only")
        }

        override suspend fun vaultInfo(): VaultInfoRecord =
            synchronized(vault) { VaultInfoRecord(vault.name, vault.currentKey, vault.defaultRole, account, role()) }

        override suspend fun registerDevice(
            fingerprint: String,
            publicKey: String,
            label: String,
            kind: DeviceKind,
        ) {
            synchronized(vault) {
                vault.devices.putIfAbsent(fingerprint, DeviceRecord(fingerprint, publicKey, label, kind.wire, account))
            }
        }

        override suspend fun revokeDevice(fingerprint: String) {
            synchronized(vault) {
                val d = vault.devices[fingerprint] ?: throw Denied("no such device")
                when {
                    d.account == account -> vault.devices.remove(fingerprint)
                    role() == Role.ADMIN -> vault.devices[fingerprint] = d.copy(revoked = true)
                    else -> throw Denied("owner or admin only")
                }
            }
        }

        override suspend fun listDevices(): List<DeviceRecord> = synchronized(vault) { vault.devices.values.toList() }

        override suspend fun listMembers(): List<MemberRecord> =
            synchronized(vault) {
                val out = vault.roles.map { MemberRecord(it.key, it.value, 0) }.toMutableList()
                for (d in vault.devices.values) {
                    if (out.none { it.account == d.account }) out += MemberRecord(d.account, Role.PENDING, 0)
                }
                out
            }

        override suspend fun keyWrapsFor(recipient: String): List<WrapRecord> =
            synchronized(vault) {
                vault.wraps.values
                    .map { it.wrap }
                    .filter { it.recipient == recipient }
            }

        override suspend fun wrappedPairs(): List<String> =
            synchronized(vault) {
                vault.wraps.values
                    .filter { w ->
                        val by = vault.roles[w.by]
                        if (vault.devices[w.wrap.recipient]?.kind == DeviceKind.AGENT.wire) {
                            by == Role.ADMIN
                        } else {
                            by?.holdsKey ?: false
                        }
                    }.map { "${it.wrap.keyId}:${it.wrap.recipient}" }
            }

        override suspend fun addKeyWraps(wraps: List<WrapRecord>): Int =
            synchronized(vault) {
                var n = 0
                for (w in wraps) {
                    val d = vault.devices[w.recipient] ?: continue
                    if (d.revoked) continue
                    if (d.kind == DeviceKind.AGENT.wire && role() != Role.ADMIN) continue
                    val slot = "${w.keyId}:${w.recipient}:${w.wrapper}"
                    if (vault.wraps.containsKey(slot)) continue
                    vault.wraps[slot] = StoredWrap(w, account)
                    n += 1
                }
                n
            }

        override suspend fun rotateKey(keyId: String) {
            synchronized(vault) {
                if (role() != Role.ADMIN) throw Denied("admin only")
                vault.currentKey = keyId
            }
        }

        override suspend fun setRole(
            account: String,
            role: Role,
        ) {
            synchronized(vault) {
                if (role() != Role.ADMIN) throw Denied("admin only")
                vault.roles[account] = role
            }
        }

        override suspend fun removeMember(account: String) {
            synchronized(vault) {
                if (role() != Role.ADMIN) throw Denied("admin only")
                vault.roles[account] = Role.REMOVED
                for ((fp, d) in vault.devices.entries.toList()) {
                    if (d.account == account) vault.devices[fp] = d.copy(revoked = true)
                }
            }
        }

        override suspend fun listSecrets(): List<SecretRecord> = synchronized(vault) { vault.secrets.values.toList() }

        override suspend fun addSecret(
            id: String,
            kind: String,
            name: String,
            tags: String,
            fields: Map<String, String>,
        ): String =
            synchronized(vault) {
                mustWrite()
                vault.secrets[id] = SecretRecord(id, kind, name, tags, fields, 1u, account, 1u, account)
                id
            }

        override suspend fun updateSecret(
            id: String,
            name: String?,
            tags: String?,
            fields: Map<String, String>,
            rekey: Boolean,
        ) {
            synchronized(vault) {
                mustWrite()
                var s = vault.secrets[id] ?: throw Denied("secret not found")

                fun note(
                    field: String,
                    previous: String,
                ) {
                    if (!rekey && previous.isNotEmpty()) vault.history += HistoryEntry(id, field, previous)
                }
                if (name != null) {
                    note("name", s.name)
                    s = s.copy(name = name)
                }
                if (tags != null) {
                    note("tags", s.tags)
                    s = s.copy(tags = tags)
                }
                val next = s.fields.toMutableMap()
                for ((f, value) in fields) {
                    note(f, next[f].orEmpty())
                    if (value.isEmpty()) next.remove(f) else next[f] = value
                }
                vault.secrets[id] = s.copy(fields = next)
            }
        }

        override suspend fun trashSecret(id: String) {
            synchronized(vault) {
                mustWrite()
                vault.secrets[id]?.let { vault.secrets[id] = it.copy(trashed = true, trashedAt = 2u) }
                vault.audit += AuditRecord("trash", id, account, "", 2u, false)
            }
        }

        override suspend fun restoreSecret(id: String) {
            synchronized(vault) {
                mustWrite()
                vault.secrets[id]?.let { vault.secrets[id] = it.copy(trashed = false) }
            }
        }

        override suspend fun purgeSecret(id: String) {
            synchronized(vault) {
                if (role() != Role.ADMIN) throw Denied("admin only")
                vault.secrets.remove(id)
            }
        }

        override suspend fun auditLogs(): List<AuditRecord> = synchronized(vault) { vault.audit.toList() }

        override suspend fun setDefaultRole(role: Role) {
            synchronized(vault) {
                if (role() != Role.ADMIN) throw Denied("admin only")
                vault.defaultRole = role.wire
            }
        }

        override suspend fun secretHistory(id: String): List<RevisionRecord> =
            synchronized(vault) { vault.history.filter { it.id == id }.map { RevisionRecord(it.field, it.previous, 1u, "") } }
    }
}

val ALICE = "a".repeat(64)
val BOB = "b".repeat(64)

data class Browser(
    val fp: String,
    val device: DeviceKeyPair,
    val session: VaultSession,
)

/** A device of [account] in [vault], with a session over it. */
fun browser(
    vault: FakeVault,
    account: String,
): Browser {
    val device = DeviceKeyPair.generate()
    val fp = PassCrypto.fingerprint(device.publicRaw)
    return Browser(fp, device, VaultSession(vault.api(account), device, fp, "test"))
}
