package network.calimero.pass.core

import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Every vault this account has joined, across its teams (the web's `forEachJoinedVault`). (Swift `VaultDirectory`.) */
class VaultDirectory(
    val backend: MeroAppBackend,
    apiFor: ((String) -> VaultAPI)? = null,
) {
    val apiFor: (String) -> VaultAPI = apiFor ?: { PassVaultAPI(backend.contract, it) }

    data class JoinedVault(
        val contextId: String,
        val label: String,
    )

    /** The context ids of every joined vault, with a label for progress. */
    suspend fun joinedVaults(): List<JoinedVault> {
        val out = mutableListOf<JoinedVault>()
        for (ns in backend.listNamespaces()) {
            val subgroups = attempt { backend.listSubgroups(ns.id) }.getOrDefault(emptyList())
            for (group in subgroups) {
                val contextId = group.contextIds.firstOrNull() ?: continue
                if (attempt { backend.isMember(contextId) }.getOrDefault(false)) {
                    out += JoinedVault(contextId, displayName(listOf(group.name), group.groupId, "Vault"))
                }
            }
        }
        return out
    }
}

/**
 * The Security tab (the web's `SecurityPage`): auto-lock, the recovery key (create it, or restore
 * this phone with one). (Swift `SecurityModel`.)
 */
class SecurityModel(
    private val preferences: PassPreferences,
) {
    /** What a long action is doing, or what it came to. */
    private val _status = MutableStateFlow<String?>(null)
    val status: StateFlow<String?> = _status.asStateFlow()
    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()
    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    /** The recovery code just made: shown once, then dropped. */
    private val _shownCode = MutableStateFlow<String?>(null)
    val shownCode: StateFlow<String?> = _shownCode.asStateFlow()
    private val _recovery = MutableStateFlow(preferences.recoveryKey)
    val recovery: StateFlow<RecoveryPublic?> = _recovery.asStateFlow()
    private val _autoLockMinutes = MutableStateFlow(preferences.autoLockMinutes)
    val autoLockMinutes: StateFlow<Int> = _autoLockMinutes.asStateFlow()

    fun setAutoLockMinutes(minutes: Int) {
        _autoLockMinutes.value = minutes
        preferences.autoLockMinutes = minutes
    }

    fun dismissError() {
        _error.value = null
    }

    /** Make a recovery key and give it every vault key this phone holds, in every joined vault. */
    suspend fun createRecoveryKey(
        directory: VaultDirectory,
        device: DeviceKeyPair,
        label: String,
    ) {
        _busy.value = true
        _error.value = null
        try {
            val (code, key) = RecoveryCode.create()
            var covered = 0
            attempt {
                for (vault in directory.joinedVaults()) {
                    _status.value = "Giving the recovery key to ${vault.label}…"
                    val session = VaultSession(directory.apiFor(vault.contextId), device, PassCrypto.fingerprint(device.publicRaw), label)
                    if (attempt { session.open() }.getOrNull() != SessionState.READY) continue
                    if (attempt { session.adoptRecoveryKey(key, replace = true) }.getOrDefault(0) > 0) covered += 1
                }
            }.onSuccess {
                preferences.recoveryKey = key
                _recovery.value = key
                _shownCode.value = code
                _status.value = "Recovery key created for $covered vault${if (covered == 1) "" else "s"}."
            }.onFailure {
                _status.value = null
                _error.value = PassErrorText.describe(it)
            }
        } finally {
            _busy.value = false
        }
    }

    /** The code was written down: forget it. */
    fun dismissCode() {
        _shownCode.value = null
    }

    /** From a phone that holds nothing yet: rebuild the recovery key from [code] and hand every vault key it opens to this phone. */
    suspend fun restore(
        code: String,
        directory: VaultDirectory,
        device: DeviceKeyPair,
        label: String,
    ): Int {
        _busy.value = true
        _error.value = null
        try {
            return attempt {
                RecoveryCode.decode(code)
                var found: RecoveryPublic? = null
                var restored = 0
                val phoneFp = PassCrypto.fingerprint(device.publicRaw)
                for (vault in directory.joinedVaults()) {
                    _status.value = "Restoring ${vault.label}…"
                    val api = directory.apiFor(vault.contextId)
                    val candidates = api.listDevices().filter { !it.revoked }
                    val (pair, fingerprint) = RecoveryCode.pair(code, candidates) ?: continue
                    found = RecoveryPublic(pair.publicRaw, fingerprint)
                    val recoverySession = VaultSession(api, pair, fingerprint, "")
                    if (recoverySession.refreshKeys() != SessionState.READY) continue
                    recoverySession.handOver(device.publicRaw, phoneFp, label)
                    restored += 1
                }
                val key = found ?: throw RecoveryCode.Failure.NO_MATCH
                if (restored == 0) throw RecoveryCode.Failure.NOTHING_OPENED
                preferences.recoveryKey = key
                _recovery.value = key
                _status.value =
                    "$restored vault${if (restored == 1) "" else "s"} restored to this phone. Revoke the device you lost in each vault's People screen."
                restored
            }.getOrElse {
                _status.value = null
                _error.value = PassErrorText.describe(it)
                0
            }
        } finally {
            _busy.value = false
        }
    }
}
