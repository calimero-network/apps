package network.calimero.pass.core

import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * A vault's people and the devices holding its key (the web's `VaultPeople`): roles, removal,
 * revocation, the newcomers' role and key rotation. Removing someone or revoking a device as an
 * Admin rotates the key, so nothing written afterwards is readable to them. (Swift `PeopleModel`.)
 */
class PeopleModel(
    val session: VaultSession,
    val api: VaultScreenAPI,
) {
    private val _members = MutableStateFlow<List<MemberRecord>>(emptyList())
    val members: StateFlow<List<MemberRecord>> = _members.asStateFlow()
    private val _devices = MutableStateFlow<List<DeviceRecord>>(emptyList())
    val devices: StateFlow<List<DeviceRecord>> = _devices.asStateFlow()
    private val _phase = MutableStateFlow<LoadPhase>(LoadPhase.Loading)
    val phase: StateFlow<LoadPhase> = _phase.asStateFlow()

    /** What a long action is doing ("Rotating…", "Re-encrypting 3 of 9…"). */
    private val _status = MutableStateFlow<String?>(null)
    val status: StateFlow<String?> = _status.asStateFlow()
    val error = MutableStateFlow<String?>(null)

    suspend fun load() {
        attempt {
            coroutineScope {
                val m = async { api.listMembers() }
                val d = async { api.listDevices() }
                m.await() to d.await()
            }
        }.onSuccess { (members, devices) ->
            _members.value = members.sortedWith(compareBy<MemberRecord> { it.role.ordinal }.thenBy { it.account })
            _devices.value = devices
            _phase.value = LoadPhase.Loaded
        }.onFailure {
            _phase.value = if (_members.value.isEmpty()) LoadPhase.Failed(PassErrorText.describe(it)) else LoadPhase.Loaded
        }
    }

    private suspend fun act(
        label: String,
        body: suspend () -> String?,
    ): Boolean {
        error.value = null
        _status.value = label
        return attempt { body() }
            .onSuccess {
                _status.value = it
                load()
            }.onFailure {
                _status.value = null
                error.value = PassErrorText.describe(it)
            }.isSuccess
    }

    suspend fun setRole(
        account: String,
        role: Role,
    ): Boolean =
        act("Changing role…") {
            api.setRole(account, role)
            null
        }

    /** Remove someone and rotate, so nothing written afterwards reaches them. */
    suspend fun remove(account: String): Boolean =
        act("Removing and rotating…") {
            api.removeMember(account)
            session.refreshKeys()
            session.rotate(null)
            "Removed. The vault key was rotated."
        }

    /** Revoke a device. An Admin's revocation also rotates the key. */
    suspend fun revoke(device: DeviceRecord): Boolean =
        act("Revoking…") {
            api.revokeDevice(device.fingerprint)
            if (session.isAdmin) {
                session.refreshKeys()
                session.rotate(null)
                "Revoked. The vault key was rotated."
            } else {
                "Revoked."
            }
        }

    suspend fun setDefaultRole(role: Role): Boolean =
        act("Saving…") {
            api.setDefaultRole(role)
            session.refreshKeys()
            null
        }

    suspend fun rotate(): Boolean =
        act("Rotating the vault key and re-encrypting…") {
            val n = session.rotate(null) { done, total -> _status.value = "Re-encrypting $done of $total…" }
            "Rotated. $n secret${if (n == 1) "" else "s"} re-encrypted."
        }

    fun clearStatus() {
        _status.value = null
    }

    companion object {
        val roleHelp =
            mapOf(
                Role.ADMIN to "can change roles, rotate the key and permanently delete",
                Role.EDITOR to "can add, edit and trash secrets",
                Role.VIEWER to "can read, cannot change anything",
                Role.PENDING to "registered a device, not let in yet",
                Role.REMOVED to "removed, will not be let back in automatically",
            )
    }
}
