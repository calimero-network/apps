package network.calimero.sign.core

import com.calimero.mero.app.AppNamespace
import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.delay
import network.calimero.sign.generated.SignClient

/** An agreement: an app instance in a workspace (a Calimero organization). (Swift `AgreementRef`.) */
data class AgreementRef(
    val namespaceId: String,
    val workspaceName: String,
    /** The app instance id (the same as [contextId]). */
    val agreementId: String,
    val name: String,
    val contextId: String,
)

/** How long and how often to wait on a freshly joined agreement. */
data class SyncTiming(
    val enterAttempts: Int = 45,
    val stateAttempts: Int = 12,
    val registerAttempts: Int = 5,
    val delayMs: Long = 2_000,
) {
    companion object {
        /** No waiting, for tests. */
        val IMMEDIATE = SyncTiming(3, 3, 3, 0)
    }
}

/**
 * Workspaces and the agreements in them, and entering one the way the web app does
 * (`app/src/lib/agreements.ts`: `listAgreements`, `enterAgreement`). (Swift `AgreementDirectory`.)
 */
class AgreementDirectory(
    val backend: MeroAppBackend,
    val admin: SignAdmin,
    val store: PrivateStore,
    val timing: SyncTiming = SyncTiming(),
) {
    fun client(contextId: String): SignClient = signClient(backend.contract, contextId)

    /** The account's workspaces (organizations of this app), by name. */
    suspend fun workspaces(): List<AppNamespace> = backend.listNamespaces().sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { nameOf(it) })

    /** The agreements in a workspace: Mero Sign's app instances in that organization, by name. */
    suspend fun agreements(workspace: AppNamespace): List<AgreementRef> = refs(workspace, admin.instances())

    /** Every agreement in every workspace. */
    suspend fun allAgreements(): List<AgreementRef> {
        val workspaces = workspaces()
        val instances = admin.instances()
        return workspaces.flatMap { refs(it, instances) }
    }

    private fun refs(
        workspace: AppNamespace,
        instances: List<SignInstance>,
    ): List<AgreementRef> =
        instances
            .filter { it.org == workspace.id }
            .map { AgreementRef(workspace.id, nameOf(workspace), it.appId, agreementName(it.name, it.appId), it.appId) }
            .sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.name })

    /** Whether the account is on the agreement's roster (the web's `joined`). */
    suspend fun isJoined(contextId: String): Boolean =
        attempt { client(contextId).listParticipants() }.getOrNull()?.any { SignIds.same(it, backend.account) } ?: false

    /** Check the account reaches the agreement: on Calimero 1.0 every workspace member does; nothing to join. */
    suspend fun enter(contextId: String) {
        repeat(maxOf(timing.enterAttempts, 1)) { attemptIndex ->
            if (attemptIndex > 0) delay(timing.delayMs)
            if (attempt { backend.isMember(contextId) }.getOrDefault(false)) return
        }
        throw SignModelException("Your account can't open that agreement. Ask whoever invited you to check your workspace role.")
    }

    /**
     * Everything after entering, as the web's `enterAgreement`: read the name, register as a signer
     * if not on the roster (a guest or a removed account is refused and may still read), then record
     * the agreement and the identity it was joined with in the library (`joinSharedContext` →
     * `IdentityMapping`). Returns the name.
     */
    suspend fun settle(
        contextId: String,
        nameHint: String?,
    ): String {
        val contractName = waitForState(contextId)
        registerSelf(contextId)
        val name = resolveName(contractName, nameHint, contextId)
        store.record(contextId, backend.account, name)
        return name
    }

    internal suspend fun waitForState(contextId: String): String? {
        repeat(maxOf(timing.stateAttempts, 1)) { attemptIndex ->
            if (attemptIndex > 0) delay(timing.delayMs)
            val result = attempt { client(contextId).getContextDetails(contextId).contextName }
            result.onSuccess { return it }
            if (!SignErrorText.isSyncing(result.exceptionOrNull()!!)) return null
        }
        return null
    }

    internal suspend fun registerSelf(contextId: String) {
        if (isJoined(contextId)) return
        repeat(maxOf(timing.registerAttempts, 1)) { attemptIndex ->
            if (attemptIndex > 0) delay(timing.delayMs)
            val result = attempt { client(contextId).registerSelfAsParticipant() }
            if (result.isSuccess) return
            val error = result.exceptionOrNull()!!
            if (SignErrorText.isConflict(error) || SignErrorText.isForbidden(error)) return
            if (!SignErrorText.isSyncing(error)) return
        }
    }

    companion object {
        fun nameOf(workspace: AppNamespace): String = workspace.name?.trimmedOrNull() ?: "Workspace ${workspace.id.take(8)}…"

        internal fun agreementName(
            name: String?,
            id: String,
        ): String = name?.trimmedOrNull() ?: "Agreement ${id.take(8)}…"

        /** The contract's name wins; the invitation's stands in while the context syncs. */
        fun resolveName(
            fromContract: String?,
            fromInvitation: String?,
            contextId: String,
        ): String = fromContract?.trimmedOrNull() ?: fromInvitation?.trimmedOrNull() ?: "Agreement ${contextId.take(8)}…"
    }
}
