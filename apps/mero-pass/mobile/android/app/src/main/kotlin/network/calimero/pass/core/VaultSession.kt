package network.calimero.pass.core

import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json

/**
 * One vault, opened with this device's key: the native twin of the web's
 * `packages/mero-pass/src/vaultSession.ts` (and of the Swift actor `VaultSession`), with the same
 * rules. Registering this device, opening the vault keys wrapped to it, bootstrapping a key for a
 * new vault, handing keys on to entitled devices, approving or denying devices, rotating,
 * recovery keys, and sealing or opening every field.
 *
 * Like the Swift actor, calls may interleave at suspension points; the only shared mutable state
 * is the [Keyring] (synchronized) and the volatile [info] / [state], each written whole.
 */
class VaultSession(
    val api: VaultAPI,
    private val device: DeviceKeyPair,
    val fingerprint: String,
    private val label: String,
    val kind: DeviceKind = DeviceKind.BROWSER,
) {
    val keyring = Keyring()

    @Volatile var info: VaultInfoRecord? = null
        private set

    @Volatile var state: SessionState = SessionState.WAITING
        private set

    private val isAgent: Boolean get() = kind == DeviceKind.AGENT
    private val current: VaultKey? get() = info?.let { keyring.get(it.currentKey) }

    val canWrite: Boolean
        get() = state == SessionState.READY && (info?.myRole == Role.ADMIN || info?.myRole == Role.EDITOR)

    val isAdmin: Boolean get() = info?.myRole == Role.ADMIN

    /** Register this device, open every key wrapped to it, and bootstrap a key for a new vault this account administers. */
    suspend fun open(): SessionState {
        api.registerDevice(fingerprint, Bytes.b64(device.publicRaw), label, kind)
        refreshKeys()
        val i = info
        if (i != null && i.currentKey.isEmpty() && isAdmin && !isAgent) bootstrap()
        return state
    }

    /** Re-read the vault info and pull in any wraps that arrived since. */
    suspend fun refreshKeys(): SessionState {
        val i = api.vaultInfo()
        info = i
        for (wrap in api.keyWrapsFor(fingerprint)) {
            if (keyring.has(wrap.keyId)) continue
            PassCrypto.unwrapVaultKey(wrap.envelope, wrap.keyId, device)?.let { keyring.add(it) }
        }
        state =
            when {
                i.currentKey.isEmpty() -> SessionState.UNINITIALISED
                keyring.has(i.currentKey) -> SessionState.READY
                else -> SessionState.WAITING
            }
        return state
    }

    private suspend fun bootstrap() {
        val key = VaultKey.generate()
        api.addKeyWraps(listOf(WrapRecord(key.keyId, fingerprint, fingerprint, PassCrypto.wrapVaultKey(key, device.publicRaw))))
        api.rotateKey(key.keyId)
        keyring.add(key)
        refreshKeys()
    }

    private data class Classified(
        val entitled: List<DeviceRecord>,
        val awaiting: List<DeviceRecord>,
        val pairs: List<String>,
    )

    private suspend fun classify(allowed: Set<String>?): Classified =
        coroutineScope {
            val devices = async { api.listDevices() }
            val members = async { api.listMembers() }
            val pairs = async { api.wrappedPairs() }
            val p = pairs.await()
            val (entitled, awaiting) = classifyDevices(devices.await(), members.await(), p, allowed)
            Classified(entitled, awaiting, p)
        }

    private suspend fun wrapToEntitled(
        key: VaultKey,
        allowed: Set<String>?,
    ): Int {
        val classified = classify(allowed)
        val done = classified.pairs.toSet()
        val wraps = mutableListOf<WrapRecord>()
        for (d in classified.entitled) {
            if ("${key.keyId}:${d.fingerprint}" in done) continue
            // The contract stores only an admin's wrap to an agent.
            if (d.kind == DeviceKind.AGENT.wire && !isAdmin) continue
            val publicRaw = runCatching { Bytes.fromB64(d.publicKey) }.getOrNull() ?: continue
            wraps += WrapRecord(key.keyId, d.fingerprint, fingerprint, PassCrypto.wrapVaultKey(key, publicRaw))
        }
        return if (wraps.isEmpty()) 0 else api.addKeyWraps(wraps)
    }

    /**
     * The chores a key holder does whenever it opens the vault: admins finish removals (only
     * against a listing that includes themselves) and admit pending accounts with the default
     * role; everyone holding the current key hands it to entitled devices that lack it.
     */
    suspend fun housekeep(allowed: Set<String>? = null): Chores {
        var admitted = 0
        var removed = 0
        if (isAgent) return Chores(0, 0, 0)
        val i = info
        if (isAdmin && i != null) {
            val me = i.myAccount
            val members = api.listMembers()
            if (allowed != null && me in allowed) {
                for (m in members) {
                    if (!m.role.holdsKey || m.account == me || m.account in allowed) continue
                    api.removeMember(m.account)
                    removed += 1
                }
                if (removed > 0) rotate(allowed)
            }
            val role = if (i.defaultRole == "viewer") Role.VIEWER else Role.EDITOR
            val agents = agentOnlyAccounts(api.listDevices())
            for (m in members) {
                if (m.role != Role.PENDING) continue
                if (allowed != null && m.account !in allowed) continue
                if (m.account in agents) continue
                api.setRole(m.account, role)
                admitted += 1
            }
        }
        val wrapped = current?.let { wrapToEntitled(it, allowed) } ?: 0
        return Chores(admitted, wrapped, removed)
    }

    /** Mint a new key, give it to everyone still entitled, switch to it and re-seal every secret under it. Admin only. */
    suspend fun rotate(
        allowed: Set<String>?,
        progress: ((Int, Int) -> Unit)? = null,
    ): Int {
        if (!isAdmin || isAgent) throw VaultSessionException("Only a vault Admin can rotate the key.")
        val key = VaultKey.generate()
        keyring.add(key)
        wrapToEntitled(key, allowed)
        api.addKeyWraps(listOf(WrapRecord(key.keyId, fingerprint, fingerprint, PassCrypto.wrapVaultKey(key, device.publicRaw))))
        api.rotateKey(key.keyId)
        refreshKeys()

        val records = api.listSecrets()
        var done = 0
        for (r in records) {
            val plain = decrypt(r)
            if (plain.unreadable) continue
            val sealed = plain.fields.mapValues { (f, v) -> PassCrypto.sealField(key, r.id, f, v) }
            api.updateSecret(
                r.id,
                PassCrypto.sealField(key, r.id, NAME_FIELD, plain.name),
                PassCrypto.sealField(key, r.id, TAGS_FIELD, tagsJson(plain.tags)),
                sealed,
                true,
            )
            done += 1
            progress?.invoke(done, records.size)
        }
        return done
    }

    /** Wrap every key in the keyring, old ones too, to one public key. */
    private suspend fun grant(
        recipient: String,
        publicRaw: ByteArray,
    ): Int {
        val wraps =
            keyring.ids.mapNotNull { id ->
                keyring.get(id)?.let { WrapRecord(id, recipient, fingerprint, PassCrypto.wrapVaultKey(it, publicRaw)) }
            }
        if (wraps.isNotEmpty()) api.addKeyWraps(wraps)
        return wraps.size
    }

    /** Register `next` and give it every key this device holds. */
    suspend fun handOver(
        publicRaw: ByteArray,
        nextFingerprint: String,
        label: String,
        kind: DeviceKind = DeviceKind.BROWSER,
    ): Int {
        api.registerDevice(nextFingerprint, Bytes.b64(publicRaw), label, kind)
        return grant(nextFingerprint, publicRaw)
    }

    /**
     * Give this account's recovery key every key in this vault. With [replace], any other
     * recovery key the account registered here is withdrawn first; without it, a different one
     * already here wins.
     */
    suspend fun adoptRecoveryKey(
        recovery: RecoveryPublic,
        replace: Boolean = false,
    ): Int {
        val i = info
        if (state != SessionState.READY || i == null) return 0
        val me = i.myAccount
        val devices = api.listDevices()
        val others =
            devices.filter {
                it.kind == DeviceKind.RECOVERY.wire && it.account == me && !it.revoked && it.fingerprint != recovery.fingerprint
            }
        if (others.isNotEmpty() && !replace) return 0
        for (d in others) api.revokeDevice(d.fingerprint)
        val listed = devices.firstOrNull { it.fingerprint == recovery.fingerprint }
        if (listed?.revoked == true) return 0
        val pairs = api.wrappedPairs().toSet()
        if (listed != null && "${i.currentKey}:${recovery.fingerprint}" in pairs) return 0
        return handOver(recovery.publicRaw, recovery.fingerprint, RECOVERY_LABEL, DeviceKind.RECOVERY)
    }

    /** Withdraw this device from the vault. */
    suspend fun retire() = api.revokeDevice(fingerprint)

    // ── Device approval ───────────────────────────────────────────────────────────────────────

    /** Whether this device waits for an approval rather than for any key holder. */
    suspend fun awaitingApproval(allowed: Set<String>? = null): Boolean = classify(allowed).awaiting.any { it.fingerprint == fingerprint }

    /** Devices this one could approve: its own account's, or everyone's for an admin. */
    suspend fun pendingApprovals(allowed: Set<String>? = null): List<DeviceRecord> {
        val i = info
        if (state != SessionState.READY || i == null || isAgent) return emptyList()
        val me = i.myAccount
        return classify(allowed).awaiting.filter {
            it.fingerprint != fingerprint && (isAdmin || (it.account == me && it.kind != DeviceKind.AGENT.wire))
        }
    }

    /** Let a waiting device in: hand it every key this device holds. */
    suspend fun approve(request: DeviceRecord): Int {
        if (state != SessionState.READY) throw VaultSessionException.NO_KEY
        if (isAgent) throw VaultSessionException("An agent cannot approve devices.")
        if (request.kind == DeviceKind.AGENT.wire && !isAdmin) throw VaultSessionException("Only a vault Admin can let an agent in.")
        return grant(request.fingerprint, Bytes.fromB64(request.publicKey))
    }

    /** Turn a request down: an owner's revocation withdraws it, an admin's marks it revoked. */
    suspend fun deny(request: DeviceRecord) = api.revokeDevice(request.fingerprint)

    /** How many devices hold the current key. */
    suspend fun holders(): Holders {
        val current = info?.currentKey
        if (current.isNullOrEmpty()) return Holders(0, 0, 0)
        val (devices, pairs) =
            coroutineScope {
                val d = async { api.listDevices() }
                val p = async { api.wrappedPairs() }
                d.await() to p.await()
            }
        val holding = pairs.filter { it.startsWith("$current:") }.map { it.substring(current.length + 1) }.toSet()
        var browsers = 0
        var recovery = 0
        var agents = 0
        for (d in devices) {
            if (d.revoked || d.fingerprint !in holding) continue
            when (d.kind) {
                DeviceKind.RECOVERY.wire -> recovery += 1
                DeviceKind.AGENT.wire -> agents += 1
                else -> browsers += 1
            }
        }
        return Holders(browsers, recovery, agents)
    }

    // ── Secrets ───────────────────────────────────────────────────────────────────────────────

    private fun open1(
        id: String,
        field: String,
        envelope: String,
    ): Pair<String, Boolean> =
        try {
            PassCrypto.openField(keyring, id, field, envelope) to true
        } catch (e: SealException) {
            "" to false
        }

    fun decrypt(r: SecretRecord): Secret {
        val (name, nameOk) = open1(r.id, NAME_FIELD, r.name)
        val (tagsRaw, tagsOk) = open1(r.id, TAGS_FIELD, r.tags)
        var unreadable = !nameOk || !tagsOk
        val tags =
            if (tagsRaw.isEmpty()) {
                emptyList()
            } else {
                runCatching { Json.decodeFromString(ListSerializer(String.serializer()), tagsRaw) }.getOrDefault(emptyList())
            }
        val fields = LinkedHashMap<String, String>()
        for ((f, env) in r.fields) {
            val (v, ok) = open1(r.id, f, env)
            unreadable = unreadable || !ok
            fields[f] = v
        }
        return Secret(
            id = r.id,
            kind = r.kind,
            name = if (nameOk) name else "Locked item",
            tags = tags,
            fields = fields,
            createdAt = r.createdAt,
            createdBy = r.createdBy,
            updatedAt = r.updatedAt,
            updatedBy = r.updatedBy,
            trashed = r.trashed,
            trashedAt = r.trashedAt,
            unreadable = unreadable,
        )
    }

    suspend fun list(): List<Secret> = api.listSecrets().map { decrypt(it) }

    private fun requireKey(): VaultKey = current ?: throw VaultSessionException.NO_KEY

    suspend fun add(draft: SecretDraft): String {
        val key = requireKey()
        val id = PassCrypto.newSecretId()
        val fields =
            draft.fields
                .filterValues { it.isNotEmpty() }
                .mapValues { (f, v) -> PassCrypto.sealField(key, id, f, v) }
        return api.addSecret(
            id,
            draft.kind,
            PassCrypto.sealField(key, id, NAME_FIELD, draft.name),
            PassCrypto.sealField(key, id, TAGS_FIELD, tagsJson(draft.tags)),
            fields,
        )
    }

    /** Write only what changed relative to [before], so an untouched field cannot overwrite a concurrent edit. */
    suspend fun update(
        before: Secret,
        after: SecretDraft,
    ) {
        val key = requireKey()
        val id = before.id
        val fields = LinkedHashMap<String, String>()
        for (f in before.fields.keys + after.fields.keys) {
            val next = after.fields[f].orEmpty()
            if (next == before.fields[f].orEmpty()) continue
            fields[f] = PassCrypto.sealField(key, id, f, next)
        }
        val name = if (after.name != before.name) PassCrypto.sealField(key, id, NAME_FIELD, after.name) else null
        val tags = if (after.tags != before.tags) PassCrypto.sealField(key, id, TAGS_FIELD, tagsJson(after.tags)) else null
        if (name == null && tags == null && fields.isEmpty()) return
        api.updateSecret(id, name, tags, fields, false)
    }

    suspend fun history(id: String): List<Revision> =
        api.secretHistory(id).map { r ->
            val (v, ok) = open1(id, r.field, r.previous)
            Revision(r.field, v, r.replacedAt, r.replacedBy, !ok)
        }

    companion object {
        private const val NAME_FIELD = "name"
        private const val TAGS_FIELD = "tags"

        /** `JSON.stringify(string[])`: no spaces, `/` not escaped. */
        fun tagsJson(tags: List<String>): String = Json.encodeToString(ListSerializer(String.serializer()), tags)
    }
}
