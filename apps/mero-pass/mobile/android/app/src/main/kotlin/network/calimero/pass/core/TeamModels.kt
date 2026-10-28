package network.calimero.pass.core

import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/** A team: a namespace, the people, and the vaults they share. */
data class TeamRow(
    val id: String,
    val name: String,
    val memberCount: Int,
    val vaultCount: Int,
)

/** A vault: a subgroup of a team with one context running the contract. */
data class VaultRow(
    val id: String,
    val name: String,
    /** Null while the vault exists but its context has not replicated yet. */
    val contextId: String?,
    val joined: Boolean,
)

/** Where a vault lives, for navigation. */
data class VaultRef(
    val namespaceId: String,
    val teamName: String,
    val vaultId: String,
    val vaultName: String,
    val contextId: String,
)

/** A readable label, given whatever the relay told us (the web's `displayName`). */
fun displayName(
    candidates: List<String?>,
    id: String,
    fallback: String,
): String = candidates.firstNotNullOfOrNull { it?.nullIfBlank() } ?: "$fallback ${id.take(8)}…"

private val byName: Comparator<String> = String.CASE_INSENSITIVE_ORDER

/** The teams this account is in. (Swift `TeamsModel`; the web's `TeamsPage`.) */
class TeamsModel(
    val backend: MeroAppBackend,
) {
    private val _teams = MutableStateFlow<List<TeamRow>>(emptyList())
    val teams: StateFlow<List<TeamRow>> = _teams.asStateFlow()
    private val _phase = MutableStateFlow<LoadPhase>(LoadPhase.Loading)
    val phase: StateFlow<LoadPhase> = _phase.asStateFlow()
    private val _isCreating = MutableStateFlow(false)
    val isCreating: StateFlow<Boolean> = _isCreating.asStateFlow()

    val hasRelay: Boolean get() = backend.hasRelay

    suspend fun load() {
        if (_teams.value.isEmpty()) _phase.value = LoadPhase.Loading
        attempt {
            backend.listNamespaces().map { ns ->
                val vaults = attempt { backend.listSubgroups(ns.id).size }.getOrDefault(0)
                TeamRow(ns.id, displayName(listOf(ns.name), ns.id, "Team"), ns.memberCount, vaults)
            }
        }.onSuccess { rows ->
            _teams.value = rows.sortedWith(compareBy(byName) { it.name })
            _phase.value = LoadPhase.Loaded
        }.onFailure {
            _phase.value = if (_teams.value.isEmpty()) LoadPhase.Failed(PassErrorText.describe(it)) else LoadPhase.Loaded
        }
    }

    /** Start a team named [name]; you become its Admin. Throws [PassModelException]. */
    suspend fun create(name: String): TeamRow {
        val trimmed = name.nullIfBlank() ?: throw PassModelException("Give the team a name.")
        _isCreating.value = true
        try {
            val founded = worded { backend.foundNamespace(trimmed) }
            val row = TeamRow(founded.namespaceId, trimmed, 1, 0)
            if (_teams.value.none { it.id == row.id }) _teams.value = _teams.value + row
            load()
            return _teams.value.firstOrNull { it.id == row.id } ?: row
        } finally {
            _isCreating.value = false
        }
    }

    /** An invitation link to the whole team. */
    suspend fun invite(team: TeamRow): String = TeamModel.teamInvite(backend, team.id, team.name)
}

/** The vaults in one team: list, create, enter, invite. (Swift `TeamModel`; the web's `TeamPage` + `lib/vaults.ts`.) */
class TeamModel(
    val backend: MeroAppBackend,
    val namespaceId: String,
    val teamName: String,
    val applicationId: String,
) {
    private val _vaults = MutableStateFlow<List<VaultRow>>(emptyList())
    val vaults: StateFlow<List<VaultRow>> = _vaults.asStateFlow()
    private val _phase = MutableStateFlow<LoadPhase>(LoadPhase.Loading)
    val phase: StateFlow<LoadPhase> = _phase.asStateFlow()
    private val _isCreating = MutableStateFlow(false)
    val isCreating: StateFlow<Boolean> = _isCreating.asStateFlow()

    /** The vault being opened (joined first when needed). */
    private val _entering = MutableStateFlow<String?>(null)
    val entering: StateFlow<String?> = _entering.asStateFlow()

    suspend fun load() {
        if (_vaults.value.isEmpty()) _phase.value = LoadPhase.Loading
        attempt {
            backend.listSubgroups(namespaceId).map { group ->
                val contextId = group.contextIds.firstOrNull()
                val joined = contextId != null && attempt { backend.isMember(contextId) }.getOrDefault(false)
                VaultRow(group.groupId, displayName(listOf(group.name), group.groupId, "Vault"), contextId, joined)
            }
        }.onSuccess { rows ->
            _vaults.value = rows.sortedWith(compareBy(byName) { it.name })
            _phase.value = LoadPhase.Loaded
        }.onFailure {
            _phase.value = if (_vaults.value.isEmpty()) LoadPhase.Failed(PassErrorText.describe(it)) else LoadPhase.Loaded
        }
    }

    /** Create a vault everyone in the team can open: an OPEN subgroup with a context whose `init(name)` stores the name. */
    suspend fun create(name: String): VaultRef {
        val trimmed = name.nullIfBlank() ?: throw PassModelException("Give the vault a name.")
        if (applicationId.isEmpty()) throw PassModelException("Still connecting to Calimero. Try again in a moment.")
        _isCreating.value = true
        try {
            return worded {
                val groupId = backend.createSubgroup(namespaceId, trimmed, isPublic = true)
                val contextId =
                    backend.createContext(groupId, applicationId, trimmed, buildJsonObject { put("name", JsonPrimitive(trimmed)) })
                _vaults.value = (_vaults.value + VaultRow(groupId, trimmed, contextId, true)).sortedWith(compareBy(byName) { it.name })
                ref(groupId, trimmed, contextId)
            }
        } finally {
            _isCreating.value = false
        }
    }

    /** Open a vault, joining its context first when this account is not in it yet. */
    suspend fun enter(vault: VaultRow): VaultRef {
        val contextId = vault.contextId ?: throw PassModelException("This vault is still syncing. Try again in a moment.")
        if (vault.joined) return ref(vault.id, vault.name, contextId)
        _entering.value = vault.id
        try {
            worded {
                if (!attempt { backend.isMember(contextId) }.getOrDefault(false)) backend.joinContext(contextId)
            }
            _vaults.value = _vaults.value.map { if (it.id == vault.id) it.copy(joined = true) else it }
            return ref(vault.id, vault.name, contextId)
        } finally {
            _entering.value = null
        }
    }

    suspend fun teamInvite(): String = teamInvite(backend, namespaceId, teamName)

    /** A link that lands someone in one vault. The grant is still the whole team. */
    suspend fun vaultInvite(vault: VaultRow): String =
        vaultInvite(backend, VaultRef(namespaceId, teamName, vault.id, vault.name, vault.contextId.orEmpty()))

    private fun ref(
        groupId: String,
        name: String,
        contextId: String,
    ) = VaultRef(namespaceId, teamName, groupId, name, contextId)

    companion object {
        suspend fun teamInvite(
            backend: MeroAppBackend,
            namespaceId: String,
            teamName: String,
        ): String =
            worded {
                PassInvitation(backend.createInvitation(namespaceId), PassInvitation.Kind.TEAM, teamName).link()
            }

        suspend fun vaultInvite(
            backend: MeroAppBackend,
            ref: VaultRef,
        ): String =
            worded {
                PassInvitation(
                    invitation = backend.createInvitation(ref.namespaceId),
                    kind = PassInvitation.Kind.VAULT,
                    teamName = ref.teamName,
                    vaultId = ref.vaultId,
                    vaultName = ref.vaultName,
                    contextId = ref.contextId.nullIfBlank(),
                ).link()
            }
    }
}

/** Where a redeemed invitation lands: a team, or one vault in it. */
data class InvitationDestination(
    val namespaceId: String,
    val teamName: String,
    val vault: VaultRef?,
)

/**
 * Redeeming an invitation link: confirm, join the team, and (for a vault invite) join the vault,
 * then say where to go. (Swift `InvitationModel`; the web's `InvitationPrompt` + `redeemInvite`.)
 */
class InvitationModel(
    private val vaultAttempts: Int = 4,
    private val vaultRetryDelayMs: Long = 1_500,
) {
    sealed interface Stage {
        data object Idle : Stage

        data class Confirm(
            val title: String,
            val isVault: Boolean,
            val teamName: String,
        ) : Stage

        data class Joining(
            val title: String,
        ) : Stage

        data class Joined(
            val destination: InvitationDestination,
        ) : Stage

        data class Failed(
            val message: String,
        ) : Stage
    }

    private val _stage = MutableStateFlow<Stage>(Stage.Idle)
    val stage: StateFlow<Stage> = _stage.asStateFlow()

    var invitation: PassInvitation? = null
        private set

    /** Read a link or a pasted code. False (and a failed stage) when it is not a Mero Pass invitation. */
    fun open(raw: String): Boolean {
        val parsed = PassInvitation.parse(raw)
        invitation = parsed
        if (parsed == null) {
            _stage.value = Stage.Failed("This isn't a Mero Pass invitation. Check the link and try again.")
            return false
        }
        _stage.value = Stage.Confirm(parsed.title, parsed.kind == PassInvitation.Kind.VAULT, parsed.teamName ?: "the team")
        return true
    }

    /** Join. [backend] is read again after [didJoin], which may hand the session the admitting relay. */
    suspend fun accept(
        backend: () -> MeroAppBackend?,
        didJoin: suspend () -> Unit,
    ) {
        val invitation = invitation
        val current = backend()
        if (invitation == null || current == null) {
            _stage.value = Stage.Failed("Sign in to join.")
            return
        }
        _stage.value = Stage.Joining(invitation.title)
        val namespaceId = invitation.namespaceId
        attempt { current.joinNamespace(namespaceId, invitation.invitation) }.exceptionOrNull()?.let { error ->
            val text = (error.message ?: error.toString()).lowercase()
            val already = listOf("already a member", "already member", "already joined", "alreadyjoined", "duplicate member")
            if (already.none { it in text }) {
                _stage.value = Stage.Failed(PassErrorText.describe(error))
                return
            }
        }
        didJoin()
        val teamName = invitation.teamName ?: "Team"
        val contextId = invitation.contextId
        val vaultId = invitation.vaultId
        val vault =
            if (invitation.kind == PassInvitation.Kind.VAULT && contextId != null && vaultId != null) {
                VaultRef(namespaceId, teamName, vaultId, invitation.vaultName ?: "Vault", contextId)
                    .takeIf { joinVault(contextId, backend) }
            } else {
                null
            }
        _stage.value = Stage.Joined(InvitationDestination(namespaceId, teamName, vault))
    }

    private suspend fun joinVault(
        contextId: String,
        backend: () -> MeroAppBackend?,
    ): Boolean {
        repeat(vaultAttempts) { index ->
            if (index > 0) delay(vaultRetryDelayMs)
            val current = backend() ?: return false
            if (attempt { current.isMember(contextId) }.getOrDefault(false)) return true
            if (attempt { current.joinContext(contextId) }.isSuccess) return true
        }
        return false
    }

    fun reset() {
        invitation = null
        _stage.value = Stage.Idle
    }
}
