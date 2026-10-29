package network.calimero.pass.core

import com.calimero.mero.app.AppContextEvent
import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json

/** What the item list shows: everything, one kind, or one tag. */
sealed interface ItemFilter {
    data object All : ItemFilter

    data class Kind(
        val kind: String,
    ) : ItemFilter

    data class Tag(
        val tag: String,
    ) : ItemFilter
}

/**
 * One vault on screen (the web's `useVaultSession` + `VaultPage`): opening the session, keeping it
 * fresh, the decrypted items, and every action on them. (Swift `VaultModel`.)
 */
class VaultModel(
    val ref: VaultRef,
    val api: VaultScreenAPI,
    device: DeviceKeyPair,
    label: String,
    private val preferences: PassPreferences,
    private val events: (() -> Flow<AppContextEvent>)? = null,
) {
    sealed interface Phase {
        /** Opening; [notice] says what the relay is still doing while it retries. */
        data class Opening(
            val notice: String?,
        ) : Phase

        /** Open, in one of the session's states. */
        data class Open(
            val state: SessionState,
        ) : Phase

        /** A refusal that does not clear by itself. */
        data class Failed(
            val message: String,
        ) : Phase
    }

    val session = VaultSession(api, device, PassCrypto.fingerprint(device.publicRaw), label)

    private val _phase = MutableStateFlow<Phase>(Phase.Opening(null))
    val phase: StateFlow<Phase> = _phase.asStateFlow()
    private val _secrets = MutableStateFlow<List<Secret>>(emptyList())
    val secrets: StateFlow<List<Secret>> = _secrets.asStateFlow()
    private val _info = MutableStateFlow<VaultInfoRecord?>(null)
    val info: StateFlow<VaultInfoRecord?> = _info.asStateFlow()
    private val _approvals = MutableStateFlow<List<DeviceRecord>>(emptyList())
    val approvals: StateFlow<List<DeviceRecord>> = _approvals.asStateFlow()
    private val _awaitingApproval = MutableStateFlow(false)
    val awaitingApproval: StateFlow<Boolean> = _awaitingApproval.asStateFlow()
    private val _holders = MutableStateFlow<Holders?>(null)
    val holders: StateFlow<Holders?> = _holders.asStateFlow()

    /** The last failed action, for a dismissable banner. */
    val error = MutableStateFlow<String?>(null)
    val filter = MutableStateFlow<ItemFilter>(ItemFilter.All)
    val query = MutableStateFlow("")

    @Volatile private var reloading = false

    @Volatile private var reloadAgain = false

    // ── Derived (read the StateFlows above in Compose to recompose) ──────────────────────────

    val state: SessionState? get() = (_phase.value as? Phase.Open)?.state
    val role: Role? get() = _info.value?.myRole
    val me: String? get() = _info.value?.myAccount
    val isAdmin: Boolean get() = role == Role.ADMIN
    val canWrite: Boolean get() = state == SessionState.READY && (role == Role.ADMIN || role == Role.EDITOR)

    /** Items can be listed (names may still be locked while waiting). */
    val readable: Boolean get() = state == SessionState.READY || state == SessionState.WAITING
    val myCode: String get() = PassCrypto.confirmationCode(session.fingerprint)

    val live: List<Secret> get() = _secrets.value.filter { !it.trashed }
    val trashed: List<Secret> get() = _secrets.value.filter { it.trashed }.sortedByDescending { it.trashedAt }
    val tags: List<String> get() = live.flatMap { it.tags }.toSet().sorted()
    val counts: Map<String, Int> get() = live.groupingBy { it.kind }.eachCount()
    val flagged: Int get() = PasswordTools.analyse(live).count { it.issues.isNotEmpty() }

    val shown: List<Secret>
        get() =
            live
                .filter { s ->
                    when (val f = filter.value) {
                        ItemFilter.All -> true
                        is ItemFilter.Kind -> s.kind == f.kind
                        is ItemFilter.Tag -> f.tag in s.tags
                    }
                }.filter { ItemView.matches(it, query.value) }
                .sortedWith(ItemView.byName)

    fun secret(id: String): Secret? = _secrets.value.firstOrNull { it.id == id }

    /** "End-to-end encrypted · you are an Admin", as the web's vault header. */
    val subtitle: String
        get() {
            val role = role ?: return "End-to-end encrypted"
            val text =
                when (role) {
                    Role.ADMIN -> "you are an Admin"
                    Role.EDITOR -> "you are an Editor"
                    Role.VIEWER -> "you can view"
                    Role.PENDING -> "waiting for an Admin to let you in"
                    Role.REMOVED -> "you were removed from this vault"
                }
            return "End-to-end encrypted · $text"
        }

    // ── Lifecycle ─────────────────────────────────────────────────────────────────────────────

    /** Open the session, retrying while the relay is still joining or syncing the vault, then read it once. */
    suspend fun open(): Boolean {
        var delayMs = 2_000L
        while (currentCoroutineContext().isActive) {
            val opened = attempt { session.open() }
            if (opened.isSuccess) {
                reload()
                return true
            }
            val failure = opened.exceptionOrNull()!!
            if (!PassErrorText.isTransient(failure)) {
                _phase.value = Phase.Failed(PassErrorText.describe(failure))
                return false
            }
            _phase.value = Phase.Opening(PassErrorText.describe(failure))
            delay(delayMs)
            delayMs = minOf(delayMs * 2, 15_000L)
        }
        return false
    }

    /** Open, then keep the vault fresh until cancelled: live events when the relay streams, a poll otherwise and while waiting. */
    suspend fun run() {
        if (!open()) return
        val stream = events
        coroutineScope {
            if (stream != null) {
                launch { attempt { stream().collect { reload() } } }
            }
            launch {
                while (isActive) {
                    delay(PassConstants.POLL_INTERVAL_MS)
                    // With a live stream, poll only while waiting for the key.
                    if (stream == null || state != SessionState.READY) reload()
                }
            }
        }
    }

    /** Try opening again after a failure that did not clear on its own. */
    suspend fun retry() {
        _phase.value = Phase.Opening(null)
        run()
    }

    /** Re-read keys, chores, approvals and items. */
    suspend fun reload() {
        if (reloading) {
            reloadAgain = true
            return
        }
        reloading = true
        try {
            do {
                reloadAgain = false
                reloadOnce()
            } while (reloadAgain)
        } finally {
            reloading = false
        }
    }

    private suspend fun reloadOnce() {
        attempt {
            val s = session.refreshKeys()
            if (s == SessionState.READY) {
                preferences.recoveryKey?.let { recovery -> attempt { session.adoptRecoveryKey(recovery) } }
                // A phone cannot read the team's member list (the web passes it as `allowed`), so it
                // hands keys to the vault's own role holders.
                attempt { session.housekeep(null) }
                _approvals.value = session.pendingApprovals()
                _holders.value = session.holders()
                _awaitingApproval.value = false
            } else {
                _approvals.value = emptyList()
                _holders.value = null
                _awaitingApproval.value = s == SessionState.WAITING && session.awaitingApproval()
            }
            _secrets.value = session.list()
            _info.value = session.info
            _phase.value = Phase.Open(session.state)
        }.onFailure {
            if (_phase.value is Phase.Open) error.value = PassErrorText.describe(it) else _phase.value = Phase.Failed(PassErrorText.describe(it))
        }
    }

    // ── Actions ───────────────────────────────────────────────────────────────────────────────

    private suspend fun act(body: suspend () -> Unit): Boolean {
        error.value = null
        return attempt { body() }
            .onSuccess { reload() }
            .onFailure { error.value = PassErrorText.describe(it) }
            .isSuccess
    }

    /** Validate and save an item. Returns its id, or throws [PassModelException] with words to show. */
    suspend fun save(
        draft: SecretDraft,
        editing: Secret?,
    ): String {
        val name = draft.name.nullIfBlank() ?: throw PassModelException("Give the secret a name.")
        val kind = SecretKind.of(draft.kind) ?: SecretKind.LOGIN
        for (f in kind.fields) {
            if (!f.totp) continue
            val v = draft.fields[f.key]?.nullIfBlank() ?: continue
            if (Totp.parse(v) == null) throw PassModelException("${f.label}: not a base32 seed or an otpauth://totp URI.")
        }
        val keep = kind.fields.map { it.key }.toSet()
        val cleaned =
            SecretDraft(
                kind.wire,
                name,
                draft.tags.mapNotNull { it.nullIfBlank() },
                draft.fields.filter { it.key in keep && it.value.isNotEmpty() },
            )
        val id =
            worded {
                if (editing != null) {
                    session.update(editing, cleaned)
                    editing.id
                } else {
                    session.add(cleaned)
                }
            }
        reload()
        return id
    }

    suspend fun trash(id: String): Boolean = act { api.trashSecret(id) }

    suspend fun restore(id: String): Boolean = act { api.restoreSecret(id) }

    suspend fun purge(id: String): Boolean = act { api.purgeSecret(id) }

    suspend fun history(id: String): List<Revision> =
        attempt { session.history(id) }.getOrElse {
            error.value = PassErrorText.describe(it)
            emptyList()
        }

    /** Put an earlier value back (the web's `restore`). */
    suspend fun restoreRevision(
        revision: Revision,
        secret: Secret,
    ): Boolean =
        act {
            var after = SecretDraft(secret.kind, secret.name, secret.tags, secret.fields)
            after =
                when (revision.field) {
                    "name" -> after.copy(name = revision.previous)
                    "tags" ->
                        after.copy(
                            tags =
                                runCatching {
                                    Json.decodeFromString(ListSerializer(String.serializer()), revision.previous)
                                }.getOrDefault(emptyList()),
                        )
                    else -> after.copy(fields = after.fields + (revision.field to revision.previous))
                }
            session.update(secret, after)
        }

    suspend fun approve(request: DeviceRecord): Boolean = act { session.approve(request) }

    suspend fun deny(request: DeviceRecord): Boolean = act { session.deny(request) }

    suspend fun activity(): List<AuditRecord> =
        attempt { api.auditLogs() }.getOrElse {
            error.value = PassErrorText.describe(it)
            emptyList()
        }

    /** A link that lands someone in this vault (and grants the whole team). */
    suspend fun invite(backend: MeroAppBackend): String = TeamModel.vaultInvite(backend, ref)

    companion object {
        /** The model for a vault over the account's relay. */
        fun over(
            ref: VaultRef,
            backend: MeroAppBackend,
            device: DeviceKeyPair,
            label: String,
            preferences: PassPreferences,
        ): VaultModel =
            VaultModel(
                ref = ref,
                api = PassVaultAPI(backend.contract, ref.contextId),
                device = device,
                label = label,
                preferences = preferences,
                events = if (backend.canSubscribe) ({ backend.events(ref.contextId) }) else null,
            )
    }
}
